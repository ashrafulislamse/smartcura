'use client';

/**
 * Minimal data-fetching hook for portal pages.
 *
 * Deliberately not react-query. Adding a dependency to this project is a decision for
 * its owner, and what the pages need is small: load, error, refetch, and cancellation
 * on unmount. What matters is that the three states are DISTINCT — loading, failed and
 * empty are different things a user must be shown differently, and a page that collapses
 * them renders an empty table for a permission error.
 *
 * Errors are surfaced as `ApiError`, so a page can branch on `isForbidden` or
 * `needsStepUp` rather than matching on message text.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/client';

export interface ApiResourceState<T> {
  readonly data: T | null;
  readonly isLoading: boolean;
  readonly error: ApiError | null;
  /** Re-runs the fetch. Use after a mutation, or after a 409 conflict. */
  readonly reload: () => void;
}

/**
 * @param fetcher receives an AbortSignal and must forward it, so an unmounted page does
 *                not resolve into discarded state or log a spurious failure.
 * @param deps    re-fetch when these change, same contract as useEffect.
 */
export function useApiResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so `reload` is stable and does not re-trigger the effect itself.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((caught: unknown) => {
        // An abort is the expected outcome of navigating away, not a failure to report.
        if (controller.signal.aborted) return;
        if (!active) return;
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError({
                status: 0,
                code: 'CLIENT_ERROR',
                title: 'Unexpected client error',
                detail: caught instanceof Error ? caught.message : String(caught),
              }),
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, isLoading, error, reload };
}
