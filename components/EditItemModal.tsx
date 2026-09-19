import React, { useState } from 'react';
import { X, Trash2, Check, Tag } from 'lucide-react';
import { BillItem } from './BillTable';

interface EditItemModalProps {
  item: BillItem | null;
  onClose: () => void;
  onSave: (id: string, newQuantityText?: string, newPriceOverride?: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const EditItemModal: React.FC<EditItemModalProps> = ({
  item,
  onClose,
  onSave,
  onDelete,
}) => {
  if (!item) return null;

  const [quantityText, setQuantityText] = useState(item.spoken_quantity_label || `${item.quantity} ${item.unit}`);
  const [priceOverride, setPriceOverride] = useState<string>(
    item.is_price_override ? item.unit_price_used.toString() : ''
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedPrice = priceOverride.trim() ? parseFloat(priceOverride) : undefined;
      await onSave(item.id, quantityText.trim() || undefined, parsedPrice);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete(item.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const name = item.items?.canonical_name || 'Item';
  const unit = item.unit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-md p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Edit Line Item
            </span>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight mt-0.5">
              {name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Quantity Input */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Quantity / Spoken Unit
            </label>
            <input
              type="text"
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
              placeholder="e.g. 1 paav, 500g, 2 kilo"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 font-mono"
            />
            {/* Quick Chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {unit === 'kg' ? (
                <>
                  {['1 paav', 'aadha kilo', '1 kilo', '2 kilo'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setQuantityText(chip)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-100 text-xs font-semibold text-slate-700 hover:text-amber-900 transition-colors font-mono"
                    >
                      {chip}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {['1', '2', '3', '5', '10'].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuantityText(`${num} ${unit}`)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-100 text-xs font-semibold text-slate-700 hover:text-amber-900 transition-colors font-mono"
                    >
                      {num} {unit}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Negotiated Price Override Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Rate (Price Override)
              </label>
              <span className="text-xs text-slate-400 font-mono">
                Catalog: ₹{item.items?.current_price || item.unit_price_used}/{unit}
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-sm font-bold text-slate-400 font-mono">
                ₹
              </span>
              <input
                type="number"
                step="0.5"
                value={priceOverride}
                onChange={(e) => setPriceOverride(e.target.value)}
                placeholder={`${item.items?.current_price || item.unit_price_used} (standard rate)`}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3.5 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 font-mono"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Leaves catalog untouched. Affects this transaction only.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="px-3.5 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Row</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black flex items-center gap-1.5 transition-all shadow-sm active:scale-95 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
