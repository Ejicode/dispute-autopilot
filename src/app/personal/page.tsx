'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PersonalRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/profile');
  }, [router]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center text-slate-500 text-sm">
      Redirecting to Merchant Profile...
    </div>
  );
}
