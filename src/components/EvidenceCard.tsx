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
          <User className="w-3.5 h-3.5 text-[#0070BA] mt-0.5 shrink-0" />
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Customer</span>
            <span className="font-bold text-slate-800">{data.buyer_name || 'N/A'}</span>
            {data.email && <span className="text-[11px] text-slate-500 block">{data.email}</span>}
          </div>
        </div>

        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2">
          <CreditCard className="w-3.5 h-3.5 text-[#0070BA] mt-0.5 shrink-0" />
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
        <MapPin className="w-3.5 h-3.5 text-[#0070BA] mt-0.5 shrink-0" />
        <div>
          <span className="text-[10px] text-slate-400 font-semibold uppercase block">Verified Shipping Address</span>
          <span className="font-semibold text-slate-800">{data.shipping_address || 'Address on file'}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] px-2 py-1 bg-blue-50/60 rounded-lg border border-blue-100 text-blue-900">
        <div className="flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5 text-[#0070BA]" />
          <span>SKU: <strong>{data.sku || 'ITEM-DEFAULT'}</strong></span>
        </div>
        {data.transaction_id && (
          <span className="font-mono text-[10px] text-slate-600">TxID: {data.transaction_id}</span>
        )}
      </div>
    </div>
  );

  // Render Carrier Tracking History
  const renderTrackingHistory = (data: any) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-[#0070BA]" />
          <div>
            <span className="font-bold text-slate-800 block">{data.carrier || 'USPS Priority Mail'}</span>
            <span className="font-mono text-[11px] text-slate-500">{data.tracking_number}</span>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          {data.status || 'DELIVERED'}
        </span>
      </div>

      {Array.isArray(data.events) && (
        <div className="space-y-1.5 pl-2 border-l-2 border-blue-200 ml-2">
          {data.events.map((evt: any, idx: number) => (
            <div key={idx} className="relative pl-3 text-xs flex items-start justify-between gap-2">
              <span className="absolute -left-[13px] top-1 w-2.5 h-2.5 rounded-full bg-[#0070BA] ring-2 ring-white" />
              <div>
                <span className="font-bold text-slate-800">{evt.status?.replace(/_/g, ' ')}</span>
                {evt.location && <span className="text-[11px] text-slate-500 block">{evt.location}</span>}
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
    <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-200 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-bold text-emerald-900">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Electronic Delivery Certificate</span>
        </div>
        <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-200/60 text-emerald-800">
          SIGNED
        </span>
      </div>
      <div className="text-[11px] text-slate-700 space-y-1">
        <p>Delivered to: <strong>{data.delivery_address || 'Customer Address'}</strong></p>
        <p>Carrier Tracking: <strong className="font-mono">{data.tracking_number}</strong></p>
        {data.signed_by && <p>Signed by: <strong>{data.signed_by}</strong></p>}
      </div>
    </div>
  );

  // Generic Key-Value table
  const renderGenericData = (data: any) => {
    if (typeof data !== 'object' || data === null) {
      return <p className="text-xs text-slate-700 leading-relaxed">{String(item.content)}</p>;
    }
    return (
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
        {Object.entries(data).slice(0, 8).map(([k, v]) => (
          <div key={k} className="overflow-hidden">
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
      className={`p-4 rounded-2xl border transition-all duration-200 ${
        isHighlighted
          ? 'bg-blue-50/90 border-[#0070BA] ring-2 ring-blue-400/40 shadow-md'
          : 'bg-white border-slate-200/90 shadow-sm hover:border-slate-300 hover:shadow-md'
      }`}

    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-blue-50 text-[#0070BA] flex items-center justify-center">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-slate-900 text-xs truncate max-w-[220px]" title={item.title}>
            {item.title}
          </span>
        </div>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-[#0070BA] uppercase tracking-wider shrink-0">
          {item.evidence_type.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Structured Card Content */}
      <div className="mb-3">
        {parsedContent ? (
          item.evidence_type === 'ORDER_CONFIRMATION'
            ? renderOrderConfirmation(parsedContent)
            : item.evidence_type === 'TRACKING_HISTORY'
            ? renderTrackingHistory(parsedContent)
            : item.evidence_type === 'PROOF_OF_DELIVERY'
            ? renderProofOfDelivery(parsedContent)
            : renderGenericData(parsedContent)
        ) : (
          <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100">
            {item.content}
          </p>
        )}
      </div>

      {/* Card Footer: Source & Cryptographic Hash */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] text-slate-500">
        <span>Source: <strong className="text-slate-700">{item.source}</strong></span>
        
        <div className="flex items-center gap-2">
          <div 
            className="flex items-center gap-1 font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100"
            title={`Immutable SHA-256 Hash: ${item.sha256_hash}`}
          >
            <Hash className="w-2.5 h-2.5" />
            <span>{item.sha256_hash.substring(0, 10)}…</span>
          </div>

          {/* Toggle raw JSON inspect */}
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-slate-400 hover:text-slate-700 p-0.5"
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
