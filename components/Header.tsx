import React, { useState } from 'react';
import { ShoppingBag, Wifi, WifiOff, History, Key, CheckCircle2, Mic, Command, Keyboard, X } from 'lucide-react';
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
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  return (
    <>
      <header className="bg-slate-900 text-white border-b border-slate-800/80 px-4 sm:px-6 py-3 shadow-md sticky top-0 z-30 backdrop-blur-md bg-slate-900/95">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: Brand & Location Badge */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400/20 to-amber-600/10 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
              <ShoppingBag className="w-5 h-5 stroke-[2.25]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-1.5">
                  Kirana Voice
                  <span className="text-amber-400 font-bold">Billing</span>
                </h1>
                <span className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Ranchi Hub
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Gemini Live Voice Engine · Zero-Latency Pipeline
              </p>
            </div>
          </div>

          {/* Center: Active Token Badge */}
          {session && (
            <div className="flex items-center gap-2.5 bg-slate-800/95 border border-slate-700/80 rounded-xl px-3.5 py-1.5 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">
                  Active Bill
                </span>
                <span className="text-base sm:text-lg font-black text-amber-400 tracking-tight font-mono font-tabular">
                  #{session.customerNumber}
                </span>
              </div>
              <span className="h-4 w-px bg-slate-700 mx-0.5" />
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                  session.status === 'open'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : session.status === 'resumed'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : session.status === 'closed'
                    ? 'bg-slate-700 text-slate-300 border border-slate-600'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                {session.status}
              </span>
            </div>
          )}

          {/* Right: Shortcuts Guide, Status, Recent Bills & PIN */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Keyboard Shortcuts Trigger Button */}
            <button
              onClick={() => setShowShortcutsModal(true)}
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 text-slate-300 text-xs font-semibold transition-all active:scale-95"
              title="Keyboard Shortcuts"
            >
              <Keyboard className="w-3.5 h-3.5 text-amber-400" />
              <span>Keys</span>
            </button>

            {/* Audio / Engine Status indicator */}
            <div className="hidden md:flex items-center gap-2 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs">
              {wsConnected ? (
                <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  {geminiReady ? 'Live Ready' : 'Syncing Engine...'}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
                  <WifiOff className="w-3.5 h-3.5" />
                  Offline
                </span>
              )}
            </div>

            {/* Recent Bills Button */}
            <button
              onClick={onOpenRecent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-slate-200 text-xs sm:text-sm font-semibold transition-all active:scale-95 shadow-xs"
              title="View today's bills history"
            >
              <History className="w-4 h-4 text-amber-400" />
              <span>Bills</span>
            </button>

            {/* PIN Gate Button */}
            <button
              onClick={onOpenPin}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
                hasValidPin
                  ? 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                  : 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
              }`}
              title="Shop PIN Settings"
            >
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden lg:inline">{hasValidPin ? 'PIN Active' : 'Enter PIN'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-black tracking-tight">Counter Keyboard Shortcuts</h3>
              </div>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <span className="text-slate-300 font-medium">Hold to Talk / Speak</span>
                <kbd className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-amber-400 font-mono font-bold text-xs shadow-xs">
                  Spacebar (Hold)
                </kbd>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <span className="text-slate-300 font-medium">Close Bill & Calculate Total</span>
                <kbd className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-emerald-400 font-mono font-bold text-xs shadow-xs">
                  T
                </kbd>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <span className="text-slate-300 font-medium">Start Next Customer Bill</span>
                <kbd className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-amber-400 font-mono font-bold text-xs shadow-xs">
                  N
                </kbd>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <span className="text-slate-300 font-medium">Select Disambiguation Item</span>
                <kbd className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-cyan-400 font-mono font-bold text-xs shadow-xs">
                  1, 2, 3...
                </kbd>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <span className="text-slate-300 font-medium">Dismiss Warning / Banner</span>
                <kbd className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-400 font-mono font-bold text-xs shadow-xs">
                  Esc
                </kbd>
              </div>
            </div>

            <div className="pt-2 text-center">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors shadow-sm"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
