'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Building2, Mail, User, Image as ImageIcon, Check, Loader2, AlertCircle } from 'lucide-react';
import { useUser } from '@/components/UserContext';

const AVATAR_PHOTOS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=256&q=80',
];

export default function RegisterPage() {
  const router = useRouter();
  const { users, loading: userLoading, createAccount, setActiveUser, refreshUsers } = useUser();

  const [form, setForm] = useState({ name: '', email: '', store_name: '', avatar_url: AVATAR_PHOTOS[0] });
  const [useCustomUrl, setUseCustomUrl] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If users already exist, redirect to home (they're already registered)
  useEffect(() => {
    if (!userLoading && users.length > 0) {
      router.replace('/');
    }
  }, [userLoading, users, router]);

  // Also check: if user just created account successfully, the UserContext reloads
  // and users.length > 0 will trigger the redirect above

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (!form.name.trim() || !form.email.trim() || !form.store_name.trim()) {
      setError('All fields are required.');
      setSubmitting(false);
      return;
    }

    const result = await createAccount({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      store_name: form.store_name.trim(),
      avatar_url: form.avatar_url || undefined,
    });

    if (result.success) {
      await refreshUsers();
      router.replace('/');
    } else {
      setError(result.error || 'Failed to create account. Please try again.');
    }
    setSubmitting(false);
  };

  if (userLoading) {
    return (
      <div className="min-h-screen bg-[#EDF2F7] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#0070BA]" />
      </div>
    );
  }

  const initials = form.name.trim() ? form.name.trim().charAt(0).toUpperCase() : '?';

  return (
    <div className="min-h-screen bg-[#EDF2F7] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#003087] to-[#0070BA] shadow-lg shadow-blue-900/30 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Dispute Autopilot</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">
            Create your merchant account to get started
          </p>
          <span className="inline-block mt-2 px-3 py-1 rounded-full bg-[#FFC439]/20 text-amber-700 text-xs font-bold border border-[#FFC439]/40">
            PayPal AI Hackathon 2026
          </span>
        </div>

        {/* Registration Card */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-[#003087] to-[#0070BA] px-6 py-4">
            <h2 className="text-white font-bold text-base">Merchant Registration</h2>
            <p className="text-white/70 text-xs mt-0.5">Your account is stored locally — no external auth needed</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Your Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Jordan Smith"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-medium text-slate-900"
                />
              </div>
            </div>

            {/* Store Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Business / Store Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={form.store_name}
                  onChange={(e) => setForm({ ...form, store_name: e.target.value })}
                  placeholder="e.g. Apex Electronics Store"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-medium text-slate-900"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Business Email <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="e.g. you@yourbusiness.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-medium text-slate-900"
                />
              </div>
            </div>

            {/* Profile Photo */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Profile Photo
                </label>
                <button
                  type="button"
                  onClick={() => setUseCustomUrl(!useCustomUrl)}
                  className="text-[11px] font-semibold text-[#0070BA] hover:underline"
                >
                  {useCustomUrl ? 'Choose from gallery' : 'Use custom URL'}
                </button>
              </div>

              {!useCustomUrl ? (
                <div className="grid grid-cols-6 gap-2">
                  {AVATAR_PHOTOS.map((url, i) => {
                    const isSelected = form.avatar_url === url;
                    return (
                      <button
                        type="button"
                        key={i}
                        onClick={() => setForm({ ...form, avatar_url: url })}
                        className={`relative rounded-full aspect-square overflow-hidden transition-all duration-200 ${
                          isSelected ? 'ring-4 ring-[#0070BA] ring-offset-2 scale-105' : 'opacity-70 hover:opacity-100 hover:scale-105'
                        }`}
                      >
                        <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                        {isSelected && (
                          <div className="absolute inset-0 bg-[#0070BA]/30 flex items-center justify-center">
                            <Check className="w-4 h-4 text-white stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="relative">
                  <ImageIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                  <input
                    type="url"
                    value={form.avatar_url}
                    onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                    placeholder="https://your-photo-url.com/photo.jpg"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-mono text-slate-900"
                  />
                </div>
              )}
            </div>

            {/* Live Preview */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3.5">
              <div className="relative shrink-0">
                {form.avatar_url ? (
                  <img src={form.avatar_url} alt="Preview" className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow-sm" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[#0070BA] flex items-center justify-center text-white text-xl font-extrabold ring-2 ring-white shadow-sm">
                    {initials}
                  </div>
                )}
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-slate-900 truncate">
                    {form.name || 'Your Name'}
                  </span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#0070BA] shrink-0" />
                </div>
                <span className="text-xs text-slate-500 font-medium block truncate">
                  {form.store_name || 'Your Store'}
                </span>
                <span className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider block mt-0.5">
                  ● PayPal Seller Protection Active
                </span>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-6 rounded-xl bg-gradient-to-r from-[#003087] to-[#0070BA] hover:from-[#002566] hover:to-[#005a96] text-white font-bold text-sm transition-all shadow-lg shadow-blue-800/25 flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Account…</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#FFC439]" />
                  <span>Create Merchant Account & Launch</span>
                </>
              )}
            </button>

            <p className="text-center text-[11px] text-slate-400 font-medium">
              Your data is stored locally in SQLite — no external services required.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
