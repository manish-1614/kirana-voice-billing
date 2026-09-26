import React, { useState } from 'react';
import { Mic, CheckCircle, PlusCircle, Send, Sparkles, Volume2, Radio, Check } from 'lucide-react';
import { SessionContext } from '@/lib/tool-dispatcher';

interface BillingControlsProps {
  session: SessionContext | null;
  itemsCount: number;
  subtotal: number;
  micState: 'idle' | 'listening' | 'processing';
  volumeLevel?: number;
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
  volumeLevel = 0,
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
      {/* 1. Subtotal Display Card (Billboard Display) */}
      <div className={`rounded-3xl border p-5 sm:p-6 shadow-sm transition-all relative overflow-hidden ${
        isClosed
          ? 'bg-gradient-to-br from-emerald-900 to-slate-900 border-emerald-500/40 text-white shadow-emerald-950/20'
          : 'bg-white border-slate-200/90 text-slate-900'
      }`}>
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2">
          <span className={isClosed ? 'text-emerald-300' : 'text-slate-400'}>
            Total Payable / कुल देय
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono ${
            isClosed ? 'bg-emerald-800/80 text-emerald-200' : 'bg-slate-100 text-slate-600'
          }`}>
            {itemsCount} {itemsCount === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="flex items-baseline gap-1">
          <span className={`text-2xl sm:text-3xl font-bold font-mono ${
            isClosed ? 'text-emerald-300' : 'text-slate-400'
          }`}>
            ₹
          </span>
          <span className={`text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight font-mono font-tabular ${
            isClosed ? 'text-white' : 'text-slate-900'
          }`}>
            {subtotal.toFixed(2)}
          </span>
        </div>

        {isClosed ? (
          <div className="mt-3 text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Bill Closed · Ready for QR / Cash Payment</span>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Customer Token #{session?.customerNumber || 1}</span>
            <span>Live updating</span>
          </div>
        )}
      </div>

      {/* 2. The Big Ergonomic Hold-to-Talk Mic Button */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-sm text-center relative overflow-hidden">
        {/* Shimmer line when processing */}
        {micState === 'processing' && (
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-laser-shimmer" />
        )}

        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Voice Mic / बोलकर जोड़ें
          </span>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            {micState === 'listening' ? (
              <span className="flex items-center gap-1 text-rose-600 font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-rose-600" />
                LIVE REC {volumeLevel > 0 ? `· ${volumeLevel}%` : ''}
              </span>
            ) : micState === 'processing' ? (
              <span className="text-amber-600 font-semibold">Analyzing...</span>
            ) : (
              <span className="text-slate-400">Idle / Ready</span>
            )}
          </div>
        </div>

        {/* Primary Tactile Button */}
        <div className="relative flex justify-center items-center">
          {/* Reactive Outer Glow Rings */}
          {micState === 'listening' && (
            <>
              <span className="absolute w-28 h-28 rounded-full bg-rose-500/20 animate-ring-wave pointer-events-none" />
              <span
                className="absolute w-24 h-24 rounded-full bg-rose-500/30 transition-transform duration-75 pointer-events-none"
                style={{ transform: `scale(${1 + (volumeLevel / 100) * 0.4})` }}
              />
            </>
          )}

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
            className={`w-full relative py-7 px-5 rounded-2xl font-bold flex flex-col items-center justify-center gap-3 transition-all duration-150 select-none cursor-pointer ${
              micState === 'listening'
                ? 'bg-rose-600 text-white shadow-xl shadow-rose-600/30 scale-[0.98]'
                : micState === 'processing'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                : 'bg-slate-900 hover:bg-slate-800 text-white shadow-md hover:shadow-lg active:scale-[0.98]'
            }`}
          >
            {/* Mic Glyph Container with separate, decorative processing background */}
            <div className="relative flex items-center justify-center">
              {/* Decorative processing-only background pulse (aria-hidden, pointer-events-none) */}
              {micState === 'processing' && (
                <div
                  aria-hidden="true"
                  className="absolute -inset-2.5 rounded-3xl bg-amber-400/40 blur-xs animate-processing-pulse pointer-events-none"
                />
              )}

              {/* Mic Icon Wrapper - remains static in all states */}
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200 relative z-10 ${
                  micState === 'listening'
                    ? 'bg-white text-rose-600 shadow-inner'
                    : micState === 'processing'
                    ? 'bg-white text-amber-600 shadow-inner'
                    : 'bg-white/10 text-amber-400 group-hover:scale-105'
                }`}
              >
                <Mic className="w-8 h-8 stroke-[2.25]" />
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-lg sm:text-xl font-black tracking-tight block">
                {micState === 'listening'
                  ? 'LISTENING... RELEASE TO SEND'
                  : micState === 'processing'
                  ? 'GEMINI LIVE DECODING...'
                  : 'HOLD TO TALK / बोलें'}
              </span>
              <span className="text-xs text-slate-300 font-medium block">
                {micState === 'listening'
                  ? 'Speak grocery items in Hindi/Hinglish'
                  : 'Press and hold button or hold Spacebar'}
              </span>
            </div>
          </button>
        </div>

        {/* Spacebar key shortcut helper */}
        <div className="mt-3.5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <kbd className="px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-700 font-mono font-bold text-[11px] shadow-2xs">
            Spacebar
          </kbd>
          <span className="font-medium">Hold to speak from counter</span>
        </div>
      </div>

      {/* 3. Primary Bill Action Buttons */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={onCloseBill}
          disabled={isClosed || itemsCount === 0}
          className={`py-3.5 px-3 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm relative overflow-hidden ${
            isClosed || itemsCount === 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
          }`}
          title="Mark bill closed and calculate final total [Shortcut: T]"
        >
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>Total Batao</span>
          <kbd className={`hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-mono ${
            isClosed || itemsCount === 0 ? 'bg-slate-200 text-slate-400' : 'bg-emerald-700 text-emerald-100'
          }`}>
            T
          </kbd>
        </button>

        <button
          onClick={onStartNewBill}
          className="py-3.5 px-3 rounded-2xl font-bold text-xs sm:text-sm bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm shadow-amber-500/20"
          title="Start next customer bill token [Shortcut: N]"
        >
          <PlusCircle className="w-4 h-4 shrink-0" />
          <span>+ Naya Bill</span>
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-amber-600 text-amber-950 text-[10px] font-mono font-bold">
            N
          </kbd>
        </button>
      </div>

      {/* 4. Manual Text / Keyboard Fallback Input */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-sm">
        <form onSubmit={handleTextSubmit} className="flex gap-2">
          <input
            type="text"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder="Type item e.g. 'chini aadha kilo'..."
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 font-mono transition-all"
          />
          <button
            type="submit"
            disabled={!typedText.trim()}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center active:scale-95 shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
