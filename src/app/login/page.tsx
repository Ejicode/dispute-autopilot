'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/components/UserContext';
import { 
  User, 
  Lock, 
  Check, 
  ChevronRight, 
  ShieldCheck, 
  AlertCircle,
  HelpCircle,
  X,
  ArrowRight
} from 'lucide-react';
import Logo from '@/components/Logo';

export default function LoginPage() {
  const { login, activeUser, loading } = useUser();
  const router = useRouter();
  
  const [email, setEmail] = useState('admin@disputeautopilot.com');
  const [password, setPassword] = useState('Password12345678!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);

  // If already logged in, redirect to home
  useEffect(() => {
    if (!loading && activeUser) {
      router.replace('/');
    }
  }, [loading, activeUser, router]);

  const submitWithCredentials = async (eEmail: string, ePass: string) => {
    setSubmitting(true);
    setError('');
    setEmail(eEmail);
    setPassword(ePass);
    const result = await login(eEmail, ePass);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Unable to sign in. Please verify credentials or create an account.');
    } else {
      router.replace('/');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitWithCredentials(email, password);
  };

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-white select-none relative overflow-hidden">
      
      {/* ═════════════════════════════════════════════════════════════
          LEFT HALF: PayPal Deep Navy Hero Panel with Animated 3D Spheres
      ═════════════════════════════════════════════════════════════ */}
      <div className="w-full md:w-1/2 lg:w-5/12 xl:w-1/2 h-auto md:h-full bg-gradient-to-br from-[#001433] via-[#001C48] to-[#003087] p-6 sm:p-8 lg:p-12 xl:p-14 flex flex-col justify-between relative overflow-hidden text-white shrink-0">
        
        {/* Animated Background Ambient Glows */}
        <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-[#0070BA]/25 blur-3xl pointer-events-none animate-pulse-soft" />
        <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-[#00CFDE]/15 blur-3xl pointer-events-none animate-pulse-soft" />
        
        {/* 1. Large 3D Sphere (Bottom-Left) */}
        <div 
          className="absolute -bottom-16 -left-16 w-56 h-56 sm:w-64 sm:h-64 rounded-full pointer-events-none animate-float-slow z-10"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #38BDF8 0%, #0070BA 25%, #003087 65%, #001433 100%)',
            boxShadow: 'inset -12px -12px 28px rgba(0,0,0,0.65), inset 8px 8px 20px rgba(255,255,255,0.45), 0 24px 50px rgba(0,0,0,0.55)'
          }}
        />

        {/* 2. Medium 3D Sphere (Bottom-Center Foreground) */}
        <div 
          className="absolute bottom-6 left-36 sm:left-44 w-32 h-32 sm:w-40 sm:h-40 rounded-full pointer-events-none animate-float-medium z-20"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #93C5FD 0%, #0070BA 30%, #002366 70%, #000F26 100%)',
            boxShadow: 'inset -8px -8px 20px rgba(0,0,0,0.6), inset 6px 6px 16px rgba(255,255,255,0.5), 0 20px 38px rgba(0,0,0,0.5)'
          }}
        />

        {/* 3. Floating Orb (Upper Right) */}
        <div 
          className="absolute top-16 right-8 w-20 h-20 rounded-full opacity-70 pointer-events-none animate-float-fast z-10"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #60A5FA 0%, #0070BA 35%, #003087 70%, #001433 100%)',
            boxShadow: 'inset -4px -4px 10px rgba(0,0,0,0.5), inset 3px 3px 8px rgba(255,255,255,0.4), 0 12px 26px rgba(0,0,0,0.3)'
          }}
        />

        {/* Top: Brand Monogram Header */}
        <div className="relative z-30 flex items-center">
          <Logo variant="light" size="lg" href="/login" />
        </div>

        {/* Center: Welcome Headline */}
        <div className="relative z-30 my-auto py-6 sm:py-8 space-y-3 max-w-sm">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[10px] font-bold text-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Merchant Operations Console</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight uppercase text-white drop-shadow-md leading-none">
            Welcome
          </h1>
          <h2 className="text-[11px] sm:text-xs font-bold tracking-widest uppercase text-blue-200">
            Dispute Autopilot (DA) Platform
          </h2>
          <p className="text-xs text-white/80 font-normal leading-relaxed pt-0.5 max-w-xs">
            Production-grade dispute defense, carrier tracking telemetry, tamper-evident Evidence Vault, and deterministic settlement verification powered by PayPal.
          </p>
        </div>

        {/* Bottom: Trust & Status Indicator */}
        <div className="relative z-30 flex items-center justify-between text-[11px] text-emerald-200/90 font-medium pt-3 border-t border-white/10">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
            <span>256-bit Encrypted Session</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-emerald-300 font-semibold">
            Live Sandbox Connected
          </span>
        </div>

      </div>

      {/* ═════════════════════════════════════════════════════════════
          RIGHT HALF: Seamless White Form Canvas (No Overlap, Perfectly Centered)
      ═════════════════════════════════════════════════════════════ */}
      <div className="w-full md:w-1/2 lg:w-7/12 xl:w-1/2 h-full bg-white flex flex-col justify-center items-center p-6 sm:p-8 lg:p-12 relative overflow-y-auto no-scrollbar">
        
        {/* Decorative 3D Sphere Peeking from Bottom Right */}
        <div 
          className="absolute -bottom-16 -right-16 w-44 h-44 sm:w-52 sm:h-52 rounded-full pointer-events-none animate-float-slow z-0"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #7DD3FC 0%, #0070BA 40%, #003087 75%, #001C48 100%)',
            boxShadow: 'inset -8px -8px 20px rgba(0,0,0,0.35), inset 6px 6px 14px rgba(255,255,255,0.45), 0 16px 36px rgba(0,48,135,0.18)'
          }}
        />

        {/* Form Container (Cleanly sized, vertically centered, zero clipping) */}
        <div className="w-full max-w-sm sm:max-w-md space-y-4 relative z-10 my-auto">
          
          {/* Header */}
          <div className="space-y-1">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Sign in
            </h2>
            <p className="text-xs text-slate-400 font-medium">
              Enter your merchant credentials to access your account
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="min-w-0">
                <p className="font-bold">{error}</p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={submit} className="space-y-3.5">
            
            {/* Field 1: User Name / Email */}
            <div className="space-y-1">
              <label htmlFor="email" className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                User Name / Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@disputeautopilot.com"
                  className="w-full rounded-xl bg-slate-50/80 border border-slate-200 pl-10 pr-4 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#003087]/20 focus:border-[#003087] focus:bg-white transition-all text-slate-900 placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Field 2: Password */}
            <div className="space-y-1">
              <label htmlFor="password" className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl bg-slate-50/80 border border-slate-200 pl-10 pr-16 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#003087]/20 focus:border-[#003087] focus:bg-white transition-all text-slate-900 placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[10px] font-extrabold tracking-wider text-[#0070BA] hover:text-[#003087] cursor-pointer"
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password Row */}
            <div className="flex items-center justify-between text-xs pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 font-medium">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-[#003087] focus:ring-[#003087] border-slate-300 accent-[#003087]"
                />
                <span>Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => setShowForgotModal(true)}
                className="text-xs font-semibold text-slate-600 hover:text-[#0070BA] transition-colors cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>

            {/* Primary Button: Solid PayPal Navy */}
            <button
              type="submit"
              disabled={submitting || loading}
              className="w-full rounded-xl bg-[#003087] hover:bg-[#001C48] active:scale-[0.99] py-3 font-bold text-white text-xs sm:text-sm tracking-wide transition-all shadow-md shadow-[#003087]/25 hover:shadow-lg hover:shadow-[#003087]/35 hover:-translate-y-0.5 disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2 relative overflow-hidden group"
            >
              <span className="relative z-10 flex items-center gap-1.5">
                {submitting ? 'Signing in…' : 'Sign in'}
                {!submitting && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />}
              </span>
            </button>

          </form>

          {/* Bottom Register Link */}
          <div className="text-center text-xs text-slate-500 pt-3 border-t border-slate-100">
            <span>Don't have an account? </span>
            <Link href="/register" className="font-bold text-slate-900 hover:text-[#0070BA] hover:underline">
              Sign up
            </Link>
          </div>

        </div>

      </div>

      {/* ── MODAL: Forgot Password Helper ── */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-sm bg-white card-3d-reflection rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Sign-in Assistance</h3>
              <button 
                type="button" 
                onClick={() => setShowForgotModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              For sandbox access, you can sign in with the primary administrator account:
            </p>
            <div className="space-y-2 text-xs">
              <div 
                onClick={() => {
                  setEmail('admin@disputeautopilot.com');
                  setPassword('Password12345678!');
                  setShowForgotModal(false);
                }}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-[#003087] cursor-pointer hover:-translate-y-0.5 transition-transform"
              >
                <span className="font-bold text-slate-800 block">DA Administrator</span>
                <span className="text-[11px] text-slate-500 font-mono block">admin@disputeautopilot.com</span>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
