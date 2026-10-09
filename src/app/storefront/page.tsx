'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { 
  ShoppingBag, 
  Truck, 
  CheckCircle2, 
  ShieldAlert, 
  RefreshCw, 
  User, 
  MapPin, 
  Package, 
  Zap, 
  Search, 
  Star, 
  Eye, 
  X, 
  ShieldCheck, 
  Check, 
  ArrowUpDown, 
  SlidersHorizontal,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { DemoOrder } from '@/lib/types';
import { useRealtime } from '@/components/RealtimeContext';
import { PRODUCTS, Product } from '@/lib/storefront/catalog';

const MILESTONES = ["LABEL_CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"] as const;

export default function StorefrontPage() {
  const { lastEvent } = useRealtime();
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  // Search, category & sorting state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'rating'>('featured');

  // Modal & action state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [buyingProductId, setBuyingProductId] = useState<string | null>(null);
  const [advancingOrderId, setAdvancingOrderId] = useState<string | null>(null);
  const [disputingOrderId, setDisputingOrderId] = useState<string | null>(null);
  const [checkoutSuccessToast, setCheckoutSuccessToast] = useState<{ name: string; orderNumber: string } | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Buyer checkout form fields — collected before each purchase
  const [buyerForm, setBuyerForm] = useState({ name: '', email: '', address: '' });

  // Fetch captured orders from SQLite
  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/storefront/checkout');
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [lastEvent]);

  // Polling fallback
  useEffect(() => {
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  // Distinct categories with counts
  const categoriesWithCounts = useMemo(() => {
    const counts: Record<string, number> = { All: PRODUCTS.length };
    for (const p of PRODUCTS) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return counts;
  }, []);

  // Filtered & sorted products (out of 52+)
  const displayedProducts = useMemo(() => {
    return PRODUCTS.filter((p) => {
      if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesBrand = p.brand.toLowerCase().includes(q);
        const matchesSku = p.sku.toLowerCase().includes(q);
        const matchesCategory = p.category.toLowerCase().includes(q);
        return matchesName || matchesBrand || matchesSku || matchesCategory;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === 'price-asc') return a.price_cents - b.price_cents;
      if (sortBy === 'price-desc') return b.price_cents - a.price_cents;
      if (sortBy === 'rating') return b.rating - a.rating;
      return 0; // featured default
    });
  }, [searchQuery, selectedCategory, sortBy]);

  // Real-time Checkout handler — uses buyer form data
  const handleBuyProduct = async (product: Product) => {
    setCheckoutError(null);
    const name = buyerForm.name.trim();
    const email = buyerForm.email.trim();
    const address = buyerForm.address.trim();

    if (!name || !email || !address) {
      setCheckoutError('Please fill in your name, email, and shipping address to complete checkout.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCheckoutError('Please enter a valid email address.');
      return;
    }

    setBuyingProductId(product.id);
    try {
      const res = await fetch('/api/storefront/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_name: name,
          buyer_email: email,
          shipping_address: address,
          items: [
            {
              name: product.name,
              quantity: 1,
              unit_price_cents: product.price_cents,
              sku: product.sku,
            },
          ],
          carrier: product.carrier_default,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCheckoutSuccessToast({ name: product.name, orderNumber: data.order?.order_number || 'New Order' });
        setTimeout(() => setCheckoutSuccessToast(null), 6000);
        await fetchOrders();
        if (selectedProduct?.id === product.id) {
          setSelectedProduct(null);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setCheckoutError(errData.error || 'Checkout failed. Please try again.');
      }
    } finally {
      setBuyingProductId(null);
    }
  };

  // Real-time Carrier Milestone advancement
  const handleAdvanceCarrier = async (orderId: string, targetStatus?: string) => {
    setAdvancingOrderId(orderId);
    try {
      const res = await fetch('/api/carrier/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, target_status: targetStatus }),
      });
      if (res.ok) await fetchOrders();
    } finally {
      setAdvancingOrderId(null);
    }
  };

  // Real-time Inbound Dispute simulation linked to specific order
  const handleSimulateDispute = async (order: DemoOrder) => {
    setDisputingOrderId(order.id);
    try {
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
          amount_cents: order.total_cents,
          currency: order.currency,
          hours_until_deadline: 48,
          buyer_name: order.buyer_name,
          shipping_address: order.shipping_address,
          buyer_message: `Customer stated: Order ${order.order_number} has not arrived at destination. Requesting refund.`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Dispute ${data.dispute.paypal_dispute_id} created! Evidence items from this order automatically linked in Vault.`);
      }
    } finally {
      setDisputingOrderId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Checkout Toast Notification ── */}
      {checkoutSuccessToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0070BA] text-white p-4 rounded-2xl shadow-2xl border border-white/20 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200 max-w-md">
          <div className="w-9 h-9 rounded-full bg-white text-[#0070BA] flex items-center justify-center font-bold shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="font-extrabold text-sm block">Payment Captured &amp; Vaulted!</span>
            <span className="text-xs text-white/90 block">
              {checkoutSuccessToast.orderNumber}: {checkoutSuccessToast.name} has been snapshot into Evidence Vault with SHA-256 integrity.
            </span>
          </div>
          <button onClick={() => setCheckoutSuccessToast(null)} className="p-1 hover:bg-white/10 rounded-full">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Page Header Banner ── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Storefront Catalog</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-[#0070BA] border border-blue-100">
              52 Live Products
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
              SHA-256 Vaulted
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Real products with verified photography and specs. Buying any item snapshots the receipt into the Evidence Vault before a dispute is ever filed.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 bg-blue-50/70 border border-blue-100 rounded-2xl px-4 py-2.5 shrink-0">
          <ShieldCheck className="w-4 h-4 text-[#0070BA] shrink-0" />
          <span>Every checkout creates an immutable <strong>SHA-256 Vault record</strong></span>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Live Search Input */}
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 52+ products by name, brand, or SKU..."
              className="w-full pl-9 pr-4 py-2 rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0070BA]/20 focus:border-[#0070BA] transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5" /> Sort:
            </span>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0070BA]/20"
            >
              <option value="featured">Featured (All 52)</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
            </select>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar">
          {Object.entries(categoriesWithCounts).map(([cat, count]) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-[#0070BA] text-white shadow-md shadow-blue-800/30'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                <span>{cat}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Product Grid (52+ Real Items) ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-500 font-semibold">
            Showing <strong>{displayedProducts.length}</strong> of <strong>{PRODUCTS.length}</strong> real products
          </span>
          <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live PayPal Sandbox Ready
          </span>
        </div>

        {displayedProducts.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-slate-200/90 text-center space-y-3">
            <Package className="w-8 h-8 text-slate-300 mx-auto" />
            <h3 className="font-bold text-slate-700 text-sm">No products found matching "{searchQuery}"</h3>
            <button onClick={() => { setSearchQuery(''); setSelectedCategory('All'); }} className="text-xs font-bold text-[#0070BA] hover:underline">
              Clear search &amp; show all 52 products
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {displayedProducts.map((prod) => (
              <div
                key={prod.id}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm hover:shadow-xl transition-all duration-200 flex flex-col justify-between group"
              >
                <div>
                  {/* Product Image with Quick View overlay */}
                  <div className="relative w-full h-44 rounded-xl overflow-hidden bg-slate-100 mb-3 group/img">
                    <img
                      src={prod.image_url}
                      alt={prod.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                    
                    {/* Brand Pill */}
                    <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white text-[10px] font-bold">
                      {prod.brand}
                    </span>

                    {/* Quick Specs Trigger */}
                    <button
                      onClick={() => setSelectedProduct(prod)}
                      className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-white/90 hover:bg-white text-slate-800 text-[10px] font-bold shadow-md flex items-center gap-1 transition-opacity opacity-0 group-hover/img:opacity-100"
                    >
                      <Eye className="w-3 h-3 text-[#0070BA]" />
                      <span>Quick Specs</span>
                    </button>
                  </div>

                  {/* Rating & Stock */}
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1 font-bold text-amber-500">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span>{prod.rating}</span>
                      <span className="text-slate-400 font-normal">({prod.reviews_count})</span>
                    </span>
                    <span className="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.2 rounded-full text-[10px]">
                      {prod.stock} in stock
                    </span>
                  </div>

                  {/* Title & SKU */}
                  <h3 
                    onClick={() => setSelectedProduct(prod)}
                    className="font-bold text-slate-900 text-sm leading-snug line-clamp-2 hover:text-[#0070BA] cursor-pointer transition-colors"
                    title={prod.name}
                  >
                    {prod.name}
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{prod.sku}</span>

                  {/* Description preview */}
                  <p className="text-xs text-slate-500 line-clamp-2 mt-1.5 leading-relaxed">
                    {prod.description}
                  </p>
                </div>

                {/* Price & Buy Action */}
                <div className="pt-3 border-t border-slate-100 mt-3">
                  <div className="flex items-baseline justify-between mb-2.5">
                    <div>
                      <span className="text-lg font-extrabold text-slate-900">
                        ${(prod.price_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-[11px] text-slate-400 ml-1">USD</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">Free 2-Day Shipping</span>
                  </div>

                  <button
                    onClick={() => handleBuyProduct(prod)}
                    disabled={buyingProductId === prod.id}
                    className="w-full py-2.5 rounded-full bg-[#0070BA] hover:bg-[#003087] text-white text-xs font-bold transition-all shadow-md shadow-blue-800/30 flex items-center justify-center gap-2 disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99]"
                  >
                    {buyingProductId === prod.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ShoppingBag className="w-3.5 h-3.5 text-[#FFC439]" />
                    )}
                    <span>Buy with PayPal Sandbox</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Product Quick-View & Detailed Specs Modal ── */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 max-w-2xl w-full p-6 relative max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#0070BA] bg-blue-50 px-2 py-0.5 rounded-full">
                  {selectedProduct.category}
                </span>
                <h2 className="text-lg font-bold text-slate-900 mt-1">{selectedProduct.name}</h2>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                  <span>Brand: <strong>{selectedProduct.brand}</strong></span>
                  <span>·</span>
                  <span className="font-mono">SKU: {selectedProduct.sku}</span>
                  <span>·</span>
                  <span className="text-amber-500 font-bold flex items-center gap-0.5">
                    <Star className="w-3 h-3 fill-amber-400" /> {selectedProduct.rating} ({selectedProduct.reviews_count} reviews)
                  </span>
                </div>
              </div>

              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4 my-4">
              {/* Product Photo Gallery */}
              <div className="w-full h-56 rounded-2xl overflow-hidden bg-slate-100 relative">
                <img
                  src={selectedProduct.image_url}
                  alt={selectedProduct.name}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-xs font-bold">
                  Verified In Stock: {selectedProduct.stock} units
                </span>
              </div>

              {/* Description */}
              <div>
                <h4 className="font-bold text-xs uppercase text-slate-400 tracking-wider mb-1">Product Description</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {selectedProduct.description}
                </p>
              </div>

              {/* Technical Specifications Grid */}
              <div>
                <h4 className="font-bold text-xs uppercase text-slate-400 tracking-wider mb-2">Technical Specifications</h4>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/90 text-xs">
                  {Object.entries(selectedProduct.specs).map(([specKey, specVal]) => (
                    <div key={specKey} className="overflow-hidden">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block truncate">{specKey}</span>
                      <strong className="text-slate-800 text-[11px] block truncate">{specVal}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Evidence Vault Policy Notice */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Autonomous Evidence Vaulting Protocol</span>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    Upon checkout, this item's price, buyer address, order confirmation, and carrier tracking number are automatically hashed with SHA-256 and stored in the Evidence Vault.
                  </p>
                </div>
              </div>

              {/* Buyer Checkout Form — required fields */}
              <div className="border border-slate-200 rounded-2xl p-4 space-y-3 bg-slate-50">
                <h4 className="font-bold text-xs uppercase text-slate-500 tracking-wider">Buyer Details (Required)</h4>
                {checkoutError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                    <span>⚠</span><span>{checkoutError}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2.5">
                  <input
                    type="text"
                    required
                    value={buyerForm.name}
                    onChange={(e) => { setBuyerForm({ ...buyerForm, name: e.target.value }); setCheckoutError(null); }}
                    placeholder="Your full name *"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all bg-white"
                  />
                  <input
                    type="email"
                    required
                    value={buyerForm.email}
                    onChange={(e) => { setBuyerForm({ ...buyerForm, email: e.target.value }); setCheckoutError(null); }}
                    placeholder="Email address *"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all bg-white"
                  />
                  <input
                    type="text"
                    required
                    value={buyerForm.address}
                    onChange={(e) => { setBuyerForm({ ...buyerForm, address: e.target.value }); setCheckoutError(null); }}
                    placeholder="Shipping address *"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 block font-medium">Total Checkout Price</span>
                <span className="text-2xl font-extrabold text-slate-900">
                  ${(selectedProduct.price_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedProduct(null)}
                  className="px-4 py-2.5 rounded-full border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Close
                </button>

                <button
                  onClick={() => handleBuyProduct(selectedProduct)}
                  disabled={buyingProductId === selectedProduct.id}
                  className="px-6 py-2.5 rounded-full bg-[#0070BA] hover:bg-[#003087] text-white text-xs font-bold transition-all shadow-md shadow-blue-800/30 flex items-center gap-2 disabled:opacity-50"
                >
                  {buyingProductId === selectedProduct.id ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShoppingBag className="w-4 h-4 text-[#FFC439]" />
                  )}
                  <span>Buy with PayPal Sandbox</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Captured Orders & Carrier Transit Stepper ── */}
      <div className="space-y-4 pt-6 border-t border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-[#0070BA]" />
            <h2 className="font-bold text-slate-900 text-base">Captured Orders &amp; Carrier Milestones</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
              {orders.length} in Vault
            </span>
          </div>
          <span className="text-xs text-emerald-600 font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Automatic Evidence Vault Synchronization
          </span>
        </div>

        {loadingOrders ? (
          <div className="bg-white p-8 rounded-2xl border border-slate-200/90 shadow-sm text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0070BA]" />
            <p className="text-xs">Loading orders from database...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-slate-200/90 shadow-sm text-center text-slate-500 text-xs">
            No orders captured yet. Click "Buy with PayPal Sandbox" on any product above to generate an order and evidence hash.
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((ord) => {
              const currentMilestoneIdx = MILESTONES.indexOf(ord.delivery_status as any);
              const isDelivered = ord.delivery_status === "DELIVERED";

              return (
                <div key={ord.id} className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
                  {/* Order Top Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-900">{ord.order_number}</span>
                        <span className="text-slate-400 text-xs">·</span>
                        <span className="font-extrabold text-slate-900 text-base">
                          ${(ord.total_cents / 100).toFixed(2)} {ord.currency}
                        </span>
                        <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold">
                          {ord.tracking_number}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500 mt-1 flex-wrap">
                        <span className="flex items-center gap-1"><User className="w-3 h-3 text-slate-400" /> {ord.buyer_name}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-400" /> {ord.shipping_address}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSimulateDispute(ord)}
                      disabled={disputingOrderId === ord.id}
                      className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-50"
                    >
                      {disputingOrderId === ord.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                      )}
                      <span>Open Simulated Dispute</span>
                    </button>
                  </div>

                  {/* Carrier Transit Stepper */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-[#0070BA]" /> Carrier Transit Milestones:
                      </span>
                      <button
                        onClick={() => handleAdvanceCarrier(ord.id)}
                        disabled={isDelivered || advancingOrderId === ord.id}
                        className="text-xs font-bold text-[#0070BA] hover:underline disabled:opacity-40 flex items-center gap-1"
                      >
                        {advancingOrderId === ord.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <span>Advance Milestone →</span>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-5 gap-2">
                      {MILESTONES.map((milestone, idx) => {
                        const isDone = currentMilestoneIdx >= idx;
                        const isCurrent = currentMilestoneIdx === idx;

                        return (
                          <button
                            key={milestone}
                            onClick={() => handleAdvanceCarrier(ord.id, milestone)}
                            className={`p-2.5 rounded-xl border text-left transition-all ${
                              isDone
                                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                                : "bg-slate-50 border-slate-200 text-slate-400"
                            } ${isCurrent ? "ring-2 ring-emerald-500 font-bold" : ""}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold uppercase">{milestone.replace(/_/g, " ")}</span>
                              {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                            </div>
                            <span className="text-[9px] text-slate-500 block">
                              {isDone ? "In Vault ✓" : "Pending"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
