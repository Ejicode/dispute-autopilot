'use client';

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef } from 'ag-grid-community';
import Link from 'next/link';
import { Dispute } from '@/lib/types';
import { AlertCircle, Clock, ShieldCheck, ArrowRight, CheckCircle2, Search } from 'lucide-react';

interface QueueGridProps {
  disputes: Dispute[];
}

export default function QueueGrid({ disputes }: QueueGridProps) {
  const [quickFilterText, setQuickFilterText] = useState('');

  const columnDefs = useMemo<ColDef<Dispute>[]>(() => [
    {
      headerName: 'Dispute ID',
      field: 'paypal_dispute_id',
      width: 175,
      cellRenderer: (params: any) => {
        const d: Dispute = params.data;
        if (!d) return null;
        return (
          <Link
            href={`/case/${d.id}`}
            className="font-mono text-xs font-bold text-[#0070BA] hover:underline flex items-center gap-1.5 h-full transition-colors"
          >
            <ShieldCheck className="w-4 h-4 text-[#0070BA] shrink-0" />
            <span>{d.paypal_dispute_id}</span>
          </Link>
        );
      },
    },
    {
      headerName: 'Reason',
      field: 'reason',
      width: 250,
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
      width: 160,
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
      width: 180,
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
      width: 170,
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
      width: 140,
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
      width: 140,
      sortable: false,
      filter: false,
      cellRenderer: (params: any) => {
        const d: Dispute = params.data;
        if (!d) return null;
        return (
          <div className="flex items-center h-full">
            <Link
              href={`/case/${d.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#0070BA] hover:bg-[#003087] text-white rounded-full text-xs font-bold transition-all shadow-sm hover:shadow"
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
    resizable: true,
  }), []);

  return (
    <div className="space-y-3">
      {/* Search bar inside the grid container */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search disputes in queue..."
            value={quickFilterText}
            onChange={(e) => setQuickFilterText(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-full bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0070BA]/20 focus:border-[#0070BA] transition-all"
          />
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> FIGHT (≥70)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Review (35–69)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Low (&lt;35)</span>
        </div>
      </div>

      {/* AG Grid */}
      <div className="ag-theme-quartz w-full h-[420px]">
        <AgGridReact<Dispute>
          rowData={disputes}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          quickFilterText={quickFilterText}
          animateRows={true}
          rowHeight={48}
          headerHeight={40}
          pagination={true}
          paginationPageSize={10}
        />
      </div>
    </div>
  );
}
