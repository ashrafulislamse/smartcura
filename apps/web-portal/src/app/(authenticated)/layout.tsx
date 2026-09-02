'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Footer from '@/components/layout/Footer';
import { useAuthStore } from '@/store/authStore';

/** Route the backend sends a profile to when onboarding is incomplete. */
const PROFILE_ONBOARDING_ROUTE = '/settings/profile';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const initialize = useAuthStore(state => state.initialize);
  const status = useAuthStore(state => state.status);
  const bootstrapState = useAuthStore(state => state.bootstrapState);
  const error = useAuthStore(state => state.error);

  const resolved = status === 'authenticated' || status === 'anonymous' || status === 'error';

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // One authoritative gate: the backend bootstrap_state decides where the user goes.
  useEffect(() => {
    if (!resolved) return;
    if (status !== 'authenticated') {
      router.replace('/login');
      return;
    }
    if (bootstrapState === 'role_selection_required') {
      router.replace('/role-select');
      return;
    }
    if (bootstrapState === 'profile_required' && pathname !== PROFILE_ONBOARDING_ROUTE) {
      router.replace(PROFILE_ONBOARDING_ROUTE);
    }
  }, [bootstrapState, pathname, resolved, router, status]);

  if (!resolved || status !== 'authenticated' || bootstrapState === 'role_selection_required') {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="text-center">
          <div className="size-12 border-4 border-[#1e3fae] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-600 mt-4 font-medium">Checking your session with SmartCura...</p>
          {error && <p className="text-sm text-red-600 mt-2 max-w-md">{error.title}</p>}
        </div>
      </div>
    );
  }

  if (bootstrapState === 'profile_required' && pathname !== PROFILE_ONBOARDING_ROUTE) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="size-12 border-4 border-[#1e3fae] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (bootstrapState === 'verification_pending') {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="material-symbols-outlined text-4xl text-[#1e3fae]">verified_user</span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Portal access is not ready</h1>
          <p className="mt-2 text-slate-600">
            Your membership verification or step-up verification is still pending. The backend will
            open the portal once it reports a ready session.
          </p>
        </div>
      </div>
    );
  }

  const hideSidebar = pathname?.includes('/templates/') &&
    (pathname.includes('/new') || Boolean(pathname.match(/\/templates\/\d+$/)));

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {!hideSidebar && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
        <Footer />
      </div>
    </div>
  );
}
