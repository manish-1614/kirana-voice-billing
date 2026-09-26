import React from 'react';
import { HelpCircle, AlertTriangle, AlertOctagon, X, ArrowRight } from 'lucide-react';

export interface AmbiguityState {
  type: 'ambiguous' | 'not_found' | 'unit_mismatch' | 'no_tool_call' | 'error';
  message: string;
  query?: string;
  spokenQuantity?: string;
  candidates?: Array<{
    id: string;
    canonical_name: string;
    current_price: number;
    unit_type: string;
    similarity?: number;
  }>;
}

interface AmbiguityBannerProps {
  state: AmbiguityState | null;
  onSelectCandidate: (candidateName: string) => void;
  onDismiss: () => void;
}

export const AmbiguityBanner: React.FC<AmbiguityBannerProps> = ({
  state,
  onSelectCandidate,
  onDismiss,
}) => {
  if (!state) return null;

  return (
    <div
      className={`rounded-3xl p-5 border shadow-md transition-all animate-in fade-in slide-in-from-top-2 duration-200 ${
        state.type === 'ambiguous'
          ? 'bg-gradient-to-r from-amber-50 to-orange-50/50 border-amber-300/80 text-amber-950 shadow-amber-500/5'
          : state.type === 'unit_mismatch' || state.type === 'error'
          ? 'bg-gradient-to-r from-rose-50 to-pink-50/50 border-rose-300/80 text-rose-950 shadow-rose-500/5'
          : 'bg-gradient-to-r from-slate-100 to-zinc-100 border-slate-300 text-slate-900 shadow-slate-500/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className={`p-2.5 rounded-2xl shrink-0 mt-0.5 shadow-xs ${
              state.type === 'ambiguous'
                ? 'bg-amber-200/80 text-amber-900 border border-amber-300'
                : state.type === 'unit_mismatch' || state.type === 'error'
                ? 'bg-rose-200/80 text-rose-900 border border-rose-300'
                : 'bg-slate-200 text-slate-800 border border-slate-300'
            }`}
          >
            {state.type === 'unit_mismatch' || state.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 stroke-[2.25]" />
            ) : state.type === 'ambiguous' ? (
              <HelpCircle className="w-5 h-5 stroke-[2.25]" />
            ) : (
              <AlertOctagon className="w-5 h-5 stroke-[2.25]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm sm:text-base font-black tracking-tight">
                {state.type === 'ambiguous'
                  ? 'Multiple Items Found / कौन सा सामान चाहिए?'
                  : state.type === 'unit_mismatch'
                  ? 'Unit Mismatch / माप में अंतर'
                  : state.type === 'no_tool_call'
                  ? 'No Item Recognized / आवाज़ समझ नहीं आई'
                  : state.type === 'error'
                  ? 'Billing Error / बिलिंग में त्रुटि'
                  : 'Unrecognized Item / सामान सूची में नहीं मिला'}
              </h4>
              {state.query && (
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-lg bg-black/10 text-black/90">
                  &ldquo;{state.query}&rdquo;
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-black/75 mt-1 font-medium leading-relaxed">
              {state.message}
            </p>

            {/* Candidate Selection Buttons with Numeric Hotkeys */}
            {state.candidates && state.candidates.length > 0 && (
              <div className="mt-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-black/60">
                  <span>Press number key [1-9] or tap to pick:</span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {state.candidates.map((cand, idx) => (
                    <button
                      key={cand.id}
                      type="button"
                      onClick={() => onSelectCandidate(cand.canonical_name)}
                      className="group inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-white hover:bg-amber-100 border border-amber-300/90 text-slate-900 shadow-xs hover:shadow-md transition-all active:scale-95 text-left"
                    >
                      {/* Number shortcut key badge */}
                      <kbd className="w-5 h-5 rounded-md bg-amber-500 text-slate-950 font-mono font-black text-xs flex items-center justify-center shadow-2xs group-hover:scale-105 transition-transform">
                        {idx + 1}
                      </kbd>
                      <span className="text-xs sm:text-sm font-bold tracking-tight">
                        {cand.canonical_name}
                      </span>
                      <span className="text-xs text-amber-900 font-mono font-bold pl-1 border-l border-amber-200">
                        ₹{cand.current_price}/{cand.unit_type}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="p-2 rounded-xl text-black/50 hover:text-black hover:bg-black/10 transition-colors shrink-0 active:scale-90"
          title="Dismiss warning [Esc]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
