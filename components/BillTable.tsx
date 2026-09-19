import React from 'react';
import { ShoppingCart, Pencil, Trash2, Tag, Sparkles, AlertCircle } from 'lucide-react';

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
      <div className="bg-white rounded-2xl border border-slate-200/80 p-8 sm:p-12 shadow-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200/60 mx-auto flex items-center justify-center text-amber-600 mb-4 shadow-sm">
          <ShoppingCart className="w-8 h-8 stroke-[1.75]" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 tracking-tight">
          Current Bill is Empty
        </h3>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          Hold down the microphone button (or press Spacebar) and call out items.
        </p>

        {/* Spoken Prompts Guide */}
        <div className="mt-8 max-w-lg mx-auto">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Try speaking these Ranchi kirana phrases:</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
            {[
              { phrase: 'chini aadha kilo', desc: '500g Sugar (Chini)' },
              { phrase: 'aata 2 kilo', desc: '2kg Aashirvaad Atta' },
              { phrase: 'sarson tel 1 litre', desc: '1L Mustard Oil' },
              { phrase: '2 packet maggi', desc: 'Packaged count item' },
              { phrase: 'chini 70 me lagao 1 kilo', desc: 'Negotiated price override' },
              { phrase: 'total batao', desc: 'Close bill and compute final total' },
            ].map(({ phrase, desc }) => (
              <button
                key={phrase}
                type="button"
                onClick={() => onQuickSimulate?.(phrase)}
                className="group flex flex-col p-3 rounded-xl bg-slate-50 hover:bg-amber-50/70 border border-slate-200/70 hover:border-amber-300 text-left transition-all active:scale-[0.98]"
              >
                <span className="text-sm font-semibold text-slate-800 group-hover:text-amber-900 font-mono">
                  &ldquo;{phrase}&rdquo;
                </span>
                <span className="text-xs text-slate-500 group-hover:text-amber-700 mt-0.5">
                  {desc}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4">Item Name</th>
              <th className="py-3 px-4 w-28">Quantity</th>
              <th className="py-3 px-4 w-28">Rate</th>
              <th className="py-3 px-4 w-28 text-right">Total</th>
              <th className="py-3 px-4 w-20 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-sans">
            {items.map((item, idx) => {
              const name = item.items?.canonical_name || 'Item';
              const isLast = idx === items.length - 1;

              return (
                <tr
                  key={item.id}
                  className={`group transition-colors hover:bg-amber-50/30 ${
                    isLast ? 'bg-amber-50/20' : ''
                  }`}
                >
                  {/* Row Number */}
                  <td className="py-3.5 px-4 text-xs font-semibold text-slate-400 text-center font-mono">
                    {idx + 1}
                  </td>

                  {/* Item Canonical Name & Spoken Label */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                        {name}
                      </span>
                      {item.is_price_override && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                          <Tag className="w-2.5 h-2.5" />
                          Override
                        </span>
                      )}
                      {isLast && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                          Latest
                        </span>
                      )}
                    </div>
                    {item.spoken_quantity_label && (
                      <span className="text-xs text-slate-500 italic mt-0.5 block font-mono">
                        spoken: &ldquo;{item.spoken_quantity_label}&rdquo;
                      </span>
                    )}
                  </td>

                  {/* Quantity */}
                  <td className="py-3.5 px-4">
                    <div className="text-sm sm:text-base font-bold text-slate-800 font-mono">
                      {item.quantity} {item.unit}
                    </div>
                  </td>

                  {/* Unit Price Used */}
                  <td className="py-3.5 px-4">
                    <div className="text-sm font-semibold text-slate-600 font-mono">
                      ₹{item.unit_price_used.toFixed(2)}
                      <span className="text-xs text-slate-400 font-normal">
                        /{item.unit}
                      </span>
                    </div>
                  </td>

                  {/* Line Total */}
                  <td className="py-3.5 px-4 text-right">
                    <span className="text-base sm:text-lg font-black text-slate-900 font-mono">
                      ₹{item.line_total.toFixed(2)}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onEditItem(item)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-100/80 transition-colors"
                        title="Edit this row"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Delete this row"
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
