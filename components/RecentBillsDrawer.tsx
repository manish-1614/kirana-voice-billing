import React from 'react';
import { X, Clock, CheckCircle2, ArrowRight } from 'lucide-react';
import { SessionContext } from '@/lib/tool-dispatcher';

export interface SessionRecord {
  id: string;
  customer_number: number;
  session_date: string;
  status: 'open' | 'closed' | 'resumed';
  subtotal: number;
  created_at: string;
  closed_at?: string;
}

interface RecentBillsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionRecord[];
  activeSessionId?: string;
  onSelectSession: (sessionId: string) => void;
}

export const RecentBillsDrawer: React.FC<RecentBillsDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
      />

      {/* Slide-over panel */}
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">
                  Today&apos;s Customer Bills
                </h3>
                <p className="text-xs text-slate-500">Asia/Kolkata Daily Tokens</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {sessions.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                No bills recorded yet today.
              </div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                const formattedTime = new Date(sess.created_at).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                });

                return (
                  <button
                    key={sess.id}
                    onClick={() => {
                      onSelectSession(sess.id);
                      onClose();
                    }}
                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                      isActive
                        ? 'bg-amber-50/80 border-amber-400 shadow-xs ring-2 ring-amber-400/20'
                        : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-slate-900 font-mono">
                          Token #{sess.customer_number}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                            sess.status === 'open'
                              ? 'bg-emerald-100 text-emerald-800'
                              : sess.status === 'resumed'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {sess.status}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-slate-950">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 mt-1 block">
                        Created at {formattedTime}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-slate-900 font-mono">
                        ₹{(sess.subtotal || 0).toFixed(2)}
                      </span>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
