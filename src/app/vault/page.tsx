'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { 
  ShieldCheck, 
  FileCheck, 
  Search, 
  Hash, 
  Filter, 
  ArrowUpRight, 
  Lock, 
  RefreshCw, 
  FileText, 
  CheckCircle2, 
  Database, 
  Shield, 
  Download,
  Package,
  Truck,
  FileCode,
  ArrowLeft
} from 'lucide-react';
import { EvidenceItem } from '@/lib/types';
import EvidenceCard from '@/components/EvidenceCard';
import { useRealtime } from '@/components/RealtimeContext';

export default function EvidenceVaultPage() {
  const { lastEvent } = useRealtime();
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');

  const fetchVault = async () => {
    try {
      const res = await fetch('/api/vault');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error('Failed to fetch Evidence Vault items:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVault();
  }, [lastEvent]);

  // Periodic polling fallback
  useEffect(() => {
    const interval = setInterval(fetchVault, 5000);
    return () => clearInterval(interval);
  }, []);

  // Filter items based on type and search query
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return items.filter((item) => {
      if (selectedType !== 'ALL' && item.evidence_type !== selectedType) {
        return false;
      }
      if (!q) return true;
      return (
        item.title?.toLowerCase().includes(q) ||
        item.source?.toLowerCase().includes(q) ||
        item.evidence_type?.toLowerCase().includes(q) ||
        item.sha256_hash?.toLowerCase().includes(q) ||
        (typeof item.content === 'string' && item.content.toLowerCase().includes(q))
      );
    });
  }, [items, selectedType, searchQuery]);

  // Type stats
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: items.length,
      ORDER_CONFIRMATION: 0,
      TRACKING_HISTORY: 0,
      PROOF_OF_DELIVERY: 0,
      REFUND_POLICY: 0,
    };
    for (const item of items) {
      if (counts[item.evidence_type] !== undefined) {
        counts[item.evidence_type]++;
      } else {
        counts[item.evidence_type] = 1;
      }
    }
    return counts;
  }, [items]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      
      {/* ── Top Header Bar ── */}
      <div className="card-3d-reflection rounded-3xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            href="/"
            className="text-xs font-semibold text-slate-500 hover:text-[#003087] flex items-center gap-1 transition-colors mr-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#003087]" />
            <span>Evidence Vault</span>
          </h1>
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">
            SHA-256 Chained
          </span>
          <span className="bg-blue-50 text-[#003087] border border-blue-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
            Immutable
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <a
            href="/api/vault/dossier"
            download
            className="px-4 py-2 rounded-full bg-[#003087] hover:bg-[#001C48] text-white text-xs font-extrabold transition-all shadow-md flex items-center gap-1.5 btn-press cursor-pointer"
            title="Download Cryptographically Certified Evidence Dossier PDF"
          >
            <Download className="w-3.5 h-3.5 text-[#FFC439]" />
            <span>Export Dossier PDF</span>
          </a>

          <a
            href="/api/vault/dossier?format=json"
            download
            className="px-3.5 py-2 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            title="Export Tamper-Evident SHA-256 JSON Audit Trail"
          >
            <FileCode className="w-3.5 h-3.5 text-slate-500" />
            <span>JSON Audit</span>
          </a>

          <Link
            href="/trust-lab"
            className="px-4 py-2 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5"
            title="Inspect Trust Lab Cryptographic Penetration Vectors"
          >
            <Lock className="w-3.5 h-3.5 text-[#003087]" />
            <span>Verify Defense Gates</span>
          </Link>

          <button
            onClick={() => {
              setLoading(true);
              fetchVault();
            }}
            disabled={loading}
            className="p-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer disabled:opacity-50"
            title="Refresh Vault Records"
          >
            <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── 4 KPI Telemetry Cards — Styled & Clean ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Records */}
        <div className="card-3d-reflection rounded-3xl p-5 flex flex-col justify-between min-h-[140px] group hover:scale-[1.02] transition-transform">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Records</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-[#003087] border border-blue-100">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="my-1.5">
            <span className="text-3xl font-black text-slate-900 tracking-tight leading-none">
              {items.length}
            </span>
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active Vault
            </span>
          </div>
        </div>

        {/* Card 2: Hash Standard */}
        <div className="card-3d-reflection rounded-3xl p-5 flex flex-col justify-between min-h-[140px] group hover:scale-[1.02] transition-transform">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hash Standard</span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 flex items-center justify-center text-[#0070BA] border border-sky-100">
              <Hash className="w-4 h-4" />
            </div>
          </div>
          <div className="my-1.5">
            <span className="text-2xl font-black text-slate-900 tracking-tight font-mono leading-none">
              SHA-256
            </span>
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#003087] bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
              Tamper-Proof
            </span>
          </div>
        </div>

        {/* Card 3: Capture Latency */}
        <div className="card-3d-reflection rounded-3xl p-5 flex flex-col justify-between min-h-[140px] group hover:scale-[1.02] transition-transform">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Capture Time</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
              <FileCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="my-1.5">
            <span className="text-3xl font-black text-emerald-600 tracking-tight leading-none">
              &lt; 4s
            </span>
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              Pre-Dispute
            </span>
          </div>
        </div>

        {/* Card 4: Policy Match */}
        <div className="card-3d-reflection rounded-3xl p-5 flex flex-col justify-between min-h-[140px] group hover:scale-[1.02] transition-transform">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Policy Cited</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-[#003087] border border-indigo-100">
              <Shield className="w-4 h-4" />
            </div>
          </div>
          <div className="my-1.5">
            <span className="text-2xl font-black text-slate-900 tracking-tight leading-none">
              § 11.3 &amp; (b)
            </span>
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#0070BA] bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
              Seller Protection
            </span>
          </div>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="card-3d-reflection rounded-3xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, SKU, tracking #, or SHA-256 hash…"
              className="w-full pl-9 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#003087] focus:bg-white transition-all font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Filter Preset Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: 'ALL', label: `All (${typeCounts.ALL || 0})` },
              { id: 'ORDER_CONFIRMATION', label: `Order Receipts (${typeCounts.ORDER_CONFIRMATION || 0})` },
              { id: 'TRACKING_HISTORY', label: `Tracking (${typeCounts.TRACKING_HISTORY || 0})` },
              { id: 'PROOF_OF_DELIVERY', label: `Delivery Proof (${typeCounts.PROOF_OF_DELIVERY || 0})` },
              { id: 'REFUND_POLICY', label: `Terms & Policy (${typeCounts.REFUND_POLICY || 0})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedType(tab.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  selectedType === tab.id
                    ? 'bg-[#003087] text-white shadow-sm font-bold'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Evidence Items Grid ── */}
      {loading ? (
        <div className="card-3d-reflection bg-white p-12 rounded-3xl border border-slate-200/80 shadow-xs text-center text-slate-400">
          <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-2 text-[#003087]" />
          <p className="text-xs font-semibold">Loading cryptographic Evidence Vault...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card-3d-reflection bg-white p-12 rounded-3xl border border-slate-200/80 shadow-xs text-center text-slate-500 space-y-2">
          <FileCheck className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-800">No Evidence Records Found</p>
          <p className="text-xs text-slate-400">
            {searchQuery
              ? `No records matching "${searchQuery}". Try a different keyword.`
              : 'Create a storefront order or seed demo cases to view cryptographic records.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map((item) => (
            <EvidenceCard key={item.id} item={item} />
          ))}
        </div>
      )}

    </div>
  );
}
