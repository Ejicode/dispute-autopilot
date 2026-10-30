'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/components/UserContext';
import { 
  User, 
  Lock, 
  ArrowRight, 
  ShieldCheck, 
  ShoppingBag, 
  AlertCircle, 
  X 
} from 'lucide-react';
import Logo from '@/components/Logo';

export default function LoginPage() {
  const { login, activeUser, loading } = useUser();
  const router = useRouter();
  
  const [loginMode, setLoginMode] = useState<'merchant' | 'buyer'>('merchant');
  const [email, setEmail] = useState('admin@disputeautopilot.com');
  const [password, setPassword] = useState('Password12345678!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);

  useEffect(() => {
    if (!loading && activeUser) {
      if (activeUser.email.includes('buyer')) {
        router.replace('/storefront?mode=buyer');
      } else {
        router.replace('/');
      }
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
      setError(result.error || 'Unable to sign in.');
    } else {
      if (eEmail.includes('buyer')) {
        router.replace('/storefront?mode=buyer');
      } else {
        router.replace('/');
      }
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitWithCredentials(email, password);
  };

  return (
    <div className="min-h-screen md:h-screen w-full flex flex-col md:flex-row bg-white select-none overflow-y-auto md:overflow-hidden">
      
      {/* LEFT PANEL */}
      <div className="w-full md:w-5/12 lg:w-1/2 bg-gradient-to-br from-[#001433] via-[#001C48] to-[#003087] p-8 sm:p-12 lg:p-16 flex flex-col justify-between text-white shrink-0 min-h-[160px] md:h-full">
        <Logo variant="light" size="lg" href="/login" />
        
        <div className="my-auto py-8">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white">
            Dispute Autopilot
          </h1>
        </div>

        <div className="text-xs text-blue-200/80 font-medium">
          PayPal Operations Platform
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-full md:w-7/12 lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-16 min-h-0 md:h-full bg-white overflow-y-auto">
        <div className="w-full max-w-sm space-y-6">
          
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Sign In
            </h2>
          </div>

          {/* Persona Tabs */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setLoginMode('merchant');
                setEmail('admin@disputeautopilot.com');
                setPassword('Password12345678!');
                setError('');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                loginMode === 'merchant'
                  ? 'bg-[#003087] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Merchant</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginMode('buyer');
                setEmail('buyer@disputeautopilot.com');
                setPassword('Password12345678!');
                setError('');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                loginMode === 'buyer'
                  ? 'bg-[#0070BA] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
              <span>Buyer ($5k Fake $)</span>
            </button>
          </div>

          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            
            <div className="space-y-1">
              <label htmlFor="email" className="block text-xs font-bold text-slate-700">
                Email
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
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@disputeautopilot.com"
                  className="w-full box-border rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#003087]/20 focus:border-[#003087] focus:bg-white text-slate-900"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="password" className="block text-xs font-bold text-slate-700">
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
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full box-border rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-16 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#003087]/20 focus:border-[#003087] focus:bg-white text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[10px] font-extrabold text-[#0070BA] hover:text-[#003087] cursor-pointer"
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
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
                className="text-xs text-slate-500 hover:text-[#0070BA] cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting || loading}
              className="w-full rounded-xl bg-[#003087] hover:bg-[#001C48] py-3 font-bold text-white text-xs sm:text-sm transition-all shadow-md shadow-[#003087]/20 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <span>{submitting ? 'Signing in…' : 'Sign In'}</span>
              {!submitting && <ArrowRight className="w-4 h-4" />}
            </button>

          </form>

          <div className="text-center text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>Don't have an account? </span>
            <Link href="/register" className="font-bold text-[#003087] hover:text-[#0070BA] hover:underline">
              Sign up
            </Link>
          </div>

        </div>
      </div>

      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Demo Credentials</h3>
              <button 
                type="button" 
                onClick={() => setShowForgotModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div 
                onClick={() => {
                  setEmail('admin@disputeautopilot.com');
                  setPassword('Password12345678!');
                  setShowForgotModal(false);
                }}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-[#003087] cursor-pointer"
              >
                <span className="font-bold text-slate-800 block">Merchant</span>
                <span className="text-[11px] text-slate-500 font-mono block">admin@disputeautopilot.com</span>
              </div>
              <div 
                onClick={() => {
                  setEmail('buyer@disputeautopilot.com');
                  setPassword('Password12345678!');
                  setShowForgotModal(false);
                }}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-[#0070BA] cursor-pointer"
              >
                <span className="font-bold text-slate-800 block">Buyer</span>
                <span className="text-[11px] text-slate-500 font-mono block">buyer@disputeautopilot.com</span>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
