import React from 'react';
import { Mic, Activity, CheckCircle2, AlertCircle, Sparkles, Volume2 } from 'lucide-react';

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
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 text-white shadow-2xl transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left: Current Active Voice Status */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Pulsing Mic Badge with Live Volume Ring */}
            <div className="relative shrink-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  micState === 'listening'
                    ? 'bg-rose-500 text-white shadow-md shadow-rose-500/40 ring-4 ring-rose-500/20'
                    : micState === 'processing'
                    ? 'bg-amber-500 text-slate-950 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <Mic className="w-5 h-5 stroke-[2.25]" />
              </div>
              {/* Mic Input Level Indicator dot */}
              {micState === 'listening' && (
                <span
                  className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-slate-900 transition-transform"
                  style={{ transform: `scale(${Math.max(0.8, 1 + volumeLevel / 100)})` }}
                />
              )}
            </div>

            {/* Transcription / Heard Speech Text */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {micState === 'listening'
                    ? 'Listening (Live Mic)'
                    : micState === 'processing'
                    ? 'AI Decoding Audio...'
                    : 'Last Detected Command'}
                </span>
                {micState === 'listening' && (
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                    <span className="text-[11px] text-rose-300 font-mono">
                      Input Level: {volumeLevel}%
                    </span>
                  </div>
                )}
              </div>

              {/* Main text box */}
              <div className="text-sm sm:text-base font-bold text-slate-100 truncate mt-0.5 font-mono">
                {micState === 'listening' ? (
                  interimTranscript ? (
                    <span className="text-amber-300 animate-in fade-in duration-100">
                      &ldquo;{interimTranscript}&rdquo;
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">
                      Speak item and quantity (e.g. &ldquo;chini aadha kilo&rdquo;)...
                    </span>
                  )
                ) : micState === 'processing' ? (
                  <span className="text-amber-400 animate-pulse">
                    Processing voice waveform with Gemini Live...
                  </span>
                ) : lastDetectedSpeech ? (
                  <span className="text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{lastDetectedSpeech}</span>
                  </span>
                ) : (
                  <span className="text-slate-500 italic">
                    Press & hold microphone button or Spacebar to speak
                  </span>
                )}
              </div>

              {/* Sub-line: AI Thoughts / Details */}
              {lastAiThought && (
                <p className="text-xs text-slate-400 truncate mt-0.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="italic font-mono">{lastAiThought}</span>
                </p>
              )}
            </div>
          </div>

          {/* Right: Recent Utterances Pill Ticker */}
          {history.length > 0 && (
            <div className="hidden md:flex items-center gap-2 shrink-0 border-l border-slate-800 pl-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Recent:
              </span>
              <div className="flex items-center gap-1.5 max-w-sm overflow-hidden">
                {history.slice(0, 2).map((item) => (
                  <div
                    key={item.id}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium truncate max-w-[180px] border ${
                      item.status === 'ok'
                        ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60'
                        : 'bg-amber-950/50 text-amber-300 border-amber-800/60'
                    }`}
                    title={`${item.detectedText} (${item.timestamp})`}
                  >
                    {item.detectedText}
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
