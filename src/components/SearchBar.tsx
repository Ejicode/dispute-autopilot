'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, X, ShieldCheck, Package, FileText, ShoppingBag, ArrowRight, Loader2
} from 'lucide-react';

interface SearchResult {
  type: 'dispute' | 'order' | 'product' | 'evidence';
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: 'amber' | 'emerald' | 'blue' | 'violet' | 'slate';
  href: string;
  icon: string;
  image?: string;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  shield: <ShieldCheck className="w-4 h-4 text-[#0070BA]" />,
  package: <Package className="w-4 h-4 text-emerald-600" />,
  shopping: <ShoppingBag className="w-4 h-4 text-violet-600" />,
  file: <FileText className="w-4 h-4 text-amber-600" />,
};

const BADGE_COLORS: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-[#0070BA] border-blue-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
};

const TYPE_LABELS: Record<string, string> = {
  dispute: 'Dispute',
  order: 'Order',
  product: 'Product',
  evidence: 'Evidence',
};

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
      setOpen(true);
    } catch (_) {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSelect = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  // Group results by type
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <div className="relative w-full max-w-sm" ref={dropdownRef}>
      {/* Search Input */}
      <div className={`flex items-center gap-2.5 bg-white/15 backdrop-blur-sm border transition-all duration-200 rounded-xl px-3.5 py-2 ${
        open ? 'border-white/60 bg-white/25 shadow-lg' : 'border-white/25 hover:border-white/40'
      }`}>
        {loading ? (
          <Loader2 className="w-4 h-4 text-white/70 shrink-0 animate-spin" />
        ) : (
          <Search className="w-4 h-4 text-white/70 shrink-0" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder="Search disputes, orders, products…"
          className="bg-transparent text-white placeholder-white/50 text-xs font-medium w-full outline-none"
        />
        {query ? (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }}>
            <X className="w-3.5 h-3.5 text-white/60 hover:text-white transition-colors" />
          </button>
        ) : (
          <span className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/20 text-white/60 text-[9px] font-mono font-bold shrink-0">
            ⌘K
          </span>
        )}
      </div>

      {/* Results Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          {results.length === 0 && !loading && query.length >= 2 ? (
            <div className="p-6 text-center text-slate-400 text-sm">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No results for "{query}"</p>
              <p className="text-xs mt-0.5">Try searching by dispute ID, buyer name, or product</p>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto p-2">
              {Object.entries(grouped).map(([type, items]) => (
                <div key={type} className="mb-1">
                  <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {TYPE_LABELS[type] || type}s
                  </div>
                  {items.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => handleSelect(result.href)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left group"
                    >
                      {/* Icon or Image */}
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                        {result.image ? (
                          <img src={result.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          ICON_MAP[result.icon] || <FileText className="w-4 h-4 text-slate-400" />
                        )}
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{result.title}</div>
                        <div className="text-[11px] text-slate-500 truncate">{result.subtitle}</div>
                      </div>

                      {/* Badge */}
                      <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${BADGE_COLORS[result.badgeColor]} shrink-0 truncate max-w-[80px]`}>
                        {result.badge?.replace(/_/g, ' ')}
                      </span>

                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#0070BA] transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              ))}

              {/* Footer tip */}
              <div className="border-t border-slate-100 px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-medium">
                  {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
                </span>
                <span className="text-[10px] text-slate-400 font-mono">ESC to close</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
