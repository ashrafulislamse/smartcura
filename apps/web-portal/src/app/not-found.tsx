'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function NotFoundPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const handleGoHome = () => {
    router.push('/dashboard');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const traceId = `SC-${Math.floor(Math.random() * 9999)}-404-NF`;

  const quickLinks = [
    { label: 'Dashboard', icon: 'grid_view', href: '/dashboard', gradient: 'from-blue-500 to-blue-600', shadow: 'shadow-blue-500/30' },
    { label: 'Patients', icon: 'group', href: '/users/patients', gradient: 'from-violet-500 to-fuchsia-600', shadow: 'shadow-violet-500/30' },
    { label: 'Appointments', icon: 'calendar_month', href: '/appointments', gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/30' },
  ];

  return (
    <div className="bg-background-light min-h-screen flex flex-col relative overflow-x-hidden font-display text-gray-900">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-blue-500/10 blur-[100px] rounded-full mix-blend-multiply"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[500px] bg-violet-500/10 blur-[120px] rounded-full mix-blend-multiply"></div>
      </div>

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between whitespace-nowrap border-b border-gray-200 px-6 lg:px-10 py-4 bg-white/80 backdrop-blur-md sticky top-0">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <span className="material-symbols-outlined text-[24px]">local_hospital</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-extrabold tracking-tight text-gray-900">SmartCura</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 opacity-80 leading-none">Healthcare Portal</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-sm font-semibold text-gray-900">Logged in as Admin</span>
            <span className="text-xs text-gray-500">System Administrator</span>
          </div>
          <div className="relative">
            <div className="absolute inset-0 bg-green-500 rounded-full blur-[2px] opacity-20"></div>
            <div className="bg-gradient-to-br from-blue-400 to-blue-600 rounded-full size-10 ring-2 ring-white shadow-sm relative z-10 flex items-center justify-center text-white font-bold">
              A
            </div>
            <div className="absolute bottom-0 right-0 size-2.5 bg-green-500 border-2 border-white rounded-full"></div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl flex flex-col items-center gap-8 text-center">
          {/* Illustration */}
          <div className="relative w-full max-w-sm aspect-[4/3] group">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-violet-500/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
            <div className="relative w-full h-full flex items-center justify-center">
              <div className="relative size-64">
                <div className="absolute inset-0 bg-blue-100 rounded-full blur-3xl opacity-50"></div>
                <div className="relative size-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-[180px] text-transparent bg-clip-text bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500 drop-shadow-lg">
                    search_off
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-4">
            <h2 className="text-xs font-bold text-blue-600 uppercase tracking-[0.25em] flex items-center justify-center gap-2">
              <span className="w-8 h-px bg-blue-200"></span>
              404 Error
              <span className="w-8 h-px bg-blue-200"></span>
            </h2>
            <h1 className="text-5xl md:text-7xl font-extrabold text-gray-900 tracking-tighter leading-tight">
              Page <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">Not Found</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              The page you're looking for doesn't exist or has been moved. Let's get you back on track.
            </p>
          </div>

          {/* Diagnostic Info */}
          <div className="w-full max-w-md mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg flex flex-col gap-1 text-left shadow-inner">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500 text-sm" style={{ fontSize: '16px' }}>warning</span>
              <span className="text-xs font-mono text-gray-500 font-semibold uppercase">Diagnostic Info</span>
            </div>
            <div className="flex flex-col gap-0.5 font-mono text-xs text-gray-600 overflow-x-auto whitespace-nowrap">
              <div><span className="text-gray-400">Status:</span> <span className="text-red-500 font-bold">404 Not Found</span></div>
              <div><span className="text-gray-400">Path:</span> {typeof window !== 'undefined' ? window.location.pathname : '/unknown'}</div>
              <div><span className="text-gray-400">Trace ID:</span> <span className="text-blue-600 font-bold">{traceId}</span></div>
            </div>
          </div>

          {/* Search Bar */}
          <form onSubmit={handleSearch} className="w-full max-w-2xl mt-4">
            <label className="relative flex items-center">
              <span className="material-symbols-outlined absolute left-4 text-gray-400 text-[24px]">search</span>
              <input
                className="w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-12 pr-4 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                placeholder="Search global records, patients, or help docs..."
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="absolute inset-y-0 right-2 flex items-center">
                <kbd className="hidden sm:inline-flex items-center h-6 px-2 text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded">⌘K</kbd>
              </div>
            </label>
          </form>

          {/* Quick Links */}
          <div className="w-full max-w-[680px] mt-8">
            <div className="w-full flex items-center gap-4 py-2 mb-6">
              <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent flex-1"></div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Suggested Resources</span>
              <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent flex-1"></div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {quickLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="group relative flex flex-col items-start p-5 rounded-2xl bg-white border border-gray-200 hover:border-blue-400/50 hover:shadow-lg transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className={`relative mb-3 p-3 rounded-xl bg-gradient-to-br ${link.gradient} text-white shadow-lg ${link.shadow} group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                    <span className="material-symbols-outlined">{link.icon}</span>
                  </div>
                  <div className="relative">
                    <h3 className="text-gray-900 font-bold group-hover:text-primary transition-colors">{link.label}</h3>
                    <p className="text-xs text-gray-500 mt-1">Quick Access</p>
                  </div>
                  <div className="absolute top-4 right-4 text-gray-300 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 mt-8">
            <button
              onClick={() => router.back()}
              className="h-12 px-6 rounded-xl bg-white text-gray-900 font-semibold text-sm border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              Go Back
            </button>
            <button
              onClick={handleGoHome}
              className="h-12 px-6 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white font-semibold text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">home</span>
              Return Home
            </button>
          </div>

          {/* Footer Info */}
          <div className="mt-12 pt-8 border-t border-gray-200 w-full max-w-2xl">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
                <span className="size-2 rounded-full bg-amber-500 animate-pulse"></span>
                <span>Trace ID: <span className="text-gray-900 font-bold select-all">{traceId}</span></span>
              </div>
              <a href="/support/tickets" className="text-xs font-semibold text-gray-500 hover:text-blue-600 transition-colors flex items-center gap-1.5 group">
                Need help? Contact Support
                <span className="material-symbols-outlined text-[14px] group-hover:translate-x-0.5 transition-transform">north_east</span>
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center border-t border-gray-200 bg-white/50">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">
          © 2024 SmartCura Healthcare Systems
        </p>
      </footer>
    </div>
  );
}
