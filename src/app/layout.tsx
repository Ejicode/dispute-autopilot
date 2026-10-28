import type { Metadata } from 'next';
import './globals.css';
import SessionProviders from '@/components/SessionProviders';

export const metadata: Metadata = {
  title: 'Dispute Autopilot | PayPal AI Hackathon 2026',
  description: 'Production Software — Tamper-evident agentic dispute defense with Evidence Vault & Code Claim Verifier',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-[#F4F6F8]">
      <body className="h-full w-full bg-[#F4F6F8] text-slate-800 antialiased flex flex-col overflow-hidden">
        <SessionProviders>{children}</SessionProviders>
      </body>
    </html>
  );
}

