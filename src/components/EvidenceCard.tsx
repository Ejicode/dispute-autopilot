'use client';

import React, { useState } from 'react';
import { 
  ShieldCheck, 
  MapPin, 
  CreditCard, 
  Package, 
  Truck, 
  CheckCircle2, 
  FileText, 
  Hash, 
  ChevronDown, 
  ChevronUp, 
  User,
  FileCheck
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

  // Type-specific iconography and badges
  const getTypeMeta = (type: string) => {
    switch (type) {
      case 'ORDER_CONFIRMATION':
        return {
          label: 'Order Receipt',
          icon: CreditCard,
          badgeCls: 'bg-blue-50 text-[#003087] border-blue-200/80',
          iconCls: 'bg-blue-50 text-[#003087] border border-blue-100',
        };
      case 'TRACKING_HISTORY':
        return {
          label: 'Tracking Log',
          icon: Truck,
          badgeCls: 'bg-sky-50 text-[#0070BA] border-sky-200/80',
          iconCls: 'bg-sky-50 text-[#0070BA] border border-sky-100',
        };
      case 'PROOF_OF_DELIVERY':
        return {
          label: 'Delivery Proof',
          icon: CheckCircle2,
          badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
          iconCls: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        };
      case 'REFUND_POLICY':
        return {
          label: 'Terms & Policy',
          icon: FileCheck,
          badgeCls: 'bg-indigo-50 text-[#003087] border-indigo-200/80',
          iconCls: 'bg-indigo-50 text-[#003087] border border-indigo-100',
        };
      default:
        return {
          label: type.replace(/_/g, ' '),
          icon: FileText,
          badgeCls: 'bg-slate-50 text-slate-700 border-slate-200/80',
          iconCls: 'bg-slate-50 text-slate-600 border border-slate-100',
        };
    }
  };

  const typeMeta = getTypeMeta(item.evidence_type);
  const IconComponent = typeMeta.icon;

  // Render Order Confirmation
  const renderOrderConfirmation = (data: any) => (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2">
          <User className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Customer</span>
            <span className="font-bold text-slate-800 truncate block">{data.buyer_name || 'N/A'}</span>
            {data.email && <span className="text-[11px] text-slate-500 font-mono truncate block">{data.email}</span>}
          </div>
        </div>

        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2">
          <CreditCard className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Payment</span>
            <span className="font-bold text-emerald-600 text-sm block">
              ${data.total_cents ? (data.total_cents / 100).toFixed(2) : '0.00'} {data.currency || 'USD'}
            </span>
            <span className="text-[11px] text-slate-500 truncate block">{data.payment_method || 'PayPal Express Checkout'}</span>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2 text-xs">
        <MapPin className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="text-[10px] text-slate-400 font-semibold uppercase block">Verified Shipping Address</span>
          <span className="font-semibold text-slate-800 text-[11px] block truncate">{data.shipping_address || 'Address on file'}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 bg-emerald-50/60 rounded-xl border border-emerald-100 text-emerald-900">
        <div className="flex items-center gap-1.5 min-w-0">
          <Package className="w-3.5 h-3.5 text-[#003087] shrink-0" />
          <span className="truncate">SKU: <strong>{data.sku || 'ITEM-DEFAULT'}</strong></span>
        </div>
        {data.transaction_id && (
          <span className="font-mono text-[10px] text-slate-600 shrink-0">TxID: {data.transaction_id}</span>
        )}
      </div>
    </div>
  );

  // Render Carrier Tracking History
  const renderTrackingHistory = (data: any) => (
    <div className="space-y-2.5 overflow-hidden min-w-0">
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
          {data.events.slice(0, 3).map((evt: any, idx: number) => (
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
        <p className="truncate">Delivered to: <strong className="text-slate-900">{data.delivery_address || 'Customer Address'}</strong></p>
        <p className="truncate">Tracking: <strong className="font-mono text-slate-900">{data.tracking_number}</strong></p>
        {data.signed_by && <p className="truncate">Signed by: <strong className="text-slate-900">{data.signed_by}</strong></p>}
      </div>
    </div>
  );

  // Render Accepted Terms & Refund Policy (Structured Tiles — NO raw text blocks)
  const renderRefundPolicy = (content: string) => {
    let buyerName = '';
    let buyerEmail = '';

    const nameMatch = content.match(/Buyer\s+([^(]+?)\s+\(([^)]+)\)/i);
    if (nameMatch) {
      buyerName = nameMatch[1].trim();
      buyerEmail = nameMatch[2].trim();
    }

    const isSignatureThreshold = content.toLowerCase().includes('$750') || content.toLowerCase().includes('adult signature');

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2">
          <User className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">
              {buyerName ? 'Customer' : 'Policy Scope'}
            </span>
            <span className="font-bold text-slate-800 truncate block">
              {buyerName || (isSignatureThreshold ? 'Orders Over $750' : 'Storewide Policy')}
            </span>
            {buyerEmail ? (
              <span className="text-[11px] text-slate-500 font-mono truncate block">{buyerEmail}</span>
            ) : (
              <span className="text-[11px] text-slate-500 font-medium block">
                {isSignatureThreshold ? 'PayPal § 11.3(b) Compliant' : 'Checkout Grounding'}
              </span>
            )}
          </div>
        </div>

        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Policy Terms</span>
            <span className="font-bold text-slate-800 block">
              {isSignatureThreshold ? 'Adult Signature Required' : '30-Day Inspection Window'}
            </span>
            <span className="text-[11px] text-emerald-700 font-medium block">
              {isSignatureThreshold ? 'Carrier Tracking Intakes' : 'Verified at Checkout ✓'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Generic Key-Value table
  const renderGenericData = (data: any) => {
    if (typeof data !== 'object' || data === null) {
      return (
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-start gap-2 text-xs">
          <FileText className="w-3.5 h-3.5 text-[#003087] mt-0.5 shrink-0" />
          <span className="font-semibold text-slate-800 break-words leading-relaxed">{String(item.content)}</span>
        </div>
      );
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
      className={`p-4 rounded-3xl border transition-all duration-200 w-full min-w-0 card-3d-reflection group hover:scale-[1.01] ${
        isHighlighted
          ? 'bg-blue-50/90 border-[#003087] ring-2 ring-blue-400/40'
          : 'hover:border-slate-300'
      }`}
    >
      {/* Card Header */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5 mb-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${typeMeta.iconCls}`}>
            <IconComponent className="w-4 h-4" />
          </div>
          <span className="font-bold text-slate-900 text-xs truncate min-w-0" title={item.title}>
            {item.title}
          </span>
        </div>
        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border shrink-0 whitespace-nowrap ${typeMeta.badgeCls}`}>
          {typeMeta.label}
        </span>
      </div>

      {/* Structured Card Content */}
      <div className="mb-3 overflow-hidden min-w-0">
        {item.evidence_type === 'REFUND_POLICY'
          ? renderRefundPolicy(String(item.content))
          : parsedContent
          ? item.evidence_type === 'ORDER_CONFIRMATION'
            ? renderOrderConfirmation(parsedContent)
            : item.evidence_type === 'TRACKING_HISTORY'
            ? renderTrackingHistory(parsedContent)
            : item.evidence_type === 'PROOF_OF_DELIVERY'
            ? renderProofOfDelivery(parsedContent)
            : renderGenericData(parsedContent)
          : renderGenericData(item.content)}
      </div>

      {/* Card Footer: Source & Cryptographic Hash */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2.5 border-t border-slate-100 text-[10px] text-slate-500 min-w-0">
        <span className="truncate max-w-[140px] font-medium">Source: <strong className="text-slate-800 font-semibold">{item.source}</strong></span>
        
        <div className="flex items-center gap-1.5 shrink-0">
          <div 
            className="flex items-center gap-1 font-mono text-[10px] text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/80 font-bold shrink-0"
            title={`Immutable SHA-256 Hash: ${item.sha256_hash}`}
          >
            <Hash className="w-2.5 h-2.5 text-emerald-600" />
            <span>{item.sha256_hash.substring(0, 10)}…</span>
          </div>

          {/* Toggle raw JSON inspect */}
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-slate-400 hover:text-slate-700 p-0.5 shrink-0 cursor-pointer"
            title="Inspect Raw JSON"
          >
            {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Collapsible raw JSON audit view */}
      {showRaw && (
        <pre className="mt-2.5 p-2.5 bg-slate-900 text-slate-200 text-[10px] font-mono rounded-xl overflow-x-auto max-h-36">
          {typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2)}
        </pre>
      )}
    </div>
  );
}
