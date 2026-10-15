'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/components/UserContext';

export default function LoginPage() {
  const { login, activeUser, loading } = useUser();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!loading && activeUser) router.replace('/'); }, [loading, activeUser, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const result = await login(email, password);
    setSubmitting(false);
    if (!result.success) setError(result.error || 'Unable to sign in.');
    else router.replace('/');
  };

  return <div className="min-h-screen w-full flex items-center justify-center bg-[#EDF2F7] p-6">
    <form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white border border-slate-200 p-8 space-y-5 shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900">Sign in to Dispute Autopilot</h1>
      <p className="text-sm text-slate-600">Access your merchant workspace.</p>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div>
        <label htmlFor="email" className="block text-sm font-semibold mb-2">Email</label>
        <input id="email" type="email" autoComplete="username" required maxLength={254} value={email}
          onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-semibold mb-2">Password</label>
        <input id="password" type="password" autoComplete="current-password" required maxLength={128} value={password}
          onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3" />
      </div>
      <button disabled={submitting || loading} className="w-full rounded-xl bg-[#0070BA] py-3 font-bold text-white disabled:opacity-50">
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-sm text-slate-600">New merchant? <Link href="/register" className="text-blue-700 underline">Create an account</Link></p>
    </form>
  </div>;
}
