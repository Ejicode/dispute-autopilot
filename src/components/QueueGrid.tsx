'use client';

import React, { useMemo, useState, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, RowClickedEvent } from 'ag-grid-community';
import Link from 'next/link';
import { Dispute } from '@/lib/types';
import {
  AlertCircle,
  Clock,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Search,
  Filter,
  Download,
  Flame,
  Scale,
  FileCheck,
  X,
  FileText,
  DollarSign,
  ChevronRight,
  Eye,
  SlidersHorizontal
} from 'lucide-react';

interface QueueGridProps {
  disputes: Dispute[];
}

export default function QueueGrid({ disputes }: QueueGridProps) {
  const gridRef = useRef<AgGridReact<Dispute>>(null);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [activeFilterPreset, setActiveFilterPreset] = useState<'ALL' | 'URGENT' | 'HIGH_VALUE' | 'FIGHT' | 'REVIEW'>('ALL');
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [floatingFilters, setFloatingFilters] = useState(false);

  // Apply client-side preset filter on row data
  const filteredRowData = useMemo(() => {
    const now = Date.now();
    return disputes.filter((d) => {
      if (activeFilterPreset === 'URGENT') {
        const diffMs = new Date(d.response_deadline).getTime() - now;
        return d.status !== 'RESOLVED' && diffMs > 0 && diffMs <= 48 * 3600 * 1000;
      }
      if (activeFilterPreset === 'HIGH_VALUE') {
        return d.amount_cents >= 50000; // >= $500
      }
      if (activeFilterPreset === 'FIGHT') {
        return d.recommendation === 'FIGHT';
      }
      if (activeFilterPreset === 'REVIEW') {
        return d.status === 'UNDER_REVIEW' || d.recommendation === 'ASK A HUMAN';
      }
      return true;
    });
  }, [disputes, activeFilterPreset]);

  // One-click Sorting Handlers targeting AG Grid API
  const handleSortByRisk = useCallback(() => {
    gridRef.current?.api.applyColumnState({
      state: [{ colId: 'amount_cents', sort: 'desc' }],
      defaultState: { sort: null },
    });
  }, []);

  const handleSortByDeadline = useCallback(() => {
    gridRef.current?.api.applyColumnState({
      state: [{ colId: 'response_deadline', sort: 'asc' }],
      defaultState: { sort: null },
    });
  }, []);

  const handleSortByStrength = useCallback(() => {
    gridRef.current?.api.applyColumnState({
      state: [{ colId: 'strength_score', sort: 'desc' }],
      defaultState: { sort: null },
    });
  }, []);

  // CSV Export
  const handleExportCsv = useCallback(() => {
    if (gridRef.current?.api) {
      try {
        gridRef.current.api.exportDataAsCsv({
          fileName: `paypal_disputes_queue_${new Date().toISOString().slice(0, 10)}.csv`,
        });
        return;
      } catch (e) {
        // Fallback custom CSV generation
      }
    }

    const headers = ['Dispute ID', 'Transaction ID', 'Reason', 'Amount (USD)', 'Status', 'Strength Score', 'Recommendation', 'Deadline'];
    const rows = filteredRowData.map((d) => [
      d.paypal_dispute_id,
      d.transaction_id,
      d.reason,
      (d.amount_cents / 100).toFixed(2),
      d.status,
      d.strength_score,
      d.recommendation,
      d.response_deadline,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `paypal_disputes_queue_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [filteredRowData]);

  // Row selection handler
  const onRowClicked = useCallback((event: RowClickedEvent<Dispute>) => {
    if (event.data) {
      setSelectedDispute(event.data);
    }
  }, []);

  const columnDefs = useMemo<ColDef<Dispute>[]>(() => [
    {
      headerName: 'Dispute ID',
      field: 'paypal_dispute_id',
      colId: 'paypal_dispute_id',
      width: 175,
      cellRenderer: (params: any) => {
        const d: Dispute = params.data;
        if (!d) return null;
        return (
          <div className="flex items-center gap-1.5 h-full">
            <Link
              href={`/case/${d.id}/`}
              className="font-mono text-xs font-bold text-[#0A3E29] hover:underline flex items-center gap-1.5 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ShieldCheck className="w-4 h-4 text-[#0A3E29] shrink-0" />
              <span>{d.paypal_dispute_id}</span>
            </Link>
          </div>
        );
      },
    },
    {
      headerName: 'Reason',
      field: 'reason',
      colId: 'reason',
      width: 240,
      cellRenderer: (params: any) => {
        const val = params.value || '';
        const labels: Record<string, string> = {
          MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item Not Received (INR)',
          MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not As Described (SNAD)',
          UNAUTHORISED: 'Unauthorised Transaction',
          INCORRECT_AMOUNT: 'Incorrect Amount',
          DUPLICATE_TRANSACTION: 'Duplicate Charge',
        };
        const text = labels[val] || val.replace(/_/g, ' ');
        return (
          <div className="flex items-center h-full text-xs font-semibold text-slate-800" title={val}>
            <span className="truncate">{text}</span>
          </div>
        );
      },
    },
    {
      headerName: 'At Risk',
      field: 'amount_cents',
      colId: 'amount_cents',
      width: 140,
      sort: 'desc',
      cellRenderer: (params: any) => {
        const cents = params.value || 0;
        const currency = params.data?.currency || 'USD';
        return (
          <div className="flex items-center h-full font-bold text-xs text-slate-900">
            <span>${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            <span className="text-[10px] text-slate-400 font-normal ml-1">{currency}</span>
          </div>
        );
      },
    },
    {
      headerName: 'Time Left',
      field: 'response_deadline',
      colId: 'response_deadline',
      width: 165,
      cellRenderer: (params: any) => {
        const deadline = new Date(params.value).getTime();
        const now = Date.now();
        const diffMs = deadline - now;

        if (params.data?.status === 'RESOLVED') {
          return (
            <div className="flex items-center gap-1 text-xs text-slate-400 font-medium h-full">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Resolved</span>
            </div>
          );
        }

        if (!Number.isFinite(deadline)) {
          return <span className="text-xs text-slate-500">Deadline unavailable</span>;
        }

        if (diffMs <= 0) {
          return (
            <div className="flex items-center gap-1 text-xs font-bold text-rose-600 h-full">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Expired</span>
            </div>
          );
        }

        const hoursLeft = Math.floor(diffMs / (3600 * 1000));
        const minutesLeft = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
        const isUrgent = hoursLeft <= 48;

        return (
          <div className={`flex items-center gap-1.5 text-xs font-semibold h-full ${isUrgent ? 'text-amber-700' : 'text-slate-600'}`}>
            <Clock className={`w-3.5 h-3.5 ${isUrgent ? 'text-amber-500 animate-pulse' : 'text-slate-400'}`} />
            <span>{hoursLeft}h {minutesLeft}m left</span>
          </div>
        );
      },
    },
    {
      headerName: 'Evidence Score',
      field: 'strength_score',
      colId: 'strength_score',
      width: 175,
      cellRenderer: (params: any) => {
        const score = params.value || 0;
        const barColor = score >= 70 ? 'bg-emerald-500' : score >= 35 ? 'bg-amber-500' : 'bg-rose-500';
        const textColor = score >= 70 ? 'text-emerald-700' : score >= 35 ? 'text-amber-700' : 'text-rose-700';

        return (
          <div className="flex items-center gap-2 h-full w-full">
            <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
              <div className={`h-full ${barColor} transition-all duration-500 rounded-full`} style={{ width: `${score}%` }} />
            </div>
            <span className={`text-xs font-bold ${textColor} tabular-nums w-12 text-right`}>{score}/100</span>
          </div>
        );
      },
    },
    {
      headerName: 'Recommendation',
      field: 'recommendation',
      colId: 'recommendation',
      width: 160,
      cellRenderer: (params: any) => {
        const rec = params.value || 'ASK A HUMAN';
        let badgeStyle = 'text-slate-700 bg-slate-100 border-slate-200';
        if (rec === 'FIGHT') badgeStyle = 'text-emerald-800 bg-emerald-50 border-emerald-200';
        if (rec === 'ACCEPT') badgeStyle = 'text-amber-800 bg-amber-50 border-amber-200';

        return (
          <div className="flex items-center h-full">
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${badgeStyle}`}>
              {rec}
            </span>
          </div>
        );
      },
    },
    {
      headerName: 'Status',
      field: 'status',
      colId: 'status',
      width: 135,
      cellRenderer: (params: any) => {
        const status = params.value || 'REQUIRED_ACTION';
        let label = 'Action Required';
        let color = 'text-rose-700 bg-rose-50 border-rose-200';

        if (status === 'UNDER_REVIEW') {
          label = 'Under Review';
          color = 'text-blue-700 bg-blue-50 border-blue-200';
        } else if (status === 'RESOLVED') {
          label = 'Resolved';
          color = 'text-emerald-700 bg-emerald-50 border-emerald-200';
        }

        return (
          <div className="flex items-center h-full">
            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${color}`}>
              {label}
            </span>
          </div>
        );
      },
    },
    {
      headerName: 'Action',
      width: 130,
      sortable: false,
      filter: false,
      cellRenderer: (params: any) => {
        const d: Dispute = params.data;
        if (!d) return null;
        return (
          <div className="flex items-center h-full">
            <Link
              href={`/case/${d.id}/`}
              className="inline-flex items-center gap-1 px-3 py-1 bg-[#0A3E29] hover:bg-[#06291B] text-white rounded-full text-xs font-bold transition-all shadow-sm hover:shadow"
              onClick={(e) => e.stopPropagation()}
            >
              <span>Review</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        );
      },
    },
  ], []);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true,
    filter: true,
    floatingFilter: floatingFilters,
    resizable: true,
  }), [floatingFilters]);

  return (
    <div className="space-y-4">
      {/* ── Toolbar: Search, Triage Sorters & Quick Filter Presets ── */}
      <div className="space-y-3 pb-2 border-b border-slate-100">
        {/* Top Control Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by ID, reason, amount..."
              value={quickFilterText}
              onChange={(e) => setQuickFilterText(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-full bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0A3E29]/20 focus:border-[#0A3E29] transition-all"
            />
          </div>

          {/* Sorter & Tool Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider hidden lg:inline">
              Triage Sort:
            </span>
            <button
              onClick={handleSortByRisk}
              className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              title="Prioritize disputes by money at risk"
            >
              <DollarSign className="w-3 h-3 text-[#0A3E29]" />
              <span>Money at Risk</span>
            </button>
            <button
              onClick={handleSortByDeadline}
              className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              title="Prioritize disputes expiring soonest"
            >
              <Clock className="w-3 h-3 text-amber-600" />
              <span>Deadline Clock</span>
            </button>
            <button
              onClick={handleSortByStrength}
              className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              title="Sort by Evidence Strength Score"
            >
              <FileCheck className="w-3 h-3 text-[#0A3E29]" />
              <span>Strength</span>
            </button>
            <button
              onClick={() => setFloatingFilters(!floatingFilters)}
              className={`p-2 rounded-full border text-xs font-semibold transition-colors ${
                floatingFilters ? 'bg-emerald-50 text-[#0A3E29] border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
              title="Toggle column floating filters"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleExportCsv}
              className="p-2 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold transition-colors"
              title="Export visible dispute queue to CSV"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Filter Preset Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            Quick Filters:
          </span>
          {[
            { id: 'ALL', label: `All (${disputes.length})` },
            { id: 'URGENT', label: 'Urgent (<48h)' },
            { id: 'HIGH_VALUE', label: 'High Value (≥$500)' },
            { id: 'FIGHT', label: 'FIGHT (ESS ≥70)' },
            { id: 'REVIEW', label: 'Under Review' },
          ].map((preset) => (
            <button
              key={preset.id}
              onClick={() => setActiveFilterPreset(preset.id as any)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                activeFilterPreset === preset.id
                  ? 'bg-[#0A3E29] text-white shadow-sm'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── AG Grid Table ── */}
      <div className="ag-theme-quartz w-full h-[450px] rounded-xl overflow-hidden border border-slate-200/80">
        <AgGridReact<Dispute>
          ref={gridRef}
          rowData={filteredRowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          quickFilterText={quickFilterText}
          onRowClicked={onRowClicked}
          rowSelection="single"
          animateRows={true}
          rowHeight={48}
          headerHeight={40}
          pagination={true}
          paginationPageSize={10}
        />
      </div>

      {/* ── AG Grid Row Detail Inspector Drawer ── */}
      {selectedDispute && (
        <div className="p-4 rounded-2xl bg-slate-50 border border-emerald-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in duration-200">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#0A3E29]" />
              <span className="font-mono text-xs font-bold text-slate-800">
                {selectedDispute.paypal_dispute_id}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700">
                Tx: {selectedDispute.transaction_id}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                Recommendation: {selectedDispute.recommendation}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Reason: <strong>{selectedDispute.reason.replace(/_/g, ' ')}</strong> | Amount At Risk:{' '}
              <strong className="text-slate-900">${(selectedDispute.amount_cents / 100).toFixed(2)}</strong> | Evidence Strength:{' '}
              <strong className="text-emerald-700">{selectedDispute.strength_score}/100</strong>
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href={`/case/${selectedDispute.id}`}
              className="px-4 py-2 bg-[#0A3E29] hover:bg-[#072d1e] text-white rounded-full text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
            >
              <span>Inspect Case Details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={() => setSelectedDispute(null)}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full transition-colors"
              title="Close detail drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
