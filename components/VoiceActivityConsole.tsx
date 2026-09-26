import React from 'react';
import { Mic, Activity, CheckCircle2, AlertCircle, Sparkles, Volume2, Radio } from 'lucide-react';

export interface VoiceLogItem {
  id: string;
  timestamp: string;
  detectedText: string;
  tool: string;
  status: 'ok' | 'ambiguous' | 'not_found' | 'unit_mismatch' | 'error';
  details?: string;
}

interface VoiceActivityConsoleProps {
  micState: 'idle' | 'listening' | 'processing';
  interimTranscript: string;
  lastDetectedSpeech: string;
  lastAiThought: string;
  volumeLevel: number;
  history: VoiceLogItem[];
}

export const VoiceActivityConsole: React.FC<VoiceActivityConsoleProps> = ({
  micState,
  interimTranscript,
  lastDetectedSpeech,
  lastAiThought,
  volumeLevel,
  history,
}) => {
  // Normalize volume for VU meter bars (0-100)
  const volPct = Math.min(100, Math.max(0, volumeLevel));

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 text-white shadow-2xl transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left: Live Audio Feed & VU Equalizer */}
          <div className="flex items-center gap-3.5 flex-1 min-w-0">
            {/* Mic State Icon & Reactive VU Meter */}
            <div className="relative shrink-0 flex items-center gap-2">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-200 ${
                  micState === 'listening'
                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 ring-4 ring-rose-500/20'
                    : micState === 'processing'
                    ? 'bg-amber-500 text-slate-950 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border border-slate-700/80'
                }`}
              >
                <Mic className="w-5 h-5 stroke-[2.25]" />
              </div>

              {/* Dynamic VU Meter Bar Equalizer */}
              {micState === 'listening' && (
                <div className="flex items-end gap-1 h-7 px-1.5 py-0.5 bg-slate-800/80 rounded-lg border border-slate-700/60">
                  {[0.4, 0.8, 1.0, 0.6, 0.3].map((mult, i) => {
                    const barHeight = Math.max(15, Math.min(100, (volPct * mult) + 15));
                    return (
                      <span
                        key={i}
                        className="w-1 rounded-full bg-gradient-to-t from-rose-500 to-amber-400 transition-all duration-75"
                        style={{ height: `${barHeight}%` }}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Transcription Stream & Status */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  {micState === 'listening' ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                      <span className="text-rose-400 font-mono">Listening Live...</span>
                    </>
                  ) : micState === 'processing' ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-spin" />
                      <span className="text-amber-400 font-mono">Gemini Voice Recognition...</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-slate-400">Last Voice Input</span>
                    </>
                  )}
                </span>

                {micState === 'listening' && (
                  <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                    Decibel: {volPct}%
                  </span>
                )}
              </div>

              {/* Speech Readout */}
              <div className="text-sm sm:text-base font-bold text-slate-100 truncate mt-0.5 font-mono">
                {micState === 'listening' ? (
                  interimTranscript ? (
                    <span className="text-amber-300 animate-in fade-in duration-100 tracking-tight">
                      &ldquo;{interimTranscript}&rdquo;
                    </span>
                  ) : (
                    <span className="text-slate-400 italic font-sans font-medium text-xs sm:text-sm">
                      Listening for items (e.g. &ldquo;chini aadha kilo&rdquo;, &ldquo;total batao&rdquo;)...
                    </span>
                  )
                ) : micState === 'processing' ? (
                  <span className="text-amber-400 font-sans font-semibold text-xs sm:text-sm flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                    <span>Resolving spoken grocery items and quantities...</span>
                  </span>
                ) : lastDetectedSpeech ? (
                  <span className="text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">&ldquo;{lastDetectedSpeech}&rdquo;</span>
                  </span>
                ) : (
                  <span className="text-slate-500 italic font-sans font-normal text-xs">
                    Hold Spacebar or the voice button to add items by voice
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: History Feed Pills */}
          {history.length > 0 && (
            <div className="hidden lg:flex items-center gap-2 shrink-0 border-l border-slate-800/80 pl-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Log:
              </span>
              <div className="flex items-center gap-2 max-w-md overflow-hidden">
                {history.slice(0, 2).map((item) => (
                  <div
                    key={item.id}
                    className={`px-3 py-1 rounded-xl text-xs font-mono font-medium truncate max-w-[200px] border shadow-2xs flex items-center gap-1.5 ${
                      item.status === 'ok'
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
                        : 'bg-amber-950/60 text-amber-300 border-amber-800/80'
                    }`}
                    title={`${item.detectedText} (${item.timestamp})`}
                  >
                    <span className="text-[10px] opacity-60">{item.timestamp}</span>
                    <span className="font-bold truncate">&ldquo;{item.detectedText}&rdquo;</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
