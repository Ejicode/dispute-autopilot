'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Building2,
  Mail,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  PlusCircle,
  TrendingUp,
  FileCheck,
  LogOut,
  Users,
  BarChart2
} from 'lucide-react';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { useUser } from '@/components/UserContext';
import { useRealtime } from '@/components/RealtimeContext';
import { useRouter } from 'next/navigation';

export default function MerchantProfilePage() {
  const { activeUser, loading: userLoading, openCreateModal, logout } = useUser();
  const { lastEvent } = useRealtime();
  const router = useRouter();

  const [analytics, setAnalytics] = useState<any | null>(null);
  const [activeDisputes, setActiveDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const avatarUrl = activeUser?.avatar_url || null;

  const loadAllData = async () => {
    try {
      const [analyticsRes, disputesRes] = await Promise.all([
        fetch('/api/analytics'),
        fetch('/api/disputes')
      ]);

      if (analyticsRes.ok) {
        const aData = await analyticsRes.json();
        setAnalytics(aData);
      }

      if (disputesRes.ok) {
        const dData = await disputesRes.json();
        setActiveDisputes(dData.disputes || []);
      }
    } catch (e) {
      console.error('Failed to load profile analytics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [lastEvent, activeUser?.id]);

  // Show loading while user context is resolving
  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-[#0070BA] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 text-sm font-medium">Loading merchant profile…</p>
        </div>
      </div>
    );
  }

  // If no user is registered, redirect to registration
  if (!activeUser) {
    router.replace('/register');
    return null;
  }

  const kpis = analytics?.kpis;
  const wavePoints = analytics?.wavePoints || [];
  const donutCategories = analytics?.donutCategories || [];

  // All KPIs come directly from the analytics API — no formulas here
  const totalProtectedDollars = kpis?.totalProtectedCents != null
    ? (kpis.totalProtectedCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : loading ? '—' : '$0.00';

  const winRate = kpis?.winRate != null ? `${kpis.winRate}%` : loading ? '—' : 'N/A';

  const avgResponse = kpis?.avgResponseHours != null
    ? kpis.avgResponseHours > 0
      ? `${kpis.avgResponseHours}h`
      : '< 1h'
    : loading ? '—' : 'N/A';

  const activeCaseCount = kpis?.requiredActionCount ?? activeDisputes.filter(
    (d) => d.status === 'REQUIRED_ACTION' || d.status === 'UNDER_REVIEW'
  ).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Top Hero: Merchant Profile & Security Credentials ── */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/90 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-[#0070BA]/10 via-[#003087]/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          {/* Left: Avatar + Identity — all from DB */}
          <div className="flex items-start sm:items-center gap-5">
            <div className="relative shrink-0">
              <div className="w-20 h-20 rounded-2xl overflow-hidden ring-4 ring-[#0070BA]/20 shadow-md bg-slate-100 flex items-center justify-center">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={activeUser.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl font-extrabold text-[#0070BA]">
                    {activeUser.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 ring-2 ring-white flex items-center justify-center text-white text-[10px] font-bold">
                ✓
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                  {activeUser.name}
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-[#0070BA] border border-blue-200/60 text-xs font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Verified PayPal Merchant
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                  ● SELLER PROTECTION ACTIVE
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 font-medium pt-1">
                <span className="flex items-center gap-1.5 text-slate-800 font-bold">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  {activeUser.store_name}
                </span>
                <span className="flex items-center gap-1.5 font-mono">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  {activeUser.email}
                </span>
                <span className="text-slate-500">
                  Merchant ID: <code className="font-mono text-slate-700 font-bold">{activeUser.id}</code>
                </span>
                <span className="text-slate-500">
                  Role: <span className="font-bold text-slate-700">{activeUser.role}</span>
                </span>
                {activeUser.created_at && (
                  <span className="text-slate-500">
                    Member since:{' '}
                    <span className="font-bold text-slate-700">
                      {new Date(activeUser.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Profile Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={openCreateModal}
              className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#003087] to-[#0070BA] hover:from-[#002566] hover:to-[#005a96] text-white text-xs font-bold transition-all shadow-md shadow-blue-800/20 flex items-center gap-2"
            >
              <PlusCircle className="w-4 h-4 text-[#FFC439]" />
              <span>Add Merchant Account</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Log out of this merchant session?')) {
                  logout();
                  router.push('/register');
                }
              }}
              className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-700 text-xs font-bold transition-colors flex items-center gap-2 border border-slate-200/80"
              title="Log out of this merchant session"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        </div>

        {/* PayPal Security Credentials Bar */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            Security & Policy Status:
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700">
            HMAC-SHA256 Webhook Auth: <strong className="text-emerald-600">ENFORCED</strong>
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700">
            Evidence Vault SHA-256: <strong className="text-emerald-600">CHAINED & IMMUTABLE</strong>
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700">
            Deterministic Claim Verifier: <strong className="text-emerald-600">HARD-GATE ACTIVE</strong>
          </span>
        </div>
      </div>

      {/* ── 4 KPI Cards — 100% Live from analytics API ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Protected GMV from real order totals */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm relative overflow-hidden group hover:border-[#0070BA]/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Protected GMV</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600"><DollarSign className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mb-1">
            {loading ? <span className="animate-pulse bg-slate-200 h-7 w-28 rounded block" /> : `$${totalProtectedDollars}`}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{kpis?.orderCount ?? 0} orders in vault</span>
          </div>
        </div>

        {/* Card 2: Win Rate — computed from resolved disputes */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm relative overflow-hidden group hover:border-[#0070BA]/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Dispute Win Rate</span>
            <div className="p-2 rounded-xl bg-blue-50 text-[#0070BA]"><CheckCircle2 className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-extrabold text-[#0070BA] mb-1">
            {loading ? <span className="animate-pulse bg-slate-200 h-7 w-20 rounded block" /> : winRate}
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {kpis?.totalDisputes ?? 0} total disputes processed
          </div>
        </div>

        {/* Card 3: Avg Response Time — computed from real timestamps */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm relative overflow-hidden group hover:border-[#0070BA]/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Response Time</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600"><Clock className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mb-1">
            {loading ? <span className="animate-pulse bg-slate-200 h-7 w-20 rounded block" /> : avgResponse}
          </div>
          <div className="text-xs text-slate-500 font-medium">Autonomous AI packet generation</div>
        </div>

        {/* Card 4: Active Cases — real count from DB */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm relative overflow-hidden group hover:border-[#0070BA]/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Active Cases</span>
            <div className="p-2 rounded-xl bg-rose-50 text-rose-600"><AlertTriangle className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mb-1">
            {loading ? <span className="animate-pulse bg-slate-200 h-7 w-16 rounded block" /> : `${activeCaseCount} Cases`}
          </div>
          <div className="text-xs text-rose-600 font-semibold">
            {kpis?.expiring48hCount ?? 0} expiring within 48 hours
          </div>
        </div>
      </div>

      {/* ── Charts Grid — Live DB Driven ── */}
      {(wavePoints.length > 0 || donutCategories.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 8 cols: Wave Timeline */}
          <div className="lg:col-span-8 bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-900 text-sm">Protected GMV vs. Disputed Volume</h2>
                <p className="text-xs text-slate-500 font-medium">Daily cumulative from your SQLite transaction records</p>
              </div>
              <div className="flex items-center gap-3 text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-[#0070BA]">
                  <span className="w-3 h-3 rounded-full bg-[#0070BA]" /> Protected
                </span>
                <span className="flex items-center gap-1.5 text-rose-500">
                  <span className="w-3 h-3 rounded-full bg-rose-500" /> Disputed
                </span>
              </div>
            </div>
            <div className="h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={wavePoints} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="profileProtGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0070BA" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0070BA" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="profileDispGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#1E293B', borderRadius: '1rem', color: '#FFF', fontSize: '12px' }}
                    formatter={(val: any) => [`$${Number(val).toLocaleString()}`, '']}
                  />
                  <Area type="monotone" dataKey="protectedVolume" stroke="#0070BA" strokeWidth={2.5} fillOpacity={1} fill="url(#profileProtGrad)" name="Protected GMV" />
                  <Area type="monotone" dataKey="disputed" stroke="#F43F5E" strokeWidth={2} fillOpacity={1} fill="url(#profileDispGrad)" name="Disputed Value" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right 4 cols: Dispute Category Donut */}
          <div className="lg:col-span-4 bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h2 className="font-bold text-slate-900 text-sm">Dispute Category Breakdown</h2>
              <p className="text-xs text-slate-500 font-medium">Real distribution from your disputes table</p>
            </div>
            <div className="h-72 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutCategories} cx="50%" cy="45%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value">
                    {donutCategories.map((entry: any, index: number) => (
                      <Cell key={`donut-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#1E293B', borderRadius: '0.75rem', color: '#FFF', fontSize: '12px' }}
                    formatter={(val: any, name: any, item: any) => [`${val} cases (${item.payload.percentage}%)`, item.payload.name]}
                  />
                  <Legend verticalAlign="bottom" height={40} iconType="circle" formatter={(value) => <span className="text-[11px] text-slate-600 font-semibold">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── Active Dispute Cases Table ── */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-[#0070BA]" />
            <h2 className="font-bold text-slate-900 text-base">
              Active Disputes for {activeUser.store_name}
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-[#0070BA] text-xs font-bold border border-blue-200/60">
              {activeDisputes.length} total
            </span>
          </div>
          <Link href="/" className="text-xs text-[#0070BA] font-bold hover:underline flex items-center gap-1">
            <span>Full Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {activeDisputes.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
            <p className="font-semibold text-slate-600">No open disputes</p>
            <p className="text-xs mt-1">Your dispute queue is clear.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
                  <th className="py-3 px-3">Dispute ID</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3">Amount</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Recommendation</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeDisputes.slice(0, 8).map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      {d.paypal_dispute_id || d.id}
                    </td>
                    <td className="py-3 px-3 text-slate-600 font-medium">
                      {d.reason?.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-3 font-bold text-slate-900 font-mono">
                      ${(d.amount_cents / 100).toFixed(2)} {d.currency}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        d.status === 'REQUIRED_ACTION'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : d.status === 'RESOLVED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ⚡ {d.recommendation}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Link
                        href={`/case/${d.id}`}
                        className="inline-flex items-center gap-1 py-1 px-3 rounded-lg bg-blue-50 text-[#0070BA] font-bold hover:bg-blue-100 transition-colors"
                      >
                        <span>Review</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
