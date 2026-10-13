import type { Metadata } from 'next';
import './globals.css';
import SessionProviders from '@/components/SessionProviders';

export const metadata: Metadata = {
  title: 'Dispute Autopilot | PayPal AI Hackathon 2026',
  description: 'Production Software — Tamper-evident agentic dispute defense with Evidence Vault & Code Claim Verifier',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-[#0B0F19]">
      <body className="h-full bg-[#EDF2F7] text-slate-800 antialiased flex overflow-hidden">
        <SessionProviders>{children}</SessionProviders>
      </body>
    </html>
  );
}

