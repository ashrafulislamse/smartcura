'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { getIdentityProvider } from '@/lib/identity/identity-provider';
import { useAuthStore } from '@/store/authStore';
import type { BootstrapState } from '@/types/session';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface LoginFormData {
  email: string;
  password: string;
}

interface LoginFormErrors {
  email?: string;
  password?: string;
}

function routeForBootstrapState(state: BootstrapState): string {
  switch (state) {
    case 'profile_required':
      return '/settings/profile';
    case 'role_selection_required':
      return '/role-select';
    case 'verification_pending':
      return '/2fa';
    case 'ready':
    default:
      return '/dashboard';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createSession = useAuthStore(state => state.createSession);

  const [formData, setFormData] = useState<LoginFormData>({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<LoginFormErrors>({});

  const validateForm = (): boolean => {
    const nextErrors: LoginFormErrors = {};
    if (!formData.email) {
      nextErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      nextErrors.email = 'Please enter a valid email address';
    }
    if (!formData.password) {
      nextErrors.password = 'Password is required';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // The identity provider authenticates the credentials; the portal never does.
      const { idToken, mfaRequired } = await getIdentityProvider().signIn(
        formData.email,
        formData.password,
      );
      // The backend decides what happens next.
      const bootstrap = await createSession(idToken, 'web_portal', 'SmartCura Web Portal');
      // A provider-reported second factor still has to be completed via step-up.
      router.replace(mfaRequired ? '/2fa' : routeForBootstrapState(bootstrap.bootstrap_state));
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Sign-in failed',
        description: error instanceof Error ? error.message : 'Unable to start a session.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#f0f2f8] dark:bg-[#0e1120] min-h-screen relative flex items-start justify-center overflow-y-auto p-4 py-10">
      {/* Abstract Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[10%] -right-[10%] w-[50vw] h-[50vw] bg-blue-400/20 rounded-full mix-blend-multiply filter blur-[100px] opacity-60 animate-blob dark:bg-blue-600/20"></div>
        <div className="absolute top-[20%] -left-[10%] w-[40vw] h-[40vw] bg-teal-300/20 rounded-full mix-blend-multiply filter blur-[100px] opacity-60 animate-blob animation-delay-2000 dark:bg-teal-500/20"></div>
        <div className="absolute -bottom-[20%] left-[20%] w-[45vw] h-[45vw] bg-indigo-300/20 rounded-full mix-blend-multiply filter blur-[100px] opacity-60 animate-blob animation-delay-4000 dark:bg-indigo-500/20"></div>
      </div>

      {/* Login Container */}
      <div className="relative z-10 w-full max-w-[440px] flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-center gap-3">
          <div className="w-10 h-10 bg-[#1e3fae] rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <img src="/logo-mark-white.svg" alt="" className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-none">SmartCura</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Admin &amp; Staff Portal</p>
          </div>
        </div>

        {/* Login Form card */}
        <div className="bg-white dark:bg-[#161929] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
          <div className="p-7 flex flex-col w-full">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Sign In</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Sign in with your SmartCura identity credentials.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Email */}
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold text-gray-900 dark:text-gray-200 ml-1"
                  htmlFor="email"
                >
                  Email Address
                </label>
                <div className="relative group/input">
                  <input
                    className="block w-full h-11 sm:h-12 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-white placeholder-gray-400 focus:border-[#1e3fae] focus:ring-4 focus:ring-[#1e3fae]/10 transition-all duration-200 ease-in-out text-sm"
                    id="email"
                    placeholder="you@organization.example"
                    type="email"
                    autoComplete="username"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    disabled={isSubmitting}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400 group-focus-within/input:text-[#1e3fae] transition-colors">
                    <span className="material-symbols-outlined text-[18px] sm:text-[20px]">mail</span>
                  </div>
                </div>
                {errors.email && (
                  <p className="text-xs sm:text-sm text-red-600 mt-1 ml-1">{errors.email}</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold text-gray-900 dark:text-gray-200 ml-1"
                  htmlFor="password"
                >
                  Password
                </label>
                <div className="relative group/input">
                  <input
                    className="block w-full h-11 sm:h-12 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-white placeholder-gray-400 focus:border-[#1e3fae] focus:ring-4 focus:ring-[#1e3fae]/10 transition-all duration-200 ease-in-out text-sm pr-10"
                    id="password"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    disabled={isSubmitting}
                  />
                  <button
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <span className="material-symbols-outlined text-[18px] sm:text-[20px]">
                      {showPassword ? 'visibility' : 'visibility_off'}
                    </span>
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs sm:text-sm text-red-600 mt-1 ml-1">{errors.password}</p>
                )}
              </div>

              <div className="flex items-center justify-end mt-1">
                <div className="text-xs sm:text-sm">
                  <a
                    className="font-semibold text-[#1e3fae] hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
                    href="#"
                  >
                    Forgot Password?
                  </a>
                </div>
              </div>

              {/* Sign In Button */}
              <div className="mt-2">
                <button
                  className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl shadow-lg shadow-[#1e3fae]/20 text-sm font-bold text-white bg-[#1e3fae] hover:bg-blue-800 transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Signing In...' : 'Sign In'}
                </button>
              </div>
            </form>

            {/* HIPAA */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-center gap-1.5 text-gray-400 dark:text-gray-500">
              <span className="material-symbols-outlined text-[13px]">lock</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider">HIPAA Compliant</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-gray-400 dark:text-gray-600 pb-2">
          © 2026 SmartCura · All activity is logged for audit purposes
        </p>
      </div>
    </div>
  );
}
