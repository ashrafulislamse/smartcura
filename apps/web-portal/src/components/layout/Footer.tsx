'use client';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-auto">
      <div className="max-w-[1440px] mx-auto px-6 py-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Left: Copyright */}
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span className="material-symbols-outlined text-[16px] text-primary">local_hospital</span>
            <span>© {currentYear} SmartCura. All rights reserved.</span>
          </div>

          {/* Center: Quick Links */}
          <div className="flex items-center gap-6 text-sm">
            <a 
              href="/support/faq" 
              className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
            >
              Help
            </a>
            <a 
              href="#" 
              className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
            >
              Privacy
            </a>
            <a 
              href="#" 
              className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
            >
              Terms
            </a>
          </div>

          {/* Right: Version */}
          <div className="text-xs text-gray-400 dark:text-gray-500">
            v1.0.0
          </div>
        </div>
      </div>
    </footer>
  );
}
