'use client';

import React, { useState } from 'react';
import { 
  ShieldCheck, 
  MapPin, 
  CreditCard, 
  Package, 
  Clock, 
  Truck, 
  CheckCircle2, 
  FileText, 
  Hash, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink,
  User,
  Barcode
} from 'lucide-react';
import { EvidenceItem } from '@/lib/types';

interface EvidenceCardProps {
  item: EvidenceItem;
  isHighlighted?: boolean;
}

export default function EvidenceCard({ item, isHighlighted }: EvidenceCardProps) {
  const [showRaw, setShowRaw] = useState(false);

  // Attempt to parse JSON content
  let parsedContent: any = null;
  try {
    if (typeof item.content === 'string') {
      parsedContent = JSON.parse(item.content);
    } else {
      parsedContent = item.content;
    }
  } catch {
    parsedContent = null;
  }

  // Render Order Confirmation
  const renderOrderConfirmation = (data: any) => (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2">
          <User className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Customer</span>
            <span className="font-bold text-slate-800">{data.buyer_name || 'N/A'}</span>
            {data.email && <span className="text-[11px] text-slate-500 block">{data.email}</span>}
          </div>
        </div>

        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2">
          <CreditCard className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Payment & Amount</span>
            <span className="font-bold text-emerald-600 text-sm">
              ${data.total_cents ? (data.total_cents / 100).toFixed(2) : '0.00'} {data.currency || 'USD'}
            </span>
            <span className="text-[11px] text-slate-500 block">{data.payment_method || 'PayPal Express Checkout'}</span>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2 text-xs">
        <MapPin className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
        <div>
          <span className="text-[10px] text-slate-400 font-semibold uppercase block">Verified Shipping Address</span>
          <span className="font-semibold text-slate-800">{data.shipping_address || 'Address on file'}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] px-2 py-1 bg-emerald-50/60 rounded-lg border border-emerald-100 text-emerald-900">
        <div className="flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5 text-[#003087]" />
          <span>SKU: <strong>{data.sku || 'ITEM-DEFAULT'}</strong></span>
        </div>
        {data.transaction_id && (
          <span className="font-mono text-[10px] text-slate-600">TxID: {data.transaction_id}</span>
        )}
      </div>
    </div>
  );

  // Render Carrier Tracking History
  // Render Carrier Tracking History
  const renderTrackingHistory = (data: any) => (
    <div className="space-y-3 overflow-hidden min-w-0">
      <div className="flex items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Truck className="w-4 h-4 text-[#003087] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-bold text-slate-800 block truncate">{data.carrier || 'USPS Priority Mail'}</span>
            <span className="font-mono text-[11px] text-slate-500 block truncate">{data.tracking_number}</span>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0 whitespace-nowrap">
          {data.status || 'DELIVERED'}
        </span>
      </div>

      {Array.isArray(data.events) && (
        <div className="space-y-1.5 pl-2 border-l-2 border-emerald-200 ml-2">
          {data.events.map((evt: any, idx: number) => (
            <div key={idx} className="relative pl-3 text-xs flex items-start justify-between gap-2 min-w-0">
              <span className="absolute -left-[13px] top-1 w-2.5 h-2.5 rounded-full bg-[#003087] ring-2 ring-white shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="font-bold text-slate-800 block truncate">{evt.status?.replace(/_/g, ' ')}</span>
                {evt.location && <span className="text-[11px] text-slate-500 block truncate">{evt.location}</span>}
              </div>
              {evt.timestamp && (
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {new Date(evt.timestamp).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Render Proof of Delivery
  const renderProofOfDelivery = (data: any) => (
    <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-200 text-xs space-y-2 overflow-hidden min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 font-bold text-emerald-900 min-w-0 truncate">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="truncate">Electronic Delivery Certificate</span>
        </div>
        <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-200/60 text-emerald-800 shrink-0 whitespace-nowrap">
          SIGNED
        </span>
      </div>
      <div className="text-[11px] text-slate-700 space-y-1 min-w-0 break-words">
        <p className="break-words">Delivered to: <strong className="break-words">{data.delivery_address || 'Customer Address'}</strong></p>
        <p className="break-words">Carrier Tracking: <strong className="font-mono break-all">{data.tracking_number}</strong></p>
        {data.signed_by && <p className="break-words">Signed by: <strong>{data.signed_by}</strong></p>}
      </div>
    </div>
  );

  // Generic Key-Value table
  const renderGenericData = (data: any) => {
    if (typeof data !== 'object' || data === null) {
      return <p className="text-xs text-slate-700 leading-relaxed break-words">{String(item.content)}</p>;
    }
    return (
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100 overflow-hidden">
        {Object.entries(data).slice(0, 8).map(([k, v]) => (
          <div key={k} className="overflow-hidden min-w-0">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block truncate">{k.replace(/_/g, ' ')}</span>
            <span className="font-semibold text-slate-800 truncate block">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      id={`ev-${item.id}`}
      className={`p-4 rounded-2xl border transition-all duration-200 overflow-hidden w-full min-w-0 ${
        isHighlighted
          ? 'bg-blue-50/90 border-[#003087] ring-2 ring-blue-400/40 shadow-md'
          : 'card-3d-reflection hover:border-slate-300'
      }`}
    >
      {/* Card Header */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5 mb-2.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-6 h-6 rounded-lg bg-blue-50 text-[#003087] flex items-center justify-center shrink-0">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-slate-900 text-xs truncate min-w-0" title={item.title}>
            {item.title}
          </span>
        </div>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-[#003087] uppercase tracking-wider shrink-0 whitespace-nowrap">
          {item.evidence_type.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Structured Card Content */}
      <div className="mb-3 overflow-hidden min-w-0">
        {parsedContent ? (
          item.evidence_type === 'ORDER_CONFIRMATION'
            ? renderOrderConfirmation(parsedContent)
            : item.evidence_type === 'TRACKING_HISTORY'
            ? renderTrackingHistory(parsedContent)
            : item.evidence_type === 'PROOF_OF_DELIVERY'
            ? renderProofOfDelivery(parsedContent)
            : renderGenericData(parsedContent)
        ) : (
          <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100 break-words">
            {item.content}
          </p>
        )}
      </div>

      {/* Card Footer: Source & Cryptographic Hash */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-slate-100 text-[10px] text-slate-500 min-w-0">
        <span className="truncate max-w-[130px]">Source: <strong className="text-slate-700">{item.source}</strong></span>
        
        <div className="flex items-center gap-1.5 shrink-0">
          <div 
            className="flex items-center gap-1 font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 shrink-0"
            title={`Immutable SHA-256 Hash: ${item.sha256_hash}`}
          >
            <Hash className="w-2.5 h-2.5" />
            <span>{item.sha256_hash.substring(0, 10)}…</span>
          </div>

          {/* Toggle raw JSON inspect */}
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-slate-400 hover:text-slate-700 p-0.5 shrink-0"
            title="Inspect Raw JSON"
          >
            {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Collapsible raw JSON audit view */}
      {showRaw && (
        <pre className="mt-2 p-2 bg-slate-900 text-slate-200 text-[10px] font-mono rounded-lg overflow-x-auto max-h-36">
          {typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2)}
        </pre>
      )}
    </div>
  );
}
