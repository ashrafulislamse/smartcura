'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Error500Page() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const traceId = `SC-${Math.floor(Math.random() * 9999)}-500-SE`;
  const timestamp = new Date().toISOString();

  const handleCopyError = () => {
    const errorDetails = `
Error Report
============
Status: 500 Internal Server Error
Trace ID: ${traceId}
Timestamp: ${timestamp}
Path: ${typeof window !== 'undefined' ? window.location.pathname : '/unknown'}
User Agent: ${typeof window !== 'undefined' ? window.navigator.userAgent : 'Unknown'}
    `.trim();

    navigator.clipboard.writeText(errorDetails);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    router.push('/dashboard');
  };

  return (
    <div className="bg-background-light min-h-screen flex flex-col relative overflow-x-hidden font-display text-gray-900">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-red-500/10 blur-[100px] rounded-full mix-blend-multiply"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[500px] bg-orange-500/10 blur-[120px] rounded-full mix-blend-multiply"></div>
      </div>

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between whitespace-nowrap border-b border-gray-200 px-6 lg:px-10 py-4 bg-white/80 backdrop-blur-md sticky top-0">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <span className="material-symbols-outlined text-[24px]">local_hospital</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-extrabold tracking-tight text-gray-900">SmartCura</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 opacity-80 leading-none">System Error</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full">
            <span className="size-2 rounded-full bg-red-500 animate-pulse"></span>
            <span className="text-xs font-bold text-red-700 uppercase tracking-wider">System Alert</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl flex flex-col items-center gap-8 text-center">
          {/* Icon */}
          <div className="relative w-full max-w-sm aspect-square group">
            <div className="absolute inset-0 bg-gradient-to-tr from-red-500/20 to-orange-500/20 rounded-full blur-3xl opacity-50 group-hover:opacity-70 transition-opacity duration-700"></div>
            <div className="relative w-full h-full flex items-center justify-center">
              <div className="relative size-64">
                {/* Rotating rings */}
                <div className="absolute inset-0 border-4 border-dashed border-red-200 rounded-full animate-spin-slow"></div>
                <div className="absolute inset-8 border-4 border-dotted border-orange-200 rounded-full animate-spin-slow" style={{ animationDirection: 'reverse' }}></div>
                
                {/* Center icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative size-32 bg-gradient-to-br from-white to-gray-50 shadow-2xl rounded-3xl flex items-center justify-center border border-white">
                    <div className="absolute inset-0 bg-gradient-to-tr from-red-50/50 to-transparent rounded-3xl opacity-50"></div>
                    <span className="material-symbols-outlined text-[80px] text-transparent bg-clip-text bg-gradient-to-b from-red-600 to-orange-600 drop-shadow-lg relative z-10 fill-1">
                      error
                    </span>
                  </div>
                </div>

                {/* Pulse effect */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="size-40 bg-red-500/20 rounded-full animate-ping"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-4">
            <h2 className="text-xs font-bold text-red-600 uppercase tracking-[0.25em] flex items-center justify-center gap-2">
              <span className="w-8 h-px bg-red-200"></span>
              500 Internal Server Error
              <span className="w-8 h-px bg-red-200"></span>
            </h2>
            <h1 className="text-5xl md:text-7xl font-extrabold text-gray-900 tracking-tighter leading-tight">
              Something Went <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-orange-600">Wrong</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              We're experiencing technical difficulties. Our team has been notified and is working to resolve the issue.
            </p>
          </div>

          {/* Error Details */}
          <div className="w-full max-w-2xl mt-4 p-5 bg-gray-50 border border-gray-200 rounded-xl text-left shadow-inner">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-red-500 text-[20px]">bug_report</span>
                <span className="text-sm font-bold text-gray-700 uppercase tracking-wider">Error Details</span>
              </div>
              <button
                onClick={handleCopyError}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-all"
              >
                <span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="flex flex-col gap-1">
                <span className="text-gray-400 font-semibold">Status Code</span>
                <span className="text-red-600 font-bold bg-red-50 px-2 py-1 rounded border border-red-100 inline-block">500 INTERNAL SERVER ERROR</span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-gray-400 font-semibold">Trace ID</span>
                <span className="text-gray-900 font-medium bg-white px-2 py-1 rounded border border-gray-200 break-all">{traceId}</span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-gray-400 font-semibold">Timestamp</span>
                <span className="text-gray-600 bg-white px-2 py-1 rounded border border-gray-200">{timestamp}</span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-gray-400 font-semibold">Request Path</span>
                <span className="text-gray-600 bg-white px-2 py-1 rounded border border-gray-200 break-all">
                  {typeof window !== 'undefined' ? window.location.pathname : '/unknown'}
                </span>
              </div>
            </div>
          </div>

          {/* What to do */}
          <div className="w-full max-w-2xl mt-4 p-5 bg-blue-50 border border-blue-200 rounded-xl text-left">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-blue-600 text-[24px] mt-0.5">info</span>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-blue-900 mb-2">What you can do:</h3>
                <ul className="space-y-2 text-sm text-blue-800">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Try refreshing the page</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Return to the homepage and try again</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>If the problem persists, contact support with the trace ID above</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 mt-8">
            <button
              onClick={handleRefresh}
              className="h-12 px-6 rounded-xl bg-white text-gray-900 font-semibold text-sm border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">refresh</span>
              Refresh Page
            </button>
            <button
              onClick={handleGoHome}
              className="h-12 px-6 rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-white font-semibold text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">home</span>
              Return Home
            </button>
            <a
              href="/support/tickets"
              className="h-12 px-6 rounded-xl bg-blue-600 text-white font-semibold text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">support_agent</span>
              Contact Support
            </a>
          </div>

          {/* System Status */}
          <div className="mt-12 pt-8 border-t border-gray-200 w-full max-w-2xl">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
                <span className="size-2 rounded-full bg-red-500 animate-pulse"></span>
                <span>Incident ID: <span className="text-gray-900 font-bold select-all">{traceId}</span></span>
              </div>
              <a href="https://status.smartcura.com" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-gray-500 hover:text-blue-600 transition-colors flex items-center gap-1.5 group">
                Check System Status
                <span className="material-symbols-outlined text-[14px] group-hover:translate-x-0.5 transition-transform">north_east</span>
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center border-t border-gray-200 bg-white/50">
        <div className="flex flex-col items-center gap-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">
            © 2024 SmartCura Healthcare Systems
          </p>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span>System Status:</span>
            <span className="flex items-center gap-1.5 text-red-600 font-semibold">
              <span className="size-1.5 rounded-full bg-red-500 animate-pulse"></span>
              Degraded Performance
            </span>
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
