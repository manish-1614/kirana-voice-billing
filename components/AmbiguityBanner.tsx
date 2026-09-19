import React from 'react';
import { HelpCircle, AlertTriangle, Check, X } from 'lucide-react';

export interface AmbiguityState {
  type: 'ambiguous' | 'not_found' | 'unit_mismatch';
  message: string;
  query?: string;
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
      className={`rounded-2xl p-4 border shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-200 ${
        state.type === 'ambiguous'
          ? 'bg-amber-50/90 border-amber-300 text-amber-950'
          : state.type === 'unit_mismatch'
          ? 'bg-rose-50/90 border-rose-300 text-rose-950'
          : 'bg-slate-100 border-slate-300 text-slate-900'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded-xl mt-0.5 ${
              state.type === 'ambiguous'
                ? 'bg-amber-200/60 text-amber-800'
                : state.type === 'unit_mismatch'
                ? 'bg-rose-200/60 text-rose-800'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {state.type === 'unit_mismatch' ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <HelpCircle className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold tracking-tight">
                {state.type === 'ambiguous'
                  ? 'Which item did you mean?'
                  : state.type === 'unit_mismatch'
                  ? 'Unit Mismatch'
                  : 'Unrecognized Item'}
              </h4>
              {state.query && (
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-black/5 text-black/80">
                  &ldquo;{state.query}&rdquo;
                </span>
              )}
            </div>
            <p className="text-xs text-black/70 mt-0.5 font-medium">{state.message}</p>

            {/* Candidate Quick Selection Chips */}
            {state.candidates && state.candidates.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-black/60">Tap to select:</span>
                {state.candidates.map((cand) => (
                  <button
                    key={cand.id}
                    onClick={() => onSelectCandidate(cand.canonical_name)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100/90 border border-amber-300 text-xs font-bold text-slate-900 shadow-xs hover:shadow-sm transition-all active:scale-95"
                  >
                    <span>{cand.canonical_name}</span>
                    <span className="text-amber-800 font-mono">₹{cand.current_price}/{cand.unit_type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 rounded-lg text-black/40 hover:text-black/80 hover:bg-black/5 transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
