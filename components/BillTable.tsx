import React from 'react';
import { ShoppingCart, Pencil, Trash2, Tag, Sparkles, CornerDownRight, Mic } from 'lucide-react';

export interface BillItem {
  id: string;
  session_id: string;
  item_id: string;
  quantity: number;
  unit: string;
  spoken_quantity_label?: string;
  unit_price_used: number;
  is_price_override: boolean;
  line_total: number;
  created_at: string;
  items?: {
    canonical_name: string;
    unit_type: string;
    current_price: number;
  };
}

interface BillTableProps {
  items: BillItem[];
  onEditItem: (item: BillItem) => void;
  onDeleteItem: (id: string) => void;
  onQuickSimulate?: (phrase: string) => void;
}

export const BillTable: React.FC<BillTableProps> = ({
  items,
  onEditItem,
  onDeleteItem,
  onQuickSimulate,
}) => {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200/90 p-8 sm:p-12 shadow-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 mx-auto flex items-center justify-center text-amber-600 mb-4 shadow-inner">
          <ShoppingCart className="w-8 h-8 stroke-[1.75]" />
        </div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight">
          Current Bill is Empty / बिल खाली है
        </h3>
        <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto font-medium">
          Hold down <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700 font-mono text-xs font-semibold">Spacebar</kbd> or the mic button and speak grocery items in Hindi or English.
        </p>

        {/* Spoken Prompts Quick Launcher Guide */}
        <div className="mt-8 max-w-xl mx-auto">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 mb-3.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Click or speak these Ranchi Kirana phrases:</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
            {[
              { phrase: 'chini aadha kilo', desc: '500g Sugar (Chini)', key: '½ kg' },
              { phrase: 'aata 2 kilo', desc: '2kg Aashirvaad Atta', key: '2 kg' },
              { phrase: 'sarson tel 1 litre', desc: '1L Mustard Oil', key: '1 L' },
              { phrase: '2 packet maggi', desc: 'Packaged count item', key: '2 pcs' },
              { phrase: 'chini 70 me lagao 1 kilo', desc: 'Negotiated price override', key: 'Override' },
              { phrase: 'total batao', desc: 'Close bill and compute final total', key: 'Final' },
            ].map(({ phrase, desc, key }) => (
              <button
                key={phrase}
                type="button"
                onClick={() => onQuickSimulate?.(phrase)}
                className="group flex items-start justify-between p-3 rounded-2xl bg-slate-50 hover:bg-amber-50/80 border border-slate-200/80 hover:border-amber-400/80 text-left transition-all active:scale-[0.98] shadow-2xs hover:shadow-sm"
              >
                <div className="space-y-0.5">
                  <div className="text-xs sm:text-sm font-bold text-slate-800 group-hover:text-amber-950 font-mono flex items-center gap-1">
                    <CornerDownRight className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>&ldquo;{phrase}&rdquo;</span>
                  </div>
                  <div className="text-[11px] text-slate-500 group-hover:text-amber-800 font-medium pl-4">
                    {desc}
                  </div>
                </div>
                <span className="text-[10px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-white group-hover:bg-amber-100 text-slate-600 group-hover:text-amber-900 border border-slate-200 group-hover:border-amber-300 shrink-0">
                  {key}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4">Item & Voice Recognition</th>
              <th className="py-3 px-4 w-28">Quantity</th>
              <th className="py-3 px-4 w-32">Rate</th>
              <th className="py-3 px-4 w-32 text-right">Line Total</th>
              <th className="py-3 px-4 w-24 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-sans">
            {items.map((item, idx) => {
              const name = item.items?.canonical_name || 'Item';
              const catalogPrice = item.items?.current_price;
              const isLast = idx === items.length - 1;

              return (
                <tr
                  key={item.id}
                  className={`group transition-all duration-200 hover:bg-amber-50/40 ${
                    isLast ? 'animate-row-flash bg-amber-50/20' : ''
                  }`}
                >
                  {/* Row Number */}
                  <td className="py-3.5 px-4 text-xs font-bold text-slate-400 text-center font-mono font-tabular">
                    {idx + 1}
                  </td>

                  {/* Item Canonical Name & Spoken Label */}
                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                        {name}
                      </span>

                      {item.is_price_override && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
                          <Tag className="w-2.5 h-2.5" />
                          Price Override
                        </span>
                      )}

                      {isLast && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs animate-pulse">
                          Just Added
                        </span>
                      )}
                    </div>

                    {item.spoken_quantity_label && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono mt-0.5">
                        <Mic className="w-3 h-3 text-amber-600 shrink-0" />
                        <span className="italic text-slate-600">
                          &ldquo;{item.spoken_quantity_label}&rdquo;
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Quantity */}
                  <td className="py-3.5 px-4">
                    <div className="inline-flex items-baseline gap-1 px-2.5 py-1 rounded-xl bg-slate-100 text-slate-900 font-mono font-bold text-xs sm:text-sm font-tabular border border-slate-200/80">
                      <span>{item.quantity}</span>
                      <span className="text-slate-500 text-xs font-normal">{item.unit}</span>
                    </div>
                  </td>

                  {/* Unit Price Used (with override strikethrough if modified) */}
                  <td className="py-3.5 px-4">
                    <div className="text-xs sm:text-sm font-semibold text-slate-700 font-mono font-tabular">
                      {item.is_price_override && catalogPrice && catalogPrice !== item.unit_price_used ? (
                        <div className="flex items-baseline gap-1.5">
                          <span className="line-through text-slate-400 text-xs">
                            ₹{catalogPrice}
                          </span>
                          <span className="text-purple-700 font-bold">
                            ₹{item.unit_price_used.toFixed(2)}
                          </span>
                        </div>
                      ) : (
                        <span>₹{item.unit_price_used.toFixed(2)}</span>
                      )}
                      <span className="text-[11px] text-slate-400 font-normal ml-0.5">
                        /{item.unit}
                      </span>
                    </div>
                  </td>

                  {/* Line Total */}
                  <td className="py-3.5 px-4 text-right">
                    <span className="text-base sm:text-lg font-black text-slate-900 font-mono font-tabular tracking-tight">
                      ₹{item.line_total.toFixed(2)}
                    </span>
                  </td>

                  {/* Actions (Large touch targets for counter ergonomics) */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onEditItem(item)}
                        className="p-2 rounded-xl text-slate-400 hover:text-amber-800 hover:bg-amber-100 transition-colors active:scale-90"
                        title="Edit quantity or rate"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-100 transition-colors active:scale-90"
                        title="Remove item from bill"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
