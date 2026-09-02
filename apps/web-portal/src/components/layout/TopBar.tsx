'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { getRole } from '@/lib/rbac';

interface TopBarProps {
  breadcrumbs: { label: string; href?: string }[];
}

export default function TopBar({ breadcrumbs }: TopBarProps) {
  // Profile and role come from the backend bootstrap; both can be absent while the
  // session is still loading or before a membership has been selected.
  const { profile, activeMembership, isLoading } = useAuth();

  const displayName = profile?.display_name ?? null;
  const roleLabel = activeMembership
    ? getRole(activeMembership.role)?.name ?? activeMembership.role.replace('_', ' ')
    : null;
  const avatarInitial = displayName?.trim().charAt(0).toUpperCase() || '—';

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm z-10">
      <div className="flex items-center gap-2 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center gap-2">
            {index > 0 && (
              <span className="text-slate-300 material-symbols-outlined text-sm">chevron_right</span>
            )}
            {crumb.href ? (
              <a href={crumb.href} className="text-slate-400 font-medium hover:text-[#1E40AF] transition-colors">
                {crumb.label}
              </a>
            ) : (
              <span className={index === breadcrumbs.length - 1 ? 'text-[#1E40AF] font-bold bg-blue-50 px-2 py-1 rounded' : 'text-slate-400 font-medium'}>
                {crumb.label}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-6">
        {/* Search */}
        <div className="relative hidden md:block">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 material-symbols-outlined text-[20px]">search</span>
          <input
            className="pl-10 pr-4 py-2 w-64 bg-gray-50 border border-gray-200 rounded-full text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all text-slate-700 placeholder:text-slate-400"
            placeholder="Search patients, doctors..."
            type="text"
          />
        </div>

        <div className="h-6 w-px bg-gray-200"></div>

        {/* Notifications — the caller's own inbox; the backend scopes the list
            to the session's profile, so this is safe for every role. */}
        <Link
          href="/notifications"
          aria-label="Open notifications"
          className="relative p-2 text-slate-500 hover:text-[#1e3fae] transition-colors rounded-full hover:bg-gray-50"
        >
          <span className="material-symbols-outlined">notifications</span>
        </Link>

        {/* User Profile */}
        <div className="flex items-center gap-3 pl-2 cursor-pointer hover:opacity-80 transition-opacity">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-slate-800 leading-none">
              {displayName ?? (isLoading ? 'Loading...' : 'Signed in')}
            </p>
            <p className="text-xs text-slate-500 leading-none mt-1 capitalize">
              {roleLabel ?? (isLoading ? '' : 'No active role')}
            </p>
          </div>
          <div className="size-10 rounded-full bg-gradient-to-br from-blue-400 to-[#1e3fae] flex items-center justify-center text-white font-bold text-sm border-2 border-white shadow-sm">
            {avatarInitial}
          </div>
        </div>
      </div>
    </header>
  );
}
