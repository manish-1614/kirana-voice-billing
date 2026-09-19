import React, { useState } from 'react';
import { Mic, MicOff, CheckCircle, PlusCircle, Send, Sparkles, Volume2 } from 'lucide-react';
import { SessionContext } from '@/lib/tool-dispatcher';

interface BillingControlsProps {
  session: SessionContext | null;
  itemsCount: number;
  subtotal: number;
  micState: 'idle' | 'listening' | 'processing';
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCloseBill: () => void;
  onStartNewBill: () => void;
  onSendTextPrompt: (text: string) => void;
}

export const BillingControls: React.FC<BillingControlsProps> = ({
  session,
  itemsCount,
  subtotal,
  micState,
  onStartRecording,
  onStopRecording,
  onCloseBill,
  onStartNewBill,
  onSendTextPrompt,
}) => {
  const [typedText, setTypedText] = useState('');

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = typedText.trim();
    if (clean) {
      onSendTextPrompt(clean);
      setTypedText('');
    }
  };

  const isClosed = session?.status === 'closed';

  return (
    <div className="space-y-4">
      {/* 1. Subtotal Display Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
          <span>Total Payable</span>
          <span>{itemsCount} {itemsCount === 1 ? 'item' : 'items'}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight font-mono">
            ₹{subtotal.toFixed(2)}
          </span>
        </div>
        {isClosed && (
          <div className="mt-2 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Bill Closed & Ready for Payment</span>
          </div>
        )}
      </div>

      {/* 2. The Big Ergonomic Hold-to-Talk Mic Button */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center">
        <div className="mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Voice Input
          </span>
        </div>

        <button
          type="button"
          onMouseDown={onStartRecording}
          onMouseUp={onStopRecording}
          onTouchStart={(e) => {
            e.preventDefault();
            onStartRecording();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            onStopRecording();
          }}
          disabled={micState === 'processing'}
          className={`w-full relative py-6 px-4 rounded-2xl font-bold flex flex-col items-center justify-center gap-2 transition-all shadow-md active:scale-95 select-none ${
            micState === 'listening'
              ? 'bg-rose-600 text-white shadow-rose-200 ring-8 ring-rose-100 animate-pulse'
              : micState === 'processing'
              ? 'bg-amber-500 text-white opacity-85 cursor-wait'
              : 'bg-slate-900 hover:bg-slate-800 text-white hover:shadow-lg'
          }`}
        >
          {/* Pulsing ring indicator */}
          {micState === 'listening' && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500"></span>
            </span>
          )}

          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              micState === 'listening'
                ? 'bg-white text-rose-600 shadow-inner'
                : 'bg-white/10 text-amber-400'
            }`}
          >
            <Mic className="w-7 h-7 stroke-[2.25]" />
          </div>

          <div className="space-y-0.5">
            <span className="text-base sm:text-lg font-black tracking-tight block">
              {micState === 'listening'
                ? 'LISTENING... (SPEAK NOW)'
                : micState === 'processing'
                ? 'PROCESSING UTTERANCE...'
                : 'HOLD TO TALK'}
            </span>
            <span className="text-xs text-slate-300 font-medium block">
              {micState === 'listening'
                ? 'Release when finished'
                : 'Press & hold button, or hold Spacebar'}
            </span>
          </div>
        </button>

        {/* Spacebar key helper */}
        <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <kbd className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-600 font-mono text-[11px] shadow-xs">
            Spacebar
          </kbd>
          <span>Hold to speak</span>
        </div>
      </div>

      {/* 3. Primary Bill Action Buttons */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={onCloseBill}
          disabled={isClosed || itemsCount === 0}
          className={`py-3 px-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm ${
            isClosed || itemsCount === 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-100'
          }`}
          title="Mark bill closed and totalize"
        >
          <CheckCircle className="w-4 h-4" />
          <span>Total Batao</span>
        </button>

        <button
          onClick={onStartNewBill}
          className="py-3 px-3 rounded-xl font-bold text-xs sm:text-sm bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm shadow-amber-100"
          title="Start next customer token"
        >
          <PlusCircle className="w-4 h-4" />
          <span>+ Naya Bill</span>
        </button>
      </div>

      {/* 4. Manual Text / Keyboard Fallback Input */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm">
        <form onSubmit={handleTextSubmit} className="flex gap-2">
          <input
            type="text"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder="Type item e.g. 'chini aadha kilo'..."
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 font-mono"
          />
          <button
            type="submit"
            disabled={!typedText.trim()}
            className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
