'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, Building2, Mail, Lock, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { useUser } from '@/components/UserContext';
import Logo from '@/components/Logo';

export default function RegisterPage() {
  const router = useRouter();
  const { activeUser, loading, createAccount } = useUser();

  const [name, setName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in, redirect to appropriate destination
  useEffect(() => {
    if (!loading && activeUser) {
      if (activeUser.email.includes('buyer')) {
        router.replace('/storefront?mode=buyer');
      } else {
        router.replace('/');
      }
    }
  }, [loading, activeUser, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedStore = storeName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName || !trimmedStore || !trimmedEmail || !password) {
      setError('All fields are required.');
      return;
    }

    if (password.length < 15) {
      setError('Password must be at least 15 characters.');
      return;
    }

    setSubmitting(true);
    const result = await createAccount({
      name: trimmedName,
      store_name: trimmedStore,
      email: trimmedEmail,
      password,
    });
    setSubmitting(false);

    if (result.success) {
      router.replace('/');
    } else {
      setError(result.error || 'Failed to create account. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F6F8] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#003087]" />
      </div>
    );
  }

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
        <div className="w-full max-w-sm space-y-6 my-auto py-4">
          
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Sign Up
            </h2>
          </div>

          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Full Name */}
            <div className="space-y-1">
              <label htmlFor="reg-name" className="block text-xs font-bold text-slate-700">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="reg-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Smith"
                  className="w-full box-border rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#003087]/20 focus:border-[#003087] focus:bg-white text-slate-900"
                />
              </div>
            </div>

            {/* Store Name */}
            <div className="space-y-1">
              <label htmlFor="reg-store" className="block text-xs font-bold text-slate-700">
                Store Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Building2 className="w-4 h-4" />
                </div>
                <input
                  id="reg-store"
                  type="text"
                  autoComplete="organization"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Apex Audio Gear"
                  className="w-full box-border rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#003087]/20 focus:border-[#003087] focus:bg-white text-slate-900"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label htmlFor="reg-email" className="block text-xs font-bold text-slate-700">
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="merchant@example.com"
                  className="w-full box-border rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#003087]/20 focus:border-[#003087] focus:bg-white text-slate-900"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label htmlFor="reg-password" className="block text-xs font-bold text-slate-700">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={15}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 15 characters"
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

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[#003087] hover:bg-[#001C48] py-3 font-bold text-white text-xs sm:text-sm transition-all shadow-md shadow-[#003087]/20 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <span>{submitting ? 'Creating Account…' : 'Create Account'}</span>
              {!submitting && <ArrowRight className="w-4 h-4" />}
            </button>

          </form>

          {/* Link to Sign In */}
          <div className="text-center text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>Already have an account? </span>
            <Link href="/login" className="font-bold text-[#003087] hover:text-[#0070BA] hover:underline">
              Sign in
            </Link>
          </div>

        </div>
      </div>

    </div>
  );
}
