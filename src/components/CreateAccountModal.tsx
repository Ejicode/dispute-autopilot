'use client';

import React, { useState } from 'react';
import { X, Check, Building2, User, Mail, Sparkles, ShieldCheck, Image as ImageIcon } from 'lucide-react';
import { useUser, CURATED_AVATARS } from './UserContext';

export default function CreateAccountModal() {
  const { isCreateModalOpen, closeCreateModal, createAccount } = useUser();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    store_name: '',
    avatar_url: CURATED_AVATARS[0],
  });
  const [useCustomUrl, setUseCustomUrl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isCreateModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.name.trim() || !formData.email.trim() || !formData.store_name.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    const res = await createAccount({
      name: formData.name.trim(),
      email: formData.email.trim(),
      store_name: formData.store_name.trim(),
      avatar_url: formData.avatar_url.trim(),
    });

    setLoading(false);
    if (!res.success) {
      setError(res.error || 'Failed to create merchant account.');
    } else {
      setFormData({
        name: '',
        email: '',
        store_name: '',
        avatar_url: CURATED_AVATARS[0],
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header (PayPal Blue Gradient) */}
        <div className="bg-gradient-to-r from-[#003087] via-[#0070BA] to-[#009CDE] p-6 text-white relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-white/15 backdrop-blur-sm">
                <Sparkles className="w-5 h-5 text-[#FFC439]" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Create Merchant Account</h3>
                <p className="text-xs text-white/80">Add your store to DisputeAI defense network</p>
              </div>
            </div>
            <button
              onClick={closeCreateModal}
              className="p-1.5 rounded-full hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Merchant Contact Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Alex Morgan"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Store / Company Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={formData.store_name}
                  onChange={(e) => setFormData({ ...formData, store_name: e.target.value })}
                  placeholder="e.g. Horizon Audio & Gear"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Business Email Address <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="e.g. alex@horizonaudio.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-medium"
                />
              </div>
            </div>

            {/* Profile Picture / Avatar Selector */}
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Merchant Profile Picture
                </label>
                <button
                  type="button"
                  onClick={() => setUseCustomUrl(!useCustomUrl)}
                  className="text-[11px] font-semibold text-[#0070BA] hover:underline"
                >
                  {useCustomUrl ? 'Choose from portraits' : 'Use custom photo URL'}
                </button>
              </div>

              {!useCustomUrl ? (
                <div className="grid grid-cols-6 gap-2 py-1">
                  {CURATED_AVATARS.map((url, i) => {
                    const isSelected = formData.avatar_url === url;
                    return (
                      <button
                        type="button"
                        key={url}
                        onClick={() => setFormData({ ...formData, avatar_url: url })}
                        className={`relative rounded-full aspect-square overflow-hidden group transition-all duration-200 ${
                          isSelected
                            ? 'ring-4 ring-[#0070BA] ring-offset-2 scale-105'
                            : 'opacity-70 hover:opacity-100 hover:scale-105'
                        }`}
                        title={`Photo ${i + 1}`}
                      >
                        <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                        {isSelected && (
                          <div className="absolute inset-0 bg-[#0070BA]/30 flex items-center justify-center">
                            <Check className="w-4 h-4 text-white stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="relative">
                  <ImageIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                  <input
                    type="url"
                    value={formData.avatar_url}
                    onChange={(e) => setFormData({ ...formData, avatar_url: e.target.value })}
                    placeholder="https://images.unsplash.com/photo-..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all font-mono"
                  />
                </div>
              )}
            </div>

            {/* Live Profile Card Preview */}
            <div className="mt-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3.5">
              <div className="relative shrink-0">
                <img
                  src={formData.avatar_url || CURATED_AVATARS[0]}
                  alt="Preview"
                  className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow-sm"
                />
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-slate-900 truncate">
                    {formData.name || 'New Merchant'}
                  </span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#0070BA] shrink-0" />
                </div>
                <span className="text-xs text-slate-500 font-medium block truncate">
                  {formData.store_name || 'Store Name Preview'}
                </span>
                <span className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider block">
                  ● PayPal Seller Protection Eligible
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex items-center gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={closeCreateModal}
              className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#003087] to-[#0070BA] hover:from-[#002566] hover:to-[#005a96] text-white text-xs font-bold transition-all shadow-md shadow-blue-800/25 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <span>Registering Store...</span>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#FFC439]" />
                  <span>Create &amp; Activate Account</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
