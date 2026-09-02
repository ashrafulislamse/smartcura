'use client';

/**
 * The signed-in user's own notification inbox, wired to GET /notifications,
 * PUT /notifications/{id}/read and PUT /notifications/read-all.
 *
 * SCOPE IS THE SESSION. The list is the caller's own notifications only — the
 * repository filters by the profile the session proves — so this page is safe to
 * expose to every role without a scope selector, unlike the domain lists.
 *
 * TITLES COME FROM A CODE MAP, not the row: a Notification carries title_code and
 * body_code (that is what keeps PHI out of the row and what makes wording
 * reviewable), so the client renders the copy. The map mirrors the worker's
 * server-side catalogue.
 */

import { useCallback, useMemo, useState } from 'react';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTitle,
  NOTIFICATION_CATEGORIES,
  resourceHref,
  type Notification,
} from '@/lib/api/notifications';
import { ApiError } from '@/lib/api/client';
import type { NotificationCategory } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

type UnreadFilter = 'all' | 'unread';

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-200',
  high: 'bg-orange-50 text-orange-700 ring-orange-200',
  normal: 'bg-slate-50 text-slate-600 ring-slate-200',
  low: 'bg-gray-50 text-gray-500 ring-gray-200',
};

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

export default function NotificationsPage() {
  const [category, setCategory] = useState<NotificationCategory | ''>('');
  const [unreadFilter, setUnreadFilter] = useState<UnreadFilter>('all');
  // Accumulated pages for the cursor "Load more". A fresh filter change resets it,
  // which is why the cursor chain lives in state rather than in the hook deps.
  const [pages, setPages] = useState<readonly Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);

  const filtersDeps = useMemo(
    () => [category, unreadFilter] as const,
    [category, unreadFilter],
  );

  const { data, isLoading, error, reload } = useApiResource<readonly Notification[]>(
    (signal) => listNotifications({
      ...(category === '' ? {} : { category: category as NotificationCategory }),
      ...(unreadFilter === 'unread' ? { unread: true } : {}),
      pageSize: 25,
      signal,
    }).then((response) => {
      setCursor(response.page.next_cursor);
      return response.data;
    }),
    filtersDeps,
  );

  // The first page shown is whatever the hook last fetched; older pages append
  // below it. A filter change re-runs the hook, and the reset below drops the
  // stale accumulation in the same render pass.
  const resetAccumulation = useCallback(() => setPages([]), []);
  const changeFilter = useCallback((next: () => void) => {
    resetAccumulation();
    next();
  }, [resetAccumulation]);

  const items = useMemo(
    () => [...(data ?? []), ...pages],
    [data, pages],
  );
  const unreadCount = items.filter((n) => n.read_at === null).length;

  const loadMore = useCallback(async () => {
    if (cursor === null || busy) return;
    setBusy(true);
    try {
      const response = await listNotifications({
        ...(category === '' ? {} : { category: category as NotificationCategory }),
        ...(unreadFilter === 'unread' ? { unread: true } : {}),
        cursor,
        pageSize: 25,
      });
      setPages((previous) => [...previous, ...response.data]);
      setCursor(response.page.next_cursor);
    } finally {
      setBusy(false);
    }
  }, [busy, category, cursor, unreadFilter]);

  const markOneRead = useCallback(async (notification: Notification) => {
    if (notification.read_at !== null) return;
    setMutating(true);
    try {
      await markNotificationRead(notification.notification_id);
      reload();
    } catch (failure) {
      if (failure instanceof ApiError && failure.isConflict) reload();
    } finally {
      setMutating(false);
    }
  }, [reload]);

  const markAll = useCallback(async () => {
    setMutating(true);
    try {
      await markAllNotificationsRead();
      reload();
    } finally {
      setMutating(false);
    }
  }, [reload]);

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar breadcrumbs={[{ label: 'Notifications' }]} />
      <main className="p-6 lg:p-8 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-slate-700"
              value={category}
              onChange={(event) => changeFilter(() => setCategory(event.target.value as NotificationCategory | ''))}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {NOTIFICATION_CATEGORIES.map((value) => (
                <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
              {(['all', 'unread'] as const).map((value) => (
                <button
                  key={value}
                  className={`px-3 py-2 text-sm transition-colors ${
                    unreadFilter === value ? 'bg-[#1e3fae] text-white' : 'text-slate-600 hover:bg-gray-50'
                  }`}
                  onClick={() => changeFilter(() => setUnreadFilter(value))}
                >
                  {value === 'all' ? 'All' : `Unread${items.length > 0 ? ` (${unreadCount})` : ''}`}
                </button>
              ))}
            </div>
          </div>
          <button
            className="px-3 py-2 text-sm font-medium text-[#1e3fae] border border-[#1e3fae]/30 rounded-lg hover:bg-[#1e3fae]/5 transition-colors disabled:opacity-50"
            onClick={markAll}
            disabled={mutating || unreadCount === 0}
          >
            Mark all read
          </button>
        </div>

        <ResourceState
          isLoading={isLoading}
          error={error}
          isEmpty={!isLoading && error === null && items.length === 0}
          onRetry={reload}
          loadingLabel="Loading notifications…"
          forbiddenTitle="You cannot view notifications"
          errorTitle="Could not load notifications"
          emptyTitle="Nothing here yet"
          emptyBody="No notifications match this filter."
          emptyIcon="notifications"
        />

        {!isLoading && error === null && items.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white overflow-hidden">
            {items.map((notification) => {
              const href = resourceHref(notification);
              const row = (
                <div className="flex items-start gap-3 py-3">
                  <span
                    className={`mt-0.5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-full ring-1 ${
                      PRIORITY_STYLES[notification.priority] ?? PRIORITY_STYLES.normal
                    }`}
                  >
                    {notification.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${notification.read_at === null ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                      {notificationTitle(notification)}
                      <span className="ml-2 text-xs font-normal text-slate-400">{notification.category.replace(/_/g, ' ')}</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {relativeTime(notification.created_at)}
                      {notification.read_at === null && <span className="ml-2 text-[#1e3fae]">unread</span>}
                    </p>
                  </div>
                  {href !== null && (
                    <span className="text-xs text-[#1e3fae] whitespace-nowrap">Open →</span>
                  )}
                </div>
              );
              return (
                <li key={notification.notification_id} className="px-4 hover:bg-gray-50/60">
                  {href !== null ? (
                    <a href={href} className="block" onClick={() => void markOneRead(notification)}>{row}</a>
                  ) : (
                    <button className="block w-full text-left" onClick={() => void markOneRead(notification)}>{row}</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {cursor !== null && !isLoading && error === null && (
          <div className="flex justify-center">
            <button
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
              onClick={loadMore}
              disabled={busy}
            >
              {busy ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
