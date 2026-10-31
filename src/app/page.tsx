'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Dispute } from '@/lib/types';
import { useRealtime } from '@/components/RealtimeContext';
import { useAppMode } from '@/lib/runtime/mode';
import { useLatestTrustLabResults } from '@/lib/trust-lab/useLatestResults';
import { formatCurrency } from '@/lib/currency';
import { 
  TrendingUp, 
  RefreshCw, 
  PlusCircle, 
  Filter, 
  ShieldCheck, 
  CheckCircle2, 
  Clock, 
  ArrowUpRight 
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';

// AG Grid is the heaviest dependency on this page; load it after first paint.
const QueueGrid = dynamic(() => import('@/components/QueueGrid'), {
  ssr: false,
  loading: () => <div className="h-96 rounded-2xl bg-slate-100 animate-pulse" />,
});

// Static security telemetry data — hoisted outside component to avoid per-render recreation
const defenseInvariantsData = [
  { name: 'Webhook Signature Check', metric: '100% Cryptographic', status: 'Active' as const, percentage: 100, color: '#003087' },
  { name: 'Replay Protection (Idempotent)', metric: '100% Unique Lock', status: 'Active' as const, percentage: 100, color: '#0070BA' },
  { name: 'Deterministic Policy Gate', metric: '100% Enforced', status: 'Active' as const, percentage: 100, color: '#00A6E0' },
  { name: 'Evidence Vault SHA-256', metric: '100% Verified', status: 'Active' as const, percentage: 100, color: '#10B981' },
];

export default function DashboardPage() {
  const { lastEvent } = useRealtime();
  const appMode = useAppMode();
  const trustLab = useLatestTrustLabResults();
  const trustLabBlocked = trustLab?.filter((r) => r.blocked).length ?? 0;

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Interactive filters
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string | null>(null);

  // Fetch disputes and live analytics from real SQLite database
  const fetchDashboardData = useCallback(async () => {
    try {
      const [disputesRes, analyticsRes] = await Promise.all([
        fetch('/api/disputes'),
        fetch('/api/analytics'),
      ]);

      if (disputesRes.ok) {
        const dData = await disputesRes.json();
        setDisputes(dData.disputes || []);
      }

      if (analyticsRes.ok) {
        const aData = await analyticsRes.json();
        setAnalytics(aData);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData, lastEvent]);

  // Periodic polling fallback — pauses when tab is hidden to save bandwidth
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (!interval) {
        interval = setInterval(fetchDashboardData, 5000);
      }
    };
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchDashboardData(); // Refresh immediately on return
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchDashboardData]);

  const handleSimulateDispute = async () => {
    setSimulating(true);
    try {
      const reasons = [
        'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
        'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
        'UNAUTHORISED',
      ];
      const randomReason = reasons[Math.floor(Math.random() * reasons.length)];
      const amount = Math.floor(80 + Math.random() * 820) * 100;
      await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: randomReason,
          amount_cents: amount,
          hours_until_deadline: 40,
          buyer_message: 'Customer opened dispute inquiry regarding delivery status or condition.',
        }),
      });
      await fetchDashboardData();
    } finally {
      setSimulating(false);
    }
  };

  const handleSeedDemo = async () => {
    if (!window.confirm('Reset the demo? This erases every dispute, order and audit record in this workspace and reloads the sample data.')) {
      return;
    }
    setSeeding(true);
    try {
      await fetch('/api/demo/seed', { method: 'POST' });
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to seed demo:', err);
    } finally {
      setSeeding(false);
    }
  };

  // Filtered disputes based on user selection in charts or calendar
  const filteredDisputes = useMemo(() => {
    return disputes.filter((d) => {
      if (selectedCategory && d.reason !== selectedCategory) return false;
      if (selectedDayFilter && !d.response_deadline.startsWith(selectedDayFilter)) return false;
      return true;
    });
  }, [disputes, selectedCategory, selectedDayFilter]);

  // Real Database Metrics from /api/analytics
  const kpis = analytics?.kpis || {
    customerCount: 0,
    orderCount: 0,
    totalAtRiskCents: 0,
    recoveredCents: 0,
    expiring48hCount: 0,
    totalDisputes: 0,
    totalProtectedCents: 0,
    evidenceCount: 0,
  };

  // Real data calculations for 2x2 Metric Cards from SQLite
  const totalSalesDisplay = useMemo(() => {
    if (kpis.totalProtectedCents > 0) {
      return formatCurrency(kpis.totalProtectedCents, 'USD');
    }
    return '$0.00';
  }, [kpis.totalProtectedCents]);

  const totalOrdersDisplay = useMemo(() => {
    return kpis.orderCount.toLocaleString('en-US');
  }, [kpis.orderCount]);

  const totalVisitorsDisplay = useMemo(() => {
    return kpis.customerCount.toLocaleString('en-US');
  }, [kpis.customerCount]);

  const totalProductsSoldDisplay = useMemo(() => {
    return kpis.evidenceCount.toLocaleString('en-US');
  }, [kpis.evidenceCount]);

  // Volume Flow Chart Data (Live from analytics.wavePoints: At-Risk vs Protected)
  const habitData = useMemo(() => {
    const points = analytics?.wavePoints;
    if (Array.isArray(points) && points.length > 0) {
      return points.map((p: any) => ({
        month: p.date,
        soonProducts: Math.round(p.atRisk || 0),
        sales: Math.round(p.protectedVolume || (kpis.totalProtectedCents / 100)),
      }));
    }
    // No placeholder dates: an empty chart is honest until analytics load.
    return [];
  }, [analytics?.wavePoints, kpis.totalAtRiskCents, kpis.totalProtectedCents]);

  // Product / Dispute Reason Breakdown (Solid Pie Chart from live analytics.donutCategories)
  const productStatData = useMemo(() => {
    const categories = analytics?.donutCategories;
    const palette = ['#003087', '#0070BA', '#00A6E0', '#FFC439', '#10B981'];
    if (Array.isArray(categories) && categories.length > 0) {
      return categories.map((c: any, idx: number) => ({
        name: c.name || c.reason,
        value: c.value,
        percentage: c.percentage,
        amount: c.amount,
        change: `${c.percentage}% exposure`,
        color: palette[idx % palette.length],
      }));
    }
    return [
      { name: 'Active Disputes', value: kpis.totalDisputes || 1, percentage: 100, amount: Math.round(kpis.totalAtRiskCents / 100), change: 'Live DB', color: '#003087' },
    ];
  }, [analytics?.donutCategories, kpis.totalDisputes, kpis.totalAtRiskCents]);

  // Custom Tooltip for Volume Flow Chart
  const CustomHabitTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-2xl shadow-xl border border-slate-200 text-xs space-y-1.5 animate-in fade-in duration-150">
          <span className="font-bold text-slate-900 block border-b border-slate-100 pb-1">
            {label}
          </span>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-500 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#93C5FD]" /> At-Risk Exposure:
            </span>
            <strong className="text-slate-800 font-mono">${payload[0]?.value?.toLocaleString()}</strong>
          </div>
          {payload[1] && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#003087]" /> Protected Volume:
              </span>
              <strong className="text-[#003087] font-mono">${payload[1]?.value?.toLocaleString()}</strong>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // Custom Tooltip for Product Statistic Solid Pie Chart
  const CustomProductPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-2.5 rounded-xl shadow-xl border border-slate-200 text-xs space-y-1">
          <span className="font-bold text-slate-800 block">{data.name}</span>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-500">Disputes:</span>
            <strong className="text-slate-900">{data.value.toLocaleString()} ({data.percentage}%)</strong>
          </div>
          {data.amount && (
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-slate-500">Amount:</span>
              <strong className="text-[#003087]">${data.amount.toLocaleString()}</strong>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const handleFilterByCategory = (categoryName: string) => {
    let reason = categoryName;
    if (categoryName.includes('Not Received') || categoryName.includes('INR')) {
      reason = 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
    } else if (categoryName.includes('Not As Described') || categoryName.includes('SNAD')) {
      reason = 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED';
    } else if (categoryName.includes('Unauthor') || categoryName.includes('UNAUTH')) {
      reason = 'UNAUTHORISED';
    }
    setSelectedCategory((prev) => (prev === reason ? null : reason));
    setTimeout(() => {
      document.getElementById('dispute-queue-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  return (
    <div className="space-y-6">
      {/* Active Filter Clear Banner */}
      {(selectedCategory || selectedDayFilter) && (
        <div className="bg-blue-50 border border-blue-200 p-3 rounded-2xl flex items-center justify-between text-xs text-[#003087] animate-in fade-in">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#003087]" />
            <span>
              Filtering queue by: 
              {selectedCategory && <strong className="ml-1">Reason ({selectedCategory.replace(/_/g, ' ')})</strong>}
              {selectedDayFilter && <strong className="ml-1">Date ({selectedDayFilter})</strong>}
            </span>
          </div>
          <button
            onClick={() => {
              setSelectedCategory(null);
              setSelectedDayFilter(null);
            }}
            className="text-xs font-bold text-[#0070BA] hover:underline cursor-pointer"
          >
            Clear Filter &amp; Show All
          </button>
        </div>
      )}

      {/* ── Main 2-Column Dashboard Layout (Matches Reference Screenshot) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* ═══════════════════════════════════════════════════════════
            LEFT COLUMN (~68% width on desktop)
            - 2x2 Metric Cards (All fully clickable to relevant sections)
            - Paired Dual-Bar Chart ("Customer Habits / Dispute Flow")
            - Active Dispute Queue Table Card
        ═══════════════════════════════════════════════════════════ */}
        <div className="xl:col-span-8 space-y-6">
          
          {/* 2x2 Balanced Metric Cards Grid — Clickable & Interactive */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Card 1: Protected Volume -> Links to Captured Orders & Revenue Ledger */}
            <Link
              href="/storefront?tab=orders#captured-orders"
              className="card-3d-reflection-dark text-white rounded-3xl p-5 sm:p-6 flex flex-col justify-between min-h-[160px] relative group card-interactive cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all block"
              title="Click to view all Protected Orders and Revenue Ledger"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-100/90 flex items-center gap-1.5">
                  <span>Protected Volume</span>
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </span>
                {appMode && (
                  <span className="bg-[#FFC439] text-[#001C48] font-black text-[11px] px-2.5 py-0.5 rounded-full shadow-sm">
                    {appMode === 'demo' ? 'Demo data' : appMode === 'sandbox' ? 'Sandbox' : 'Live'}
                  </span>
                )}
              </div>

              <div className="my-2">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-none">
                  {totalSalesDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-blue-100/80 pt-2 border-t border-white/15">
                <span>Across {kpis.orderCount} store orders</span>
                <span className="font-bold text-emerald-300 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>Orders Ledger →</span>
                </span>
              </div>
            </Link>

            {/* Card 2: Total Orders -> Links to Captured Orders Tab */}
            <Link
              href="/storefront?tab=orders#captured-orders"
              className="card-3d-reflection rounded-3xl p-5 sm:p-6 flex flex-col justify-between min-h-[160px] group card-interactive cursor-pointer hover:scale-[1.02] active:scale-[0.98] hover:border-[#003087]/50 hover:shadow-lg transition-all block"
              title="Click to inspect Captured Orders & Carrier Tracking Ledger"
            >
              <div className="flex items-center justify-between relative z-10">
                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <span>Total Orders</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#003087] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </span>
              </div>

              <div className="my-2 relative z-10">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 leading-none">
                  {totalOrdersDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 font-medium pt-2 border-t border-slate-100 relative z-10">
                <span>Store transactions</span>
                <span className="text-[#0070BA] font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                  <span>View Orders Ledger →</span>
                </span>
              </div>
            </Link>

            {/* Card 3: Unique Customers -> Links to Customer Directory Tab */}
            <Link
              href="/storefront?tab=customers"
              className="card-3d-reflection rounded-3xl p-5 sm:p-6 flex flex-col justify-between min-h-[160px] group card-interactive cursor-pointer hover:scale-[1.02] active:scale-[0.98] hover:border-[#003087]/50 hover:shadow-lg transition-all block"
              title="Click to view Customer Directory & Verified Buyer Profiles"
            >
              <div className="flex items-center justify-between relative z-10">
                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <span>Unique Customers</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#003087] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </span>
              </div>

              <div className="my-2 relative z-10">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 leading-none">
                  {totalVisitorsDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 font-medium pt-2 border-t border-slate-100 relative z-10">
                <span>Active buyer accounts</span>
                <span className="text-emerald-600 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                  <span>Customer Directory →</span>
                </span>
              </div>
            </Link>

            {/* Card 4: Evidence Vault -> Links to dedicated /vault page */}
            <Link
              href="/vault"
              className="card-3d-reflection rounded-3xl p-5 sm:p-6 flex flex-col justify-between min-h-[160px] group card-interactive cursor-pointer hover:scale-[1.02] active:scale-[0.98] hover:border-[#003087]/50 hover:shadow-lg transition-all block"
              title="Click to open the Evidence Vault & inspect all SHA-256 cryptographic records"
            >
              <div className="flex items-center justify-between relative z-10">
                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <span>Evidence Vault</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#003087] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </span>
              </div>

              <div className="my-2 relative z-10">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 leading-none">
                  {totalProductsSoldDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 font-medium pt-2 border-t border-slate-100 relative z-10">
                <span>Cryptographic proof</span>
                <span className="text-[#0070BA] font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                  <span>Open Evidence Vault →</span>
                </span>
              </div>
            </Link>

          </div>

          {/* ── Dispute & Volume Flow Dual Capsule Bar Chart (With 3D Specular Reflection) ── */}
          <div className="card-3d-reflection rounded-3xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  Dispute &amp; Volume Flow
                </h2>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                {/* The analytics API returns the last 8 days, cumulative */}
                <span className="px-3 py-1.5 rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                  Last 8 days · cumulative
                </span>

                {/* Legend Indicators */}
                <div className="flex items-center gap-4 text-xs font-bold text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#93C5FD]" />
                    <span>At-Risk ($)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#003087]" />
                    <span>Protected ($)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Capsule Bar Chart */}
            <div className="w-full h-72 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={habitData} 
                  barGap={8} 
                  barSize={14} 
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis 
                    dataKey="month" 
                    tickLine={false} 
                    axisLine={{ stroke: '#E2E8F0' }} 
                    tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 600 }} 
                  />
                  <YAxis 
                    tickFormatter={(v) => (v >= 1000 ? `$${Number((v / 1000).toFixed(1))}K` : `$${v}`)}
                    tickLine={false} 
                    axisLine={false} 
                    tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 500 }}
                  />
                  <Tooltip content={<CustomHabitTooltip />} />
                  {/* Sky Blue Capsule Bar for At-Risk Exposure */}
                  <Bar 
                    dataKey="soonProducts" 
                    fill="#93C5FD" 
                    radius={[12, 12, 12, 12]} 
                    isAnimationActive={true}
                    animationDuration={1000}
                  />
                  {/* PayPal Deep Navy Capsule Bar for Protected Volume */}
                  <Bar 
                    dataKey="sales" 
                    fill="#003087" 
                    radius={[12, 12, 12, 12]} 
                    isAnimationActive={true}
                    animationDuration={1200}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* ─────────────────────────────────────────────────────────
            RIGHT COLUMN (~32% on Desktop)
            - Top: Product Statistic (Sage-Green Gradient + Solid Pie Chart)
            - Bottom: Customer Growth (4 Overlapping Bubbles + Country Progress Bars)
        ───────────────────────────────────────────────────────── */}
        <div className="xl:col-span-4 space-y-6">

          {/* ── Top Card: Dispute Reason Exposure (Solid Pie Chart with 3D Reflection) ── */}
          <div className="card-3d-reflection rounded-3xl p-6 space-y-4 hover:-translate-y-1 transition-all duration-300">
            <div>
              <h3 className="text-base font-black text-[#003087] tracking-tight">
                Dispute Reason Exposure
              </h3>
            </div>

            {/* Solid Pie Chart (Filled center, not a donut) */}
            <div className="relative w-44 h-44 mx-auto flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<CustomProductPieTooltip />} />
                  <Pie
                    data={productStatData}
                    cx="50%"
                    cy="50%"
                    innerRadius={0}
                    outerRadius={72}
                    dataKey="value"
                    stroke="#EFF6FF"
                    strokeWidth={2}
                    isAnimationActive={true}
                    animationDuration={1000}
                  >
                    {productStatData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.color} 
                        className="cursor-pointer hover:opacity-80 transition-opacity" 
                        onClick={() => handleFilterByCategory(entry.name)}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Product Category Rows: INR, SNAD, Unauthorised (Clickable Filter Buttons) */}
            <div className="space-y-2.5 pt-1">
              {productStatData.map((item) => {
                const isSelected = selectedCategory && (
                  (item.name.includes('Received') && selectedCategory === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') ||
                  (item.name.includes('Described') && selectedCategory === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') ||
                  (item.name.includes('Unauthor') && selectedCategory === 'UNAUTHORISED')
                );

                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => handleFilterByCategory(item.name)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-2xl transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'card-3d-reflection-subtle border-2 border-[#003087] shadow-sm scale-[1.01]'
                        : 'card-3d-reflection-subtle hover:border-slate-300'
                    }`}
                    title={`Click to filter Dispute Queue by ${item.name}`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className={`text-xs font-semibold truncate ${isSelected ? 'text-[#003087] font-bold' : 'text-slate-800'}`}>
                        {item.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-black text-slate-900">{item.value.toLocaleString()} {item.value === 1 ? 'case' : 'cases'}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-[#003087] text-white' : 'bg-blue-100 text-[#003087]'}`}>
                        {isSelected ? 'Filtered ✓' : item.change}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Bottom Card: Security Defense Coverage (Clickable Link to Trust Lab) ── */}
          <Link
            href="/trust-lab"
            className="card-3d-reflection rounded-3xl p-6 space-y-5 hover:-translate-y-1 hover:border-[#003087]/50 transition-all duration-300 block cursor-pointer group"
            title="Click to run Trust Lab penetration attack suite"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Security Defense Coverage</span>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-[#003087] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </h3>
              {trustLab && trustLab.length > 0 && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  trustLabBlocked === trustLab.length
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}>
                  {trustLabBlocked}/{trustLab.length} BLOCKED
                </span>
              )}
            </div>

            {/* Latest Trust Lab result per attack */}
            {!trustLab ? (
              <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
            ) : trustLab.length === 0 ? (
              <p className="text-xs text-slate-500 leading-relaxed">
                The attack suite has not been run in this workspace yet. Open the Trust Lab to run all six attacks against the real defenses.
              </p>
            ) : (
              <div className="space-y-3 pt-1 border-t border-slate-100">
                {trustLab.map((attack) => (
                  <div key={attack.name} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold text-slate-700">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${attack.blocked ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span className="truncate">{attack.name}</span>
                      </span>
                      <span className={`font-extrabold text-[11px] shrink-0 ${attack.blocked ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {attack.blocked ? 'Blocked' : 'Not blocked'} · HTTP {attack.httpStatus}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className={`h-full w-full rounded-full ${attack.blocked ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Link>

        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════════
          LIVE DISPUTE QUEUE & REAL-TIME ADJUDICATION
          (Full width, live database records, zero AI icons with 3D Reflection)
      ═══════════════════════════════════════════════════════════ */}
      <div id="dispute-queue-section" className="card-3d-reflection rounded-3xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-900 tracking-tight">
                Dispute Adjudication &amp; Live Queue
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#E6F0FA] text-[#003087] border border-[#C9E0FA]">
                {filteredDisputes.length} Cases
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Prioritized by financial exposure and response deadline
              {appMode === 'demo' && ' · simulated disputes'}
              {(appMode === 'sandbox' || appMode === 'live') && ' · updated from verified PayPal webhooks'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSeedDemo}
              disabled={seeding}
              className="px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              title="Reset Demo Cases"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${seeding ? 'animate-spin' : ''}`} />
              <span>Seed Demo</span>
            </button>

            <button
              onClick={handleSimulateDispute}
              disabled={simulating}
              className="px-4 py-2 rounded-full bg-[#003087] hover:bg-[#001C48] text-white text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <PlusCircle className={`w-3.5 h-3.5 text-[#FFC439] ${simulating ? 'animate-spin' : ''}`} />
              <span>Simulate Dispute</span>
            </button>
          </div>
        </div>

        {/* AG Grid Component */}
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#003087]" />
            <p className="text-xs font-medium">Loading real-time dispute queue...</p>
          </div>
        ) : (
          <QueueGrid disputes={filteredDisputes} />
        )}
      </div>

    </div>
  );
}
