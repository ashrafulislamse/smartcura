'use client';

/**
 * The three states every wired list page must render distinctly: loading, failed, empty.
 *
 * WHY THIS IS A COMPONENT. Collapsing these is how a permission error ends up looking like
 * an empty table, which is the worst of the three outcomes: the user concludes there is no
 * data when in fact they were refused. Having written the block by hand for the FAQ,
 * tickets and three finance pages, a fourth copy would be the point at which the variants
 * start to drift apart.
 *
 * A FORBIDDEN error deliberately offers no retry button. Retrying an authorization failure
 * cannot succeed, and offering the action implies it might.
 */

import type { ApiError } from '@/lib/api/client';

interface ResourceStateProps {
  readonly isLoading: boolean;
  readonly error: ApiError | null;
  /** True when the request succeeded and returned nothing. */
  readonly isEmpty: boolean;
  readonly onRetry: () => void;
  /** Shown while loading, e.g. "Loading purchase orders…". */
  readonly loadingLabel: string;
  /** Shown when refused, e.g. "You cannot view procurement". */
  readonly forbiddenTitle: string;
  /** Shown when the request failed for any other reason. */
  readonly errorTitle: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Material symbol name for the empty state. */
  readonly emptyIcon: string;
}

export default function ResourceState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  loadingLabel,
  forbiddenTitle,
  errorTitle,
  emptyTitle,
  emptyBody,
  emptyIcon,
}: ResourceStateProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
        <p className="text-sm text-slate-500">{loadingLabel}</p>
      </div>
    );
  }

  if (error) {
    const forbidden = error.isForbidden;
    return (
      <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8" role="alert">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-red-600">error</span>
          <div className="flex-1">
            <h2 className="font-bold text-slate-900">{forbidden ? forbiddenTitle : errorTitle}</h2>
            <p className="text-sm text-slate-600 mt-1">{error.message}</p>
            {error.correlationId && (
              <p className="text-xs text-slate-400 mt-2">
                Reference: <code>{error.correlationId}</code>
              </p>
            )}
            {!forbidden && (
              <button
                onClick={onRetry}
                className="mt-4 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <span className="material-symbols-outlined text-slate-300 text-5xl">{emptyIcon}</span>
        <h2 className="font-bold text-slate-900 mt-3">{emptyTitle}</h2>
        <p className="text-sm text-slate-500 mt-1">{emptyBody}</p>
      </div>
    );
  }

  return null;
}
