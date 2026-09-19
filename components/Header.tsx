import React from 'react';
import { ShoppingBag, Wifi, WifiOff, History, Key, CheckCircle2, Mic } from 'lucide-react';
import { SessionContext } from '@/lib/tool-dispatcher';

interface HeaderProps {
  session: SessionContext | null;
  wsConnected: boolean;
  geminiReady: boolean;
  micState: 'idle' | 'listening' | 'processing';
  onOpenRecent: () => void;
  onOpenPin: () => void;
  hasValidPin: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  wsConnected,
  geminiReady,
  micState,
  onOpenRecent,
  onOpenPin,
  hasValidPin,
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 px-4 sm:px-6 py-3.5 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand & Location */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                Kirana Voice Billing
              </h1>
              <span className="text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Ranchi
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              High-Speed Gemini Live Voice Counter
            </p>
          </div>
        </div>

        {/* Center: Active Token Badge */}
        {session && (
          <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700/80 rounded-xl px-3.5 py-1.5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                Bill
              </span>
              <span className="text-base sm:text-lg font-black text-amber-400 tracking-tight font-mono">
                Token #{session.customerNumber}
              </span>
            </div>
            <span className="h-4 w-px bg-slate-700 mx-0.5" />
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                session.status === 'open'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : session.status === 'resumed'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              {session.status}
            </span>
          </div>
        )}

        {/* Right: Connection State, Recent Bills, & PIN */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Audio / Engine Status indicator */}
          <div className="hidden sm:flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg px-2.5 py-1 text-xs">
            {wsConnected ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                {geminiReady ? 'Gemini Live Ready' : 'Connecting Engine...'}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-rose-400 font-medium">
                <WifiOff className="w-3.5 h-3.5" />
                Gateway Offline
              </span>
            )}
          </div>

          {/* Recent Bills Button */}
          <button
            onClick={onOpenRecent}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs sm:text-sm font-medium transition-colors active:scale-95"
            title="View today's bills"
          >
            <History className="w-4 h-4 text-amber-400" />
            <span>Bills</span>
          </button>

          {/* PIN Gate Button */}
          <button
            onClick={onOpenPin}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              hasValidPin
                ? 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                : 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
            }`}
            title="Shop PIN Settings"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">{hasValidPin ? 'PIN Active' : 'Enter PIN'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
