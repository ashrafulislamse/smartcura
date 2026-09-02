'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getRole } from '@/lib/rbac';
import { SessionApiError } from '@/lib/api/session-client';
import { useAuthStore } from '@/store/authStore';
import type { Membership, RoleId } from '@/types/session';
import { isEligibleMembership, roleRequiresVerification } from '@/types/session';

export const dynamic = 'force-dynamic';

/** Where the backend-selected role lands. */
function dashboardForRole(role: RoleId | null): string {
  switch (role) {
    case 'doctor':
      return '/doctor/dashboard';
    case 'pharmacy':
      return '/pharmacy/dashboard';
    case 'emergency':
      return '/emergency';
    default:
      return '/dashboard';
  }
}

function ineligibilityReason(membership: Membership): string | null {
  if (membership.status !== 'active') {
    return `Membership is ${membership.status.replace('_', ' ')} — an administrator must reactivate it.`;
  }
  if (roleRequiresVerification(membership.role) && membership.verification_status !== 'approved') {
    const state = membership.verification_status?.replace('_', ' ') ?? 'not submitted';
    return `Verification is ${state} — this role unlocks once verification is approved.`;
  }
  return null;
}

export default function RoleSelectionPage() {
  const router = useRouter();
  const initialize = useAuthStore(state => state.initialize);
  const status = useAuthStore(state => state.status);
  const storeMemberships = useAuthStore(state => state.memberships);
  const profile = useAuthStore(state => state.profile);
  const session = useAuthStore(state => state.session);
  const selectMembership = useAuthStore(state => state.selectMembership);
  const logout = useAuthStore(state => state.logout);

  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [stepUpRequired, setStepUpRequired] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const resolved = status === 'authenticated' || status === 'anonymous' || status === 'error';

  useEffect(() => {
    if (resolved && status !== 'authenticated') router.replace('/login');
  }, [resolved, router, status]);

  const memberships = useMemo(() => storeMemberships, [storeMemberships]);
  const activeRole = session?.active_role ?? null;

  const handleRoleSelect = async (membershipId: string) => {
    setSelectingId(membershipId);
    setSelectionError(null);
    setStepUpRequired(false);
    try {
      // The backend validates eligibility and returns the resulting active role.
      const response = await selectMembership(membershipId);
      router.replace(dashboardForRole(response.session.active_role));
    } catch (error) {
      if (error instanceof SessionApiError) {
        if (error.code === 'STEP_UP_REQUIRED') {
          setStepUpRequired(true);
          setSelectionError(
            'This role requires step-up verification before it can be activated.',
          );
        } else if (error.code === 'MEMBERSHIP_INACTIVE') {
          setSelectionError(
            'That membership is no longer active. Ask an administrator to restore it, then try again.',
          );
        } else {
          setSelectionError(error.message);
        }
      } else {
        setSelectionError(error instanceof Error ? error.message : 'Role selection failed.');
      }
    } finally {
      setSelectingId(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
    } finally {
      router.replace('/login');
    }
  };

  if (!resolved || status !== 'authenticated') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="size-12 border-4 border-blue-800 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-6xl">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Select Your Role</h1>
          <p className="text-gray-600">
            {profile
              ? `${profile.display_name}, choose an active organization membership.`
              : 'Choose an active organization membership.'}
          </p>
          {activeRole && (
            <p className="mt-2 text-sm text-blue-800">
              Current role: {activeRole.replace('_', ' ')}
            </p>
          )}
        </div>

        {selectionError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
            <p>{selectionError}</p>
            {stepUpRequired && (
              <Button
                variant="ghost"
                className="mt-2 text-red-700 hover:text-red-800"
                onClick={() => router.push('/2fa')}
              >
                Continue to step-up verification
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {memberships.map(membership => {
            const role = getRole(membership.role);
            const eligible = isEligibleMembership(membership);
            const blockedReason = ineligibilityReason(membership);
            const selecting = selectingId === membership.id;
            return (
              <Card
                key={membership.id}
                className={`p-8 border-2 transition-shadow ${
                  eligible ? 'hover:shadow-xl hover:border-blue-800' : 'opacity-60'
                }`}
              >
                <div className="text-center">
                  <span className="material-symbols-outlined text-6xl mb-4 text-blue-800">
                    {role?.icon ?? 'badge'}
                  </span>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    {role?.name ?? membership.role}
                  </h3>
                  <p className="text-gray-600 mb-2">
                    {role?.description ?? 'SmartCura membership'}
                  </p>
                  <p className="text-xs text-gray-500 mb-1 break-all">
                    Organization: {membership.organization_id}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    {membership.status.replace('_', ' ')}
                    {membership.verification_status
                      ? ` · ${membership.verification_status.replace('_', ' ')}`
                      : ''}
                  </p>
                  {blockedReason && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4">
                      {blockedReason}
                    </p>
                  )}
                  <Button
                    className="w-full bg-blue-800 hover:bg-blue-900"
                    disabled={!eligible || selectingId !== null}
                    onClick={() => void handleRoleSelect(membership.id)}
                  >
                    {selecting ? 'Selecting...' : eligible ? 'Select Role' : 'Unavailable'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        {memberships.length === 0 && (
          <Card className="p-8 text-center text-gray-600">
            No memberships are available for this profile.
          </Card>
        )}

        <div className="text-center mt-8">
          <Button variant="ghost" onClick={() => void handleSignOut()} className="text-gray-600">
            <ArrowLeft size={16} className="mr-2" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
