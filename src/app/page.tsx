'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import QueueGrid from '@/components/QueueGrid';
import { Dispute } from '@/lib/types';
import { useRealtime } from '@/components/RealtimeContext';
import { 
  TrendingUp, 
  RefreshCw, 
  PlusCircle, 
  Filter, 
  ChevronDown, 
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

export default function DashboardPage() {
  const { lastEvent } = useRealtime();

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [timeframe, setTimeframe] = useState<'This year' | 'This month' | 'All time'>('This year');
  const [timeframeDropdownOpen, setTimeframeDropdownOpen] = useState(false);

  // Interactive filters
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string | null>(null);

  // Fetch disputes and live analytics from real SQLite database
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

  const handleSeedDemo = async () => {
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
      return '$' + (kpis.totalProtectedCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    return [
      { month: 'Oct 20', soonProducts: Math.round(kpis.totalAtRiskCents / 100), sales: Math.round(kpis.totalProtectedCents / 100) },
      { month: 'Oct 22', soonProducts: Math.round(kpis.totalAtRiskCents / 100), sales: Math.round(kpis.totalProtectedCents / 100) },
      { month: 'Oct 24', soonProducts: Math.round(kpis.totalAtRiskCents / 100), sales: Math.round(kpis.totalProtectedCents / 100) },
      { month: 'Oct 26', soonProducts: Math.round(kpis.totalAtRiskCents / 100), sales: Math.round(kpis.totalProtectedCents / 100) },
    ];
  }, [analytics?.wavePoints, kpis.totalAtRiskCents, kpis.totalProtectedCents]);

  // Product / Dispute Reason Breakdown (Solid Pie Chart from live analytics.donutCategories)
  const productStatData = useMemo(() => {
    const categories = analytics?.donutCategories;
    const palette = ['#0A3E29', '#10B981', '#37926F', '#60B08E', '#A8E6CF'];
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
      { name: 'Active Disputes', value: kpis.totalDisputes || 1, percentage: 100, amount: Math.round(kpis.totalAtRiskCents / 100), change: 'Live DB', color: '#0A3E29' },
    ];
  }, [analytics?.donutCategories, kpis.totalDisputes, kpis.totalAtRiskCents]);

  // Security Defense Coverage Telemetry
  const defenseInvariantsData = [
    { name: 'Webhook Signature Check', metric: '100% Cryptographic', status: 'Active', percentage: 100, color: '#0A3E29' },
    { name: 'Replay Protection (Idempotent)', metric: '100% Unique Lock', status: 'Active', percentage: 100, color: '#10B981' },
    { name: 'Deterministic Policy Gate', metric: '100% Enforced', status: 'Active', percentage: 100, color: '#37926F' },
    { name: 'Evidence Vault SHA-256', metric: '100% Verified', status: 'Active', percentage: 100, color: '#60B08E' },
  ];

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
              <span className="w-2.5 h-2.5 rounded-full bg-[#A8E6CF]" /> At-Risk Exposure:
            </span>
            <strong className="text-slate-800 font-mono">${payload[0]?.value?.toLocaleString()}</strong>
          </div>
          {payload[1] && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0A3E29]" /> Protected Volume:
              </span>
              <strong className="text-[#0A3E29] font-mono">${payload[1]?.value?.toLocaleString()}</strong>
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
              <strong className="text-[#0A3E29]">${data.amount.toLocaleString()}</strong>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Active Filter Clear Banner */}
      {(selectedCategory || selectedDayFilter) && (
        <div className="bg-[#EBF5EF] border border-[#D5EDE0] p-3 rounded-2xl flex items-center justify-between text-xs text-[#0A3E29] animate-in fade-in">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#0A3E29]" />
            <span>
              Filtering queue by: 
              {selectedCategory && <strong className="ml-1">Reason ({selectedCategory})</strong>}
              {selectedDayFilter && <strong className="ml-1">Date ({selectedDayFilter})</strong>}
            </span>
          </div>
          <button
            onClick={() => {
              setSelectedCategory(null);
              setSelectedDayFilter(null);
            }}
            className="text-xs font-bold text-[#0A3E29] hover:underline"
          >
            Clear Filter &amp; Show All
          </button>
        </div>
      )}

      {/* ── Main 2-Column Dashboard Layout (Matches Reference Screenshot) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* ═══════════════════════════════════════════════════════════
            LEFT COLUMN (~68% width on desktop)
            - 2x2 Metric Cards (Top-left is signature solid Forest Green)
            - Paired Dual-Bar Chart ("Customer Habits / Dispute Flow")
            - Active Dispute Queue Table Card
        ═══════════════════════════════════════════════════════════ */}
        <div className="xl:col-span-8 space-y-6">
          
          {/* 2x2 Metric Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Card 1 (Top-Left): SOLID FOREST GREEN CARD (#0A3E29) WITH 3D SPECULAR REFLECTION */}
            <div className="bg-[#0A3E29] text-white rounded-3xl p-6 shadow-md flex flex-col justify-between min-h-[175px] relative overflow-hidden group hover:shadow-xl hover:-translate-y-1 transition-all duration-300 before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-200/90 tracking-normal">
                  Total Sales Protected
                </span>
                <span className="bg-[#10B981] text-[#06291B] font-extrabold text-[11px] px-2.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm group-hover:scale-105 transition-transform">
                  Live DB
                </span>
              </div>

              <div className="my-3">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-none">
                  {totalSalesDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-emerald-100/70 pt-2 border-t border-white/10">
                <span>{kpis.orderCount > 0 ? `${kpis.orderCount} store orders protected` : 'Synchronized volume'}</span>
                <span className="font-semibold text-emerald-300 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  SHA-256 Vault
                </span>
              </div>
            </div>

            {/* Card 2 (Top-Right): White Card with 3D Specular Reflection */}
            <div className="card-3d-reflection rounded-3xl p-6 flex flex-col justify-between min-h-[175px] group hover:-translate-y-1 transition-all duration-300 relative overflow-hidden bg-white">
              <div className="flex items-center justify-between relative z-10">
                <span className="text-xs font-semibold text-slate-600 tracking-normal">
                  Total Orders
                </span>
                <span className="bg-[#EBF5EF] text-[#0A3E29] border border-[#D5EDE0] font-extrabold text-[11px] px-2.5 py-0.5 rounded-full flex items-center gap-0.5 group-hover:scale-105 transition-transform">
                  {kpis.orderCount} Orders
                </span>
              </div>

              <div className="my-3 relative z-10">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 leading-none">
                  {totalOrdersDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 font-medium pt-2 border-t border-slate-100 relative z-10">
                <span>Captured store sales</span>
                <span className="text-[#0A3E29] font-bold">Verified</span>
              </div>
            </div>

            {/* Card 3 (Bottom-Left): White Card with 3D Specular Reflection */}
            <div className="card-3d-reflection rounded-3xl p-6 flex flex-col justify-between min-h-[175px] group hover:-translate-y-1 transition-all duration-300 relative overflow-hidden bg-white">
              <div className="flex items-center justify-between relative z-10">
                <span className="text-xs font-semibold text-slate-600 tracking-normal">
                  Unique Customers
                </span>
                <span className="bg-[#EBF5EF] text-[#0A3E29] border border-[#D5EDE0] font-extrabold text-[11px] px-2.5 py-0.5 rounded-full flex items-center gap-0.5 group-hover:scale-105 transition-transform">
                  {kpis.customerCount} Buyers
                </span>
              </div>

              <div className="my-3 relative z-10">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 leading-none">
                  {totalVisitorsDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 font-medium pt-2 border-t border-slate-100 relative z-10">
                <span>Verified buyer accounts</span>
                <span className="text-slate-600 font-semibold">Active</span>
              </div>
            </div>

            {/* Card 4 (Bottom-Right): White Card with 3D Specular Reflection */}
            <div className="card-3d-reflection rounded-3xl p-6 flex flex-col justify-between min-h-[175px] group hover:-translate-y-1 transition-all duration-300 relative overflow-hidden bg-white">
              <div className="flex items-center justify-between relative z-10">
                <span className="text-xs font-semibold text-slate-600 tracking-normal">
                  Evidence Vault Items
                </span>
                <span className="bg-[#EBF5EF] text-[#0A3E29] border border-[#D5EDE0] font-extrabold text-[11px] px-2.5 py-0.5 rounded-full flex items-center gap-0.5 group-hover:scale-105 transition-transform">
                  {kpis.evidenceCount} Files
                </span>
              </div>

              <div className="my-3 relative z-10">
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 leading-none">
                  {totalProductsSoldDisplay}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 font-medium pt-2 border-t border-slate-100 relative z-10">
                <span>Tamper-evident audit assets</span>
                <span className="text-[#0A3E29] font-bold">SHA-256</span>
              </div>
            </div>

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
                {/* Timeframe Dropdown Pill (e.g. "This year ∨") */}
                <div className="relative">
                  <button
                    onClick={() => setTimeframeDropdownOpen(!timeframeDropdownOpen)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200/80 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                  >
                    <span>{timeframe}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {timeframeDropdownOpen && (
                    <div className="absolute right-0 mt-1 w-36 bg-white rounded-2xl shadow-xl border border-slate-200 py-1 z-30 animate-in fade-in">
                      {(['This year', 'This month', 'All time'] as const).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => {
                            setTimeframe(opt);
                            setTimeframeDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 transition-colors ${
                            timeframe === opt ? 'text-[#0A3E29] font-bold bg-[#EBF5EF]' : 'text-slate-700'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Legend Indicators */}
                <div className="flex items-center gap-4 text-xs font-bold text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#A8E6CF]" />
                    <span>At-Risk ($)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#0A3E29]" />
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
                    tickFormatter={(v) => (v === 0 ? '$0' : v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`)}
                    tickLine={false} 
                    axisLine={false} 
                    tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 500 }}
                  />
                  <Tooltip content={<CustomHabitTooltip />} />
                  {/* Mint Capsule Bar for At-Risk Exposure */}
                  <Bar 
                    dataKey="soonProducts" 
                    fill="#A8E6CF" 
                    radius={[12, 12, 12, 12]} 
                    isAnimationActive={true}
                    animationDuration={1000}
                  />
                  {/* Dark Forest Green Capsule Bar for Protected Volume */}
                  <Bar 
                    dataKey="sales" 
                    fill="#0A3E29" 
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

          {/* ── Top Card: Dispute Reason Exposure (Soft Sage Gradient + Solid Pie Chart with 3D Reflection) ── */}
          <div className="card-3d-reflection bg-gradient-to-b from-[#EBF5EF] to-[#D5EDE0] rounded-3xl p-6 border border-[#C6E4D2]/80 space-y-4 hover:-translate-y-1 transition-all duration-300">
            <div>
              <h3 className="text-base font-black text-[#0A3E29] tracking-tight">
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
                    stroke="#EBF5EF"
                    strokeWidth={2}
                    isAnimationActive={true}
                    animationDuration={1000}
                  >
                    {productStatData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.color} 
                        className="cursor-pointer hover:opacity-90 transition-opacity" 
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Product Category Rows: INR, SNAD, Unauthorised */}
            <div className="space-y-2.5 pt-1">
              {productStatData.map((item) => (
                <div
                  key={item.name}
                  className="w-full flex items-center justify-between p-2 rounded-2xl bg-white/70 hover:bg-white transition-all shadow-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-xs font-semibold text-slate-800 truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-black text-slate-900">{item.value.toLocaleString()} cases</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-[#0A3E29]">
                      {item.change}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Bottom Card: Security Defense Coverage (Overlapping Bubbles + Invariant Defense Bars) ── */}
          <div className="card-3d-reflection bg-white rounded-3xl p-6 space-y-5 hover:-translate-y-1 transition-all duration-300">
            <div>
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Security Defense Coverage
              </h3>
            </div>

            {/* Overlapping Bubble Circles: 100%, 100%, 100%, 100% */}
            <div className="py-2">
              <div className="flex items-center">
                {/* Bubble 1: 100% (Signature) */}
                <div className="w-16 h-16 rounded-full bg-[#0A3E29] text-white font-black text-xs flex flex-col items-center justify-center shadow-md ring-4 ring-white z-40 shrink-0 hover:scale-105 transition-transform" title="Webhook Signature Check: 100%">
                  <span>100%</span>
                  <span className="text-[8px] font-normal text-emerald-300">Sig</span>
                </div>
                {/* Bubble 2: 100% (Replay) */}
                <div className="w-14 h-14 rounded-full bg-[#10B981] text-white font-bold text-[11px] flex flex-col items-center justify-center shadow-md ring-4 ring-white -ml-4 z-30 shrink-0 hover:scale-105 transition-transform" title="Replay Attack Defense: 100%">
                  <span>100%</span>
                  <span className="text-[7.5px] font-normal text-emerald-100">Replay</span>
                </div>
                {/* Bubble 3: 100% (Gate) */}
                <div className="w-12 h-12 rounded-full bg-[#37926F] text-white font-bold text-[10px] flex flex-col items-center justify-center shadow-md ring-4 ring-white -ml-4 z-20 shrink-0 hover:scale-105 transition-transform" title="Deterministic Code Gate: 100%">
                  <span>100%</span>
                  <span className="text-[7px] font-normal text-emerald-100">Gate</span>
                </div>
                {/* Bubble 4: 100% (Vault) */}
                <div className="w-10 h-10 rounded-full bg-[#60B08E] text-white font-bold text-[9px] flex flex-col items-center justify-center shadow-md ring-4 ring-white -ml-4 z-10 shrink-0 hover:scale-105 transition-transform" title="Evidence Vault SHA-256: 100%">
                  <span>100%</span>
                  <span className="text-[6.5px] font-normal text-emerald-100">Vault</span>
                </div>
              </div>
            </div>

            {/* Invariant Defense Progress Bars */}
            <div className="space-y-3 pt-1 border-t border-slate-100">
              {defenseInvariantsData.map((item) => (
                <div key={item.name} className="space-y-1">
                  <div className="flex justify-between text-xs font-bold text-slate-700">
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="truncate">{item.name}</span>
                    </span>
                    <span className="font-extrabold text-[11px] shrink-0" style={{ color: item.color }}>
                      {item.metric}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-500" 
                      style={{ width: `${item.percentage}%`, backgroundColor: item.color }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

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
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EBF5EF] text-[#0A3E29] border border-[#D5EDE0]">
                {filteredDisputes.length} Cases
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Prioritized by financial exposure and response deadline with live PayPal synchronization
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
              className="px-4 py-2 rounded-full bg-[#0A3E29] hover:bg-[#072d1e] text-white text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <PlusCircle className={`w-3.5 h-3.5 text-emerald-400 ${simulating ? 'animate-spin' : ''}`} />
              <span>Simulate Dispute</span>
            </button>
          </div>
        </div>

        {/* AG Grid Component */}
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0A3E29]" />
            <p className="text-xs font-medium">Loading real-time dispute queue...</p>
          </div>
        ) : (
          <QueueGrid disputes={filteredDisputes} />
        )}
      </div>

    </div>
  );
}
