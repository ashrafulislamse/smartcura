'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { SessionApiError } from '@/lib/api/session-client';
import {
  IdentityProviderNotConfiguredError,
  getIdentityProvider,
  isIdentityProviderConfigured,
} from '@/lib/identity/identity-provider';
import { useAuthStore } from '@/store/authStore';
import type { StepUpReason } from '@/types/session';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

const STEP_UP_REASON: StepUpReason = 'role_switch';

/**
 * Step-up verification.
 *
 * There is no browser-side one-time code and no client-held token. The identity
 * provider reauthenticates the user (MFA included) and issues a fresh identity
 * token; the backend then extends the application session via
 * `POST /sessions/step-up` and reports how long the step-up stays valid.
 */
export default function StepUpVerificationPage() {
  const router = useRouter();
  const { toast } = useToast();

  const initialize = useAuthStore(state => state.initialize);
  const status = useAuthStore(state => state.status);
  const profile = useAuthStore(state => state.profile);
  const session = useAuthStore(state => state.session);
  const stepUp = useAuthStore(state => state.stepUp);

  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Read only in an effect / event handler, never during render.
  const [providerConfigured, setProviderConfigured] = useState(true);

  useEffect(() => {
    void initialize();
    setProviderConfigured(isIdentityProviderConfigured());
  }, [initialize]);

  const resolved = status === 'authenticated' || status === 'anonymous' || status === 'error';

  useEffect(() => {
    if (resolved && status !== 'authenticated') router.replace('/login');
  }, [resolved, router, status]);

  const stepUpValidUntil = session?.step_up_valid_until ?? null;

  const handleStepUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const identityToken = await getIdentityProvider().reauthenticate({
        email: profile?.email,
        password: password || undefined,
        otp: otp || undefined,
      });
      await stepUp(identityToken, STEP_UP_REASON);
      toast({
        title: 'Verification complete',
        description: 'The backend extended your session for sensitive actions.',
      });
      router.replace('/role-select');
    } catch (error) {
      if (error instanceof IdentityProviderNotConfiguredError) {
        setProviderConfigured(false);
        setErrorMessage(error.message);
      } else if (error instanceof SessionApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(
          error instanceof Error ? error.message : 'Step-up verification failed.',
        );
      }
    } finally {
      setIsSubmitting(false);
      setPassword('');
      setOtp('');
    }
  };

  if (!resolved || status !== 'authenticated') {
    return (
      <div className="bg-[#f6f6f8] dark:bg-[#121520] min-h-screen flex items-center justify-center">
        <div className="size-12 border-4 border-[#1e3fae] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[#f6f6f8] dark:bg-[#121520] min-h-screen flex flex-col items-center justify-center p-3 sm:p-4 relative overflow-x-hidden transition-colors duration-300">
      {/* Ambient Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#1e3fae]/5 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-400/5 rounded-full blur-[120px]"></div>
      </div>

      {/* Header Logo Area */}
      <header className="absolute top-0 left-0 w-full p-3 sm:p-4 md:p-6 flex justify-between items-center z-20">
        <div className="flex items-center gap-2 select-none">
          <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-white dark:bg-white/5 shadow-sm border border-slate-100 dark:border-white/10">
            <img src="/logo-mark.svg" alt="" className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] sm:text-xs font-bold text-slate-900 dark:text-white leading-tight tracking-wide">SMARTCURA</span>
            <span className="text-[8px] sm:text-[9px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-widest">Portal Access</span>
          </div>
        </div>
        <a
          className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-white/5 rounded-full shadow-sm border border-slate-100 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#1e3fae] dark:hover:text-white transition-colors"
          href="#"
        >
          <span className="material-symbols-outlined text-sm">support_agent</span>
          <span>Help</span>
        </a>
      </header>

      {/* Main Verification Card */}
      <div className="w-full max-w-[480px] relative z-10 mt-16 sm:mt-0">
        <div className="bg-white dark:bg-[#1a1e2e] rounded-2xl sm:rounded-3xl shadow-[0_20px_40px_-5px_rgba(0,0,0,0.05)] border border-slate-100 dark:border-slate-800 relative overflow-hidden group/card">
          <div className="absolute top-0 left-0 w-full h-1 sm:h-1.5 bg-gradient-to-r from-[#1e3fae] via-blue-400 to-[#1e3fae]"></div>

          <div className="p-5 sm:p-6 md:p-8 flex flex-col items-center text-center">
            <div className="relative mb-4 sm:mb-5">
              <div className="relative flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-xl sm:rounded-2xl bg-slate-50 dark:bg-white/5 text-[#1e3fae] border border-slate-100 dark:border-white/10 shadow-sm">
                <span
                  className="material-symbols-outlined text-[28px] sm:text-[32px]"
                  style={{ fontVariationSettings: "'FILL' 1, 'wght' 400" }}
                >
                  lock_person
                </span>
              </div>
            </div>

            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white mb-2 tracking-tight">
              Step-Up Verification
            </h1>

            <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm leading-relaxed max-w-[360px] mx-auto mb-5 sm:mb-6">
              Sensitive actions need a fresh identity check.
              {profile ? (
                <>
                  {' '}Reauthenticate as{' '}
                  <span className="text-slate-900 dark:text-white font-semibold">{profile.email}</span>.
                </>
              ) : null}
            </p>

            {!providerConfigured ? (
              <div className="w-full text-left rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-4">
                <p className="text-sm font-bold text-amber-800 dark:text-amber-500 mb-1">
                  Identity provider is not configured
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-500/90">
                  This portal has no identity provider registered, so step-up verification cannot
                  be performed. An operator must register an IdentityProvider implementation
                  before this screen can complete verification.
                </p>
              </div>
            ) : (
              <form onSubmit={handleStepUp} className="w-full flex flex-col gap-4 text-left">
                <div className="space-y-1.5">
                  <label
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                    htmlFor="stepup-password"
                  >
                    Password
                  </label>
                  <input
                    id="stepup-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#1e3fae] focus:ring-2 focus:ring-[#1e3fae]/20 transition-all"
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                    htmlFor="stepup-otp"
                  >
                    Authenticator code (if your provider requires one)
                  </label>
                  <input
                    id="stepup-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    disabled={isSubmitting}
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm tracking-widest focus:outline-none focus:border-[#1e3fae] focus:ring-2 focus:ring-[#1e3fae]/20 transition-all"
                    placeholder="000000"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[#1e3fae] hover:bg-[#15308a] text-white font-bold text-sm sm:text-base h-11 sm:h-12 rounded-xl shadow-lg shadow-[#1e3fae]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <span className="tracking-wide">
                    {isSubmitting ? 'Verifying...' : 'Verify Identity'}
                  </span>
                  <span className="material-symbols-outlined text-base sm:text-lg">arrow_forward</span>
                </button>
              </form>
            )}

            {errorMessage && (
              <p className="mt-4 w-full text-left text-xs text-red-600 dark:text-red-400">
                {errorMessage}
              </p>
            )}

            {stepUpValidUntil && (
              <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
                Current step-up valid until {stepUpValidUntil}
              </p>
            )}

            <button
              type="button"
              onClick={() => router.push('/role-select')}
              className="mt-5 text-xs font-semibold text-[#1e3fae] hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
            >
              Back to role selection
            </button>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-4 sm:mt-5 flex flex-col items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-200/50 dark:bg-slate-800/50 border border-slate-300/50 dark:border-slate-700/50 backdrop-blur-sm">
            <span className="material-symbols-outlined text-slate-500 text-[11px] sm:text-xs">lock</span>
            <span className="text-[9px] sm:text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              Verified by the SmartCura API
            </span>
          </div>
          <p className="text-slate-400 dark:text-slate-600 text-[9px] sm:text-[10px] font-medium">
            Secure Healthcare Admin Portal
          </p>
        </div>
      </div>
    </div>
  );
}
