import type { Metadata } from 'next';
import './globals.css';
import SessionProviders from '@/components/SessionProviders';

export const metadata: Metadata = {
  title: 'Dispute Autopilot (DA) | Enterprise PayPal Dispute Automation',
  description: 'Enterprise-grade automated dispute defense, real-time evidence vaulting, and PayPal Seller Protection compliance',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-[#F4F6F8]">
      <body className="min-h-full h-full w-full bg-[#F4F6F8] text-slate-800 antialiased flex flex-col">
        <SessionProviders>{children}</SessionProviders>
      </body>
    </html>
  );
}

