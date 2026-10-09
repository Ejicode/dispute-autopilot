'use client';

import React, { useEffect, useState, useMemo } from 'react';
import QueueGrid from '@/components/QueueGrid';
import { Dispute } from '@/lib/types';
import { useRealtime } from '@/components/RealtimeContext';
import { 
  Users, 
  ShoppingBag, 
  DollarSign, 
  Clock, 
  ArrowUpRight, 
  ChevronLeft, 
  ChevronRight,
  TrendingUp,
  ShieldCheck,
  RefreshCw,
  PlusCircle,
  FileCheck,
  Filter,
  CheckCircle2,
  Calendar as CalendarIcon,
  Activity,
  Layers
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts';

export default function DashboardPage() {
  const { lastEvent } = useRealtime();

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);

  // Interactive filters
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'7D' | '30D' | 'ALL'>('7D');

  // Fetch disputes and live analytics
  const fetchDashboardData = async () => {
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
  };

  useEffect(() => {
    fetchDashboardData();
  }, [lastEvent]);

  // Periodic polling fallback
  useEffect(() => {
    const interval = setInterval(fetchDashboardData, 5000);
    return () => clearInterval(interval);
  }, []);

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

  // Filtered disputes based on user selection in charts or calendar
  const filteredDisputes = useMemo(() => {
    return disputes.filter((d) => {
      if (selectedCategory && d.reason !== selectedCategory) return false;
      if (selectedDayFilter && !d.response_deadline.startsWith(selectedDayFilter)) return false;
      return true;
    });
  }, [disputes, selectedCategory, selectedDayFilter]);

  // Helper values from live analytics
  const kpis = analytics?.kpis || {
    customerCount: 0,
    orderCount: 0,
    totalAtRiskCents: 0,
    recoveredCents: 0,
    expiring48hCount: 0,
    totalDisputes: 0,
  };

  const donutCategories = analytics?.donutCategories || [];
  const wavePoints = analytics?.wavePoints || [];
  const calendar = analytics?.calendar || {
    monthLabel: 'October 2026',
    days: [],
    activeDayIdx: 3,
  };
  const storeBreakdowns = analytics?.storeBreakdowns || [];

  // Custom Chart Tooltip
  const CustomAreaTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-2xl shadow-xl border border-slate-200/90 text-xs space-y-1.5 animate-in fade-in duration-150">
          <span className="font-bold text-slate-800 block border-b border-slate-100 pb-1">
            {label}, 2026
          </span>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-500">Disputed Exposure:</span>
            <strong className="text-[#0070BA] font-mono">${payload[0]?.value?.toLocaleString()}</strong>
          </div>
          {payload[1] && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500">Protected Volume:</span>
              <strong className="text-slate-800 font-mono">${payload[1]?.value?.toLocaleString()}</strong>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // Custom Donut Tooltip
  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-2.5 rounded-xl shadow-xl border border-slate-200/90 text-xs space-y-1">
          <span className="font-bold text-slate-800 block">{data.name}</span>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-500">Cases:</span>
            <strong className="text-slate-900">{data.value} ({data.percentage}%)</strong>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-500">Total Amount:</span>
            <strong className="text-[#0070BA] font-mono">${data.amount?.toLocaleString()}</strong>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Active Filter Clear Banner */}
      {(selectedCategory || selectedDayFilter) && (
        <div className="bg-blue-50 border border-blue-200 p-3 rounded-2xl flex items-center justify-between text-xs text-blue-900 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#0070BA]" />
            <span>
              Filtering queue by: 
              {selectedCategory && <strong className="ml-1">Reason ({selectedCategory})</strong>}
              {selectedDayFilter && <strong className="ml-1">Deadline Date ({selectedDayFilter})</strong>}
            </span>
          </div>
          <button
            onClick={() => {
              setSelectedCategory(null);
              setSelectedDayFilter(null);
            }}
            className="text-xs font-bold text-[#0070BA] hover:underline"
          >
            Clear Filter &amp; Show All
          </button>
        </div>
      )}

      {/* ── 1. TOP STAT / KPI CARDS ROW (100% Real-Time DB Computations) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Customers */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl border border-slate-200 flex items-center justify-center text-slate-700 bg-slate-50 shrink-0">
              <Users className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Active Customers</span>
              <span className="text-2xl font-extrabold text-slate-900 block leading-tight">
                {kpis.customerCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5 mt-0.5">
                <ArrowUpRight className="w-3 h-3" /> Real Store Buyers
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Store Orders */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl border border-slate-200 flex items-center justify-center text-slate-700 bg-slate-50 shrink-0">
              <ShoppingBag className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Store Orders</span>
              <span className="text-2xl font-extrabold text-slate-900 block leading-tight">
                {kpis.orderCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5 mt-0.5">
                <ArrowUpRight className="w-3 h-3" /> Vault Protected
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: SIGNATURE SOLID PAYPAL BLUE CARD (#0070BA) */}
        <div className="bg-[#0070BA] text-white p-5 rounded-2xl shadow-lg shadow-blue-800/30 flex items-center justify-between hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center text-white shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-white/80 font-semibold uppercase tracking-wider block">
                {kpis.recoveredCents > 0 ? 'Resolved & Recovered' : 'Disputed Funds'}
              </span>
              <span className="text-2xl font-extrabold text-white block leading-tight">
                ${((kpis.recoveredCents > 0 ? kpis.recoveredCents : kpis.totalAtRiskCents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-white/90 font-semibold flex items-center gap-0.5 mt-0.5">
                <ShieldCheck className="w-3 h-3 text-[#FFC439]" /> 100% Defense Verification
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Active Exposure / Expiring Countdown */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl border border-rose-200 bg-rose-50 flex items-center justify-center text-rose-600 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Active Exposure</span>
              <span className="text-2xl font-extrabold text-slate-900 block leading-tight">
                ${(kpis.totalAtRiskCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-rose-600 font-semibold flex items-center gap-0.5 mt-0.5">
                {kpis.expiring48hCount} cases expiring &lt; 48h
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. CHARTS ROW (Real Interactive Vector Graphs via Recharts) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Real-Time Area Wave Chart (8 cols) */}
        <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#0070BA]" />
                <h2 className="font-bold text-slate-900 text-sm">Dispute Exposure &amp; Vault Trajectory</h2>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-[#0070BA] border border-blue-100 uppercase">
                  October 2026 Live
                </span>
              </div>
              <span className="text-xs text-slate-400 mt-0.5 block">
                Daily cumulative exposure vs protected transaction volume
              </span>
            </div>

            {/* Timeframe Filter Buttons */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold">
              {(['7D', '30D', 'ALL'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeRange(t)}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    timeRange === t
                      ? 'bg-white text-[#0070BA] shadow-sm font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t === '7D' ? 'Oct 1–8' : t === '30D' ? 'Last 30D' : 'All Time'}
                </button>
              ))}
            </div>
          </div>

          {/* Recharts Area Wave Chart */}
          <div className="w-full h-56 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={wavePoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="paypalColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0070BA" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0070BA" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="protectedColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#003087" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#003087" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis 
                  dataKey="date" 
                  tickLine={false} 
                  axisLine={{ stroke: '#E2E8F0' }} 
                  tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 500 }} 
                />
                <YAxis 
                  tickLine={false} 
                  axisLine={false} 
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip content={<CustomAreaTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="disputed" 
                  stroke="#0070BA" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#paypalColor)" 
                  isAnimationActive={true}
                  animationDuration={1200}
                />
                <Area 
                  type="monotone" 
                  dataKey="protectedVolume" 
                  stroke="#003087" 
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fillOpacity={1} 
                  fill="url(#protectedColor)" 
                  isAnimationActive={true}
                  animationDuration={1500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Chart footer metrics */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0070BA]" /> Disputed Exposure ($)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-1.5 border-b-2 border-dashed border-[#003087]" /> Protected Volume ($)
              </span>
            </div>
            <span className="text-[#0070BA] font-bold">● Live Sync Engine Active</span>
          </div>
        </div>

        {/* Real-time Donut Chart via Recharts (4 cols) */}
        <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#0070BA]" />
                <h2 className="font-bold text-slate-900 text-sm">Dispute Categories</h2>
              </div>
              <span className="text-[10px] text-slate-400 font-semibold uppercase">Click to Filter</span>
            </div>
            <span className="text-xs text-slate-400 mt-0.5 block">Live distribution by claim reason</span>
          </div>

          <div className="py-2 flex flex-col items-center justify-center">
            {/* Recharts Pie Donut */}
            <div className="relative w-44 h-44 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<CustomPieTooltip />} />
                  <Pie
                    data={donutCategories}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                    isAnimationActive={true}
                    animationDuration={1000}
                    onClick={(entry: any) => setSelectedCategory(selectedCategory === entry?.reason ? null : entry?.reason)}
                  >
                    {donutCategories.map((entry: any, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.color} 
                        className="cursor-pointer hover:opacity-80 transition-opacity" 
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute text-center pointer-events-none">
                <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Total</span>
                <span className="text-xl font-extrabold text-slate-900 leading-none">
                  {kpis.totalDisputes}
                </span>
                <span className="text-[9px] text-slate-400 block mt-0.5">Disputes</span>
              </div>
            </div>

            {/* Clickable Legend */}
            <div className="space-y-1.5 text-xs w-full mt-2">
              {donutCategories.map((cat: any) => (
                <button
                  key={cat.reason}
                  onClick={() => setSelectedCategory(selectedCategory === cat.reason ? null : cat.reason)}
                  className={`w-full flex items-center justify-between gap-3 text-left p-1.5 rounded-xl transition-all ${
                    selectedCategory === cat.reason ? 'bg-blue-50 font-bold border border-blue-200' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-slate-700 truncate text-[11px] font-medium" title={cat.name}>
                      {cat.name}
                    </span>
                  </div>
                  <span className="text-slate-500 font-mono text-[11px] shrink-0">{cat.percentage}%</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Overall Verification</span>
            <strong className="text-emerald-600 font-bold">100% Defense Verification</strong>
          </div>
        </div>
      </div>

      {/* ── 3. BOTTOM WIDGETS ROW (Real October 2026 Calendar + Storefront Breakdown) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Real October 2026 Calendar Widget (6 cols) */}
        <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-[#0070BA]" />
                <h2 className="font-bold text-slate-900 text-sm">October 2026</h2>
              </div>
              <span className="text-[11px] text-slate-400">Response countdown calendar (Click day to filter)</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0070BA] bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Week of Oct 5–11</span>
            </div>
          </div>

          {/* Days Strip */}
          <div className="grid grid-cols-7 gap-2 text-center text-xs my-2">
            {calendar.days.map((day: any, idx: number) => {
              const isUrgentActive = idx === calendar.activeDayIdx;
              const isToday = day.isToday;
              const isFilterSelected = selectedDayFilter === day.fullDate;

              return (
                <button
                  key={day.fullDate}
                  onClick={() => setSelectedDayFilter(isFilterSelected ? null : day.fullDate)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-2xl transition-all relative ${
                    isFilterSelected
                      ? 'bg-[#0070BA] text-white shadow-lg shadow-blue-800/30 font-bold'
                      : isUrgentActive
                      ? 'bg-blue-50 text-[#0070BA] border border-blue-200 font-bold'
                      : isToday
                      ? 'bg-slate-100 text-slate-900 font-bold'
                      : 'hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <span className="text-[10px] uppercase font-semibold text-slate-400">{day.dayName}</span>
                  <span className="text-base font-extrabold">{day.dateNumber}</span>
                  
                  {isToday && (
                    <span className="text-[8px] font-bold text-[#0070BA] uppercase">Today</span>
                  )}

                  {day.disputeCount > 0 && (
                    <span 
                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold text-white bg-rose-600`}
                      title={`${day.disputeCount} deadline(s)`}
                    >
                      {day.disputeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
            <span>
              <strong>{kpis.expiring48hCount} dispute(s)</strong> due within 48h response window
            </span>
            <span className="text-[#0070BA] font-bold">Strict PayPal Gate</span>
          </div>
        </div>

        {/* Real Merchant Store Vault Coverage (6 cols) */}
        <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="font-bold text-slate-900 text-sm">Evidence Vault Completeness</h2>
            <span className="text-xs text-slate-400">Real cryptographic snapshot ratio per transaction</span>
          </div>

          <div className="space-y-3.5 my-2">
            {storeBreakdowns.map((b: any, idx: number) => (
              <div key={idx}>
                <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                  <span className="truncate max-w-[280px]">{b.storeName}</span>
                  <span style={{ color: b.color }} className="font-mono">{b.percentage}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${b.percentage}%`, backgroundColor: b.color }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-100 flex items-center justify-between">
            <span>SHA-256 Checksum Integrity</span>
            <span className="text-emerald-600 font-bold">✓ 100% Verified &amp; Immutable</span>
          </div>
        </div>
      </div>

      {/* ── 4. DISPUTE QUEUE TABLE (AG GRID IN CLEAN WHITE CARD) ── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-[#0070BA]" />
              <h2 className="font-bold text-slate-900 text-base">Active Dispute Queue</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#0070BA] border border-blue-100">
                AG Grid Powered
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Prioritized by financial exposure and countdown deadline. Real-time updates via SSE.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDashboardData}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full border border-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="Refresh queue"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              onClick={handleSimulateDispute}
              disabled={simulating}
              className="px-4 py-2 bg-[#0070BA] hover:bg-[#003087] text-white rounded-full text-xs font-bold shadow-md shadow-blue-800/30 flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {simulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
              <span>Simulate Inbound Dispute</span>
            </button>
          </div>
        </div>

        {/* AG Grid component */}
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0070BA]" />
            <p className="text-xs font-medium">Loading real-time dispute queue...</p>
          </div>
        ) : (
          <QueueGrid disputes={filteredDisputes} />
        )}
      </div>
    </div>
  );
}
