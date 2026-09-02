'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export default function Error403Page() {
  const router = useRouter();
  const { user } = useAuth();

  const handleGoHome = () => {
    if (user?.activeRole === 'doctor') {
      router.push('/doctor/dashboard');
    } else if (user?.activeRole === 'pharmacy') {
      router.push('/pharmacy/dashboard');
    } else if (user?.activeRole === 'emergency') {
      router.push('/emergency');
    } else {
      router.push('/dashboard');
    }
  };

  const handleSwitchRole = () => {
    router.push('/role-select');
  };

  const traceId = `SC-${Math.floor(Math.random() * 9999)}-403-F`;

  return (
    <div className="font-display min-h-screen flex flex-col relative overflow-x-hidden bg-background-light">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-blue-100/50 rounded-full blur-[120px] opacity-60"></div>
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-violet-100/40 rounded-full blur-[100px] opacity-40"></div>
      </div>

      {/* Header */}
      <header className="w-full bg-white/80 backdrop-blur-md border-b border-gray-100 h-20 flex items-center justify-between px-8 lg:px-16 fixed top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="size-10 bg-gradient-to-br from-violet-600 to-indigo-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-200">
            <span className="material-symbols-outlined text-[24px]">shield_with_heart</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-extrabold tracking-tight text-indigo-900">SmartCura</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-violet-600 opacity-80 leading-none">Portal</span>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-semibold text-indigo-900">{user.name}</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider capitalize">{user.activeRole?.replace('_', ' ')}</span>
            </div>
            <div className="size-10 rounded-full ring-2 ring-gray-100 p-0.5 bg-white">
              <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
                {user.name.charAt(0)}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6 pt-32 pb-12 relative z-10">
        <div className="w-full max-w-[800px] bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(30,27,75,0.12),0_8px_20px_-5px_rgba(30,27,75,0.05)] border border-white/50 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-violet-400 to-transparent opacity-20"></div>

          <div className="flex flex-col items-center px-8 py-16 md:px-16 md:py-20 text-center relative z-10">
            {/* Icon */}
            <div className="mb-14 relative group-hover:scale-[1.02] transition-transform duration-700 ease-in-out">
              <div className="relative size-40 flex items-center justify-center">
                <div className="absolute inset-0 bg-violet-400/20 rounded-full blur-2xl animate-pulse"></div>
                <div className="absolute inset-0 border border-dashed border-violet-200 rounded-full animate-spin-slow"></div>
                <div className="absolute inset-2 border border-dotted border-indigo-100 rounded-full animate-spin-slow" style={{ animationDirection: 'reverse' }}></div>

                <div className="relative size-32 bg-gradient-to-br from-white to-gray-50 shadow-[0_0_40px_-10px_rgba(99,102,241,0.4)] rounded-3xl flex items-center justify-center border border-white">
                  <div className="absolute inset-0 bg-gradient-to-tr from-violet-50/50 to-transparent rounded-3xl opacity-50"></div>
                  <span className="material-symbols-outlined text-[64px] text-transparent bg-clip-text bg-gradient-to-b from-indigo-900 to-violet-600 drop-shadow-sm relative z-10">
                    enhanced_encryption
                  </span>
                  <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-violet-200 to-transparent opacity-50"></div>
                  <div className="absolute left-1/2 top-0 h-full w-px bg-gradient-to-b from-transparent via-violet-200 to-transparent opacity-50"></div>
                </div>

                <div className="absolute -bottom-4 bg-white border border-gray-100 shadow-lg rounded-full px-5 py-2 flex items-center gap-2.5 z-20">
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                  <span className="text-[11px] font-extrabold text-indigo-900 tracking-widest uppercase">Security Alert</span>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="space-y-8 w-full max-w-2xl mx-auto">
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-violet-600 uppercase tracking-[0.25em] flex items-center justify-center gap-2">
                  <span className="w-8 h-px bg-violet-200"></span>
                  403 Forbidden
                  <span className="w-8 h-px bg-violet-200"></span>
                </h2>
                <h1 className="text-5xl md:text-6xl font-extrabold text-indigo-900 tracking-tighter leading-tight drop-shadow-sm">
                  Access <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-primary">Denied</span>
                </h1>
              </div>

              <div className="px-2">
                <p className="text-gray-600 text-lg md:text-xl leading-loose font-light">
                  You do not have permission to access this resource. Your current role <span className="font-bold text-indigo-900 border-b border-indigo-900/10 pb-0.5 capitalize">{user?.activeRole?.replace('_', ' ') || 'User'}</span> does not include the required permissions.
                </p>
              </div>

              {/* Technical Context */}
              <div className="w-full bg-gray-50/80 rounded-xl border border-gray-200 p-5 text-left shadow-inner">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200/60">
                  <span className="material-symbols-outlined text-[16px] text-gray-400">terminal</span>
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Technical Context</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 text-xs font-mono">
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-400 font-semibold">Requested Resource Path</span>
                    <span className="text-indigo-900 font-medium break-all bg-white px-2 py-1 rounded border border-gray-100">{typeof window !== 'undefined' ? window.location.pathname : '/restricted'}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-400 font-semibold">Status Code</span>
                    <div className="flex items-center">
                      <span className="bg-red-50 text-red-700 px-2 py-1 rounded border border-red-100 font-bold">
                        403 FORBIDDEN
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-sm text-gray-400 leading-relaxed max-w-lg mx-auto">
                If your current role requires these privileges, please switch to a different role or contact the system administrator to request an elevation of privilege.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="mt-12 flex flex-col sm:flex-row gap-4 w-full justify-center max-w-lg">
              <button
                onClick={handleSwitchRole}
                className="flex-1 h-14 px-6 rounded-2xl bg-white text-indigo-900 font-bold text-sm border border-gray-200 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] hover:shadow-md hover:border-gray-300 transition-all flex items-center justify-center gap-3 group relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white to-gray-50 opacity-50"></div>
                <span className="material-symbols-outlined text-[20px] text-gray-400 group-hover:text-violet-600 transition-colors relative z-10">grid_view</span>
                <span className="relative z-10">Switch Role</span>
              </button>

              <button
                onClick={handleGoHome}
                className="flex-1 h-14 px-6 rounded-2xl bg-gradient-to-br from-indigo-900 to-primary text-white font-bold text-sm shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 relative overflow-hidden"
              >
                <span className="material-symbols-outlined text-[20px] relative z-10">home</span>
                <span className="relative z-10">Return Home</span>
              </button>
            </div>

            {/* Compliance Badges */}
            <div className="mt-12 flex flex-wrap justify-center gap-6 opacity-60 hover:opacity-100 transition-opacity duration-300">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border border-gray-200 rounded-full px-3 py-1 bg-gray-50">
                <span className="material-symbols-outlined text-[14px]">local_hospital</span>
                HIPAA Compliant
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border border-gray-200 rounded-full px-3 py-1 bg-gray-50">
                <span className="material-symbols-outlined text-[14px]">shield</span>
                GDPR Ready
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border border-gray-200 rounded-full px-3 py-1 bg-gray-50">
                <span className="material-symbols-outlined text-[14px]">verified_user</span>
                SOC2 Type II
              </div>
            </div>

            {/* Footer Info */}
            <div className="mt-10 pt-8 border-t border-gray-100 w-full">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-2 text-[11px] text-gray-400 font-mono">
                  <span className="size-2 rounded-full bg-red-500 animate-pulse"></span>
                  <span>Trace ID: <span className="text-indigo-900 font-bold select-all">{traceId}</span></span>
                </div>

                <div className="flex items-center gap-6">
                  <a href="/support/tickets" className="text-[12px] font-bold text-gray-500 hover:text-violet-600 transition-colors flex items-center gap-1.5 group">
                    Contact Support
                    <span className="material-symbols-outlined text-[14px] group-hover:translate-x-0.5 transition-transform">north_east</span>
                  </a>
                  <a href="/emergency" className="text-[12px] font-bold text-red-600 hover:text-red-700 transition-colors flex items-center gap-1.5 group px-4 py-2 bg-red-50/50 hover:bg-red-50 rounded-full border border-red-100">
                    <span className="material-symbols-outlined text-[16px] fill-1">emergency</span>
                    Emergency Help
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 text-center relative z-10">
        <div className="flex flex-col items-center gap-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">
            © 2024 SmartCura Healthcare Systems
          </p>
          <div className="flex items-center gap-2 text-[10px] text-gray-300">
            <span>System Status: Operational</span>
            <span className="size-1 rounded-full bg-green-400"></span>
          </div>
        </div>
      </footer>

      <style jsx>{`
        @keyframes spin-slow {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .animate-spin-slow {
          animation: spin-slow 12s linear infinite;
        }
      `}</style>
    </div>
  );
}
