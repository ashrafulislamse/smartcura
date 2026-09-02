'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PharmacyRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/pharmacy/dashboard');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );
}
