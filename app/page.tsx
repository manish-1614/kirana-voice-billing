'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from '@/components/Header';
import { BillTable, BillItem } from '@/components/BillTable';
import { BillingControls } from '@/components/BillingControls';
import { AmbiguityBanner, AmbiguityState } from '@/components/AmbiguityBanner';
import { EditItemModal } from '@/components/EditItemModal';
import { RecentBillsDrawer, SessionRecord } from '@/components/RecentBillsDrawer';
import { PinModal } from '@/components/PinModal';
import { VoiceActivityConsole, VoiceLogItem } from '@/components/VoiceActivityConsole';
import { PcmAudioRecorder } from '@/lib/audio/recorder';
import { playEarcon } from '@/lib/audio/earcon';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { SessionContext } from '@/lib/tool-dispatcher';

export default function KiranaBillingApp() {
  // State
  const [session, setSession] = useState<SessionContext | null>(null);
  const [items, setItems] = useState<BillItem[]>([]);
  const [subtotal, setSubtotal] = useState<number>(0);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [geminiReady, setGeminiReady] = useState<boolean>(false);
  const [micState, setMicState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [ambiguityState, setAmbiguityState] = useState<AmbiguityState | null>(null);

  // Live Voice Transcript & Audio Feedback State
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [lastDetectedSpeech, setLastDetectedSpeech] = useState<string>('');
  const [lastAiThought, setLastAiThought] = useState<string>('');
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [voiceHistory, setVoiceHistory] = useState<VoiceLogItem[]>([]);

  // Modals & Drawers
  const [editingItem, setEditingItem] = useState<BillItem | null>(null);
  const [isRecentOpen, setIsRecentOpen] = useState<boolean>(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [recentSessions, setRecentSessions] = useState<SessionRecord[]>([]);
  const [shopPin, setShopPin] = useState<string>('1234');

  // References
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<PcmAudioRecorder | null>(null);
  const isHoldingSpacebar = useRef<boolean>(false);

  // Load PIN from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPin = localStorage.getItem('KIRANA_SHOP_PIN') || '1234';
      setShopPin(savedPin);
    }

    return () => {
      recorderRef.current?.destroy();
      recorderRef.current = null;
    };
  }, []);

  // Fetch session items
  const fetchSessionItems = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/session-items?sessionId=${sessionId}`, {
        headers: { 'x-shop-pin': shopPin },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        // Calculate subtotal
        const total = (data.items || []).reduce(
          (acc: number, item: BillItem) => acc + (item.line_total || 0),
          0
        );
        setSubtotal(total);
      }
    } catch (err) {
      console.error('Failed to fetch session items:', err);
    }
  }, [shopPin]);

  // Fetch recent bills
  const fetchRecentBills = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', {
        headers: { 'x-shop-pin': shopPin },
      });
      if (res.ok) {
        const data = await res.json();
        setRecentSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to fetch recent sessions:', err);
    }
  }, [shopPin]);

  // WebSocket Connection
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let reconnectTimer: NodeJS.Timeout;
    let ws: WebSocket;

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/live?pin=${encodeURIComponent(shopPin)}`;

      console.log('[App] Connecting WebSocket to:', wsUrl);
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[App] ✅ Connected to Kirana Live Gateway');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'connection_ack':
              setSession(msg.session);
              if (msg.session?.sessionId) {
                fetchSessionItems(msg.session.sessionId);
              }
              break;

            case 'gemini_ready':
              setGeminiReady(true);
              setMicState('idle');
              break;

            case 'status_change':
              setMicState(msg.status);
              if (msg.status === 'listening') {
                setInterimTranscript('');
              }
              break;

            case 'voice_detected':
              if (msg.detectedSpeech) {
                setLastDetectedSpeech(msg.detectedSpeech);
              }
              break;

            case 'ai_thought':
              // HLD §3.7: Hide model thought text from operator UI status bar (preserved in server logs only)
              break;

            case 'tool_result':
              console.log('[App] Tool Result received:', msg);
              setMicState('idle');
              setInterimTranscript('');

              // Play auditory feedback earcon
              if (msg.earcon) {
                playEarcon(msg.earcon);
              }

              // Update detected speech and history
              if (msg.detectedSpeech) {
                setLastDetectedSpeech(msg.detectedSpeech);
                const newLog: VoiceLogItem = {
                  id: `log_${Date.now()}`,
                  timestamp: new Date().toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                  detectedText: msg.detectedSpeech,
                  tool: msg.tool,
                  status: msg.status,
                  details: msg.message,
                };
                setVoiceHistory((prev) => [newLog, ...prev.slice(0, 4)]);
              }

              // Update active session if updated by tool
              if (msg.session) {
                setSession(msg.session);
              }

              if (msg.status === 'ok') {
                if (session?.sessionId) {
                  fetchSessionItems(session.sessionId);
                }
              } else if (msg.status === 'ambiguous') {
                setAmbiguityState({
                  type: 'ambiguous',
                  message: msg.message,
                  query: msg.data?.query,
                  candidates: msg.data?.candidates,
                });
              } else if (msg.status === 'not_found') {
                setAmbiguityState({
                  type: 'not_found',
                  message: msg.message,
                  query: msg.data?.query,
                });
              } else if (msg.status === 'unit_mismatch') {
                setAmbiguityState({
                  type: 'unit_mismatch',
                  message: msg.message,
                  query: msg.data?.spokenQuantity,
                });
              }
              break;

            case 'session_updated':
              setSession(msg.session);
              if (msg.session?.sessionId) {
                fetchSessionItems(msg.session.sessionId);
              }
              break;

            case 'error':
              console.error('[App] Server error message:', msg.message);
              break;
          }
        } catch (err) {
          console.error('[App] Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.warn('[App] WebSocket closed. Reconnecting in 2s...');
        setWsConnected(false);
        setGeminiReady(false);
        reconnectTimer = setTimeout(connectWebSocket, 2000);
      };

      ws.onerror = (err) => {
        console.error('[App] WebSocket error:', err);
      };
    };

    connectWebSocket();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [shopPin, fetchSessionItems]);

  // Supabase Realtime Subscription (Single Source of Truth)
  useEffect(() => {
    if (!session?.sessionId) return;

    const supabase = getBrowserSupabase();
    if (!supabase) return;

    console.log(`[Realtime] Subscribing to session items: ${session.sessionId}`);
    const channel = supabase
      .channel(`live_bill:${session.sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_items',
          filter: `session_id=eq.${session.sessionId}`,
        },
        (payload) => {
          console.log('[Realtime] Item change received:', payload);
          fetchSessionItems(session.sessionId);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${session.sessionId}`,
        },
        (payload: any) => {
          console.log('[Realtime] Session change received:', payload);
          if (payload.new) {
            setSubtotal(payload.new.subtotal || 0);
            setSession((prev) => (prev ? { ...prev, status: payload.new.status } : null));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.sessionId, fetchSessionItems]);

  const isPressingMic = useRef<boolean>(false);

  // Audio Recording (Hold-to-Talk)
  const startRecording = useCallback(async () => {
    if (isPressingMic.current) return;
    isPressingMic.current = true;

    try {
      playEarcon('start');
      setMicState('listening');

      // Send speech start signal to server
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'mic_start' }));
      }

      // Warm Web Audio recorder
      if (!recorderRef.current) {
        recorderRef.current = new PcmAudioRecorder();
      }

      await recorderRef.current.start(
        (chunk: ArrayBuffer) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(chunk);
          }
        },
        (vol) => setVolumeLevel(vol),
        (interim) => setInterimTranscript(interim)
      );
    } catch (err: any) {
      console.error('[Mic] Failed to start audio recording:', err);
      isPressingMic.current = false;
      setMicState('idle');
      playEarcon('warning');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!isPressingMic.current) return;
    isPressingMic.current = false;

    try {
      playEarcon('stop');
      setMicState('processing');

      let telemetry = { audioMsSent: 0, prerollMs: 0 };
      // Stop recorder: captures 300ms tail, flushes worklet, awaits flush ack
      if (recorderRef.current) {
        telemetry = await recorderRef.current.stop();
      }

      // Send speech stop signal to server with audio telemetry
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'mic_stop',
          audioMsSent: telemetry.audioMsSent,
          prerollMs: telemetry.prerollMs,
        }));
      }
    } catch (err) {
      console.error('[Mic] Error stopping recorder:', err);
      setMicState('idle');
    }
  }, []);

  // Bill Actions
  const handleCloseBill = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'user_text', text: 'total batao' }));
    }
  }, []);

  const handleStartNewBill = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'start_new_bill' }));
    }
  }, []);

  const handleSendTextPrompt = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'user_text', text }));
    }
  }, []);

  const handleCandidateSelect = useCallback((candidateName: string) => {
    handleSendTextPrompt(`${candidateName} 1`);
  }, [handleSendTextPrompt]);

  // Keyboard Hotkey support for Counter Keyboard (Spacebar, T, N, Esc, 1-9)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      // Spacebar: Hold-to-Talk
      if (e.code === 'Space' && !e.repeat && !isHoldingSpacebar.current) {
        e.preventDefault();
        isHoldingSpacebar.current = true;
        startRecording();
        return;
      }

      // 'T' / 't': Close bill / Total batao
      if ((e.key === 't' || e.key === 'T') && !e.repeat) {
        e.preventDefault();
        handleCloseBill();
        return;
      }

      // 'N' / 'n': Start new bill token
      if ((e.key === 'n' || e.key === 'N') && !e.repeat) {
        e.preventDefault();
        handleStartNewBill();
        return;
      }

      // 'Escape': Clear ambiguity/unrecognized banner
      if (e.key === 'Escape') {
        e.preventDefault();
        setAmbiguityState(null);
        return;
      }

      // Digit 1-9: Quick selection of ambiguity candidates
      if (ambiguityState?.candidates && ambiguityState.candidates.length > 0) {
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= ambiguityState.candidates.length) {
          e.preventDefault();
          const selected = ambiguityState.candidates[num - 1];
          if (selected) {
            handleCandidateSelect(selected.canonical_name);
          }
          return;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isHoldingSpacebar.current) {
        e.preventDefault();
        isHoldingSpacebar.current = false;
        stopRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startRecording, stopRecording, handleCloseBill, handleStartNewBill, handleCandidateSelect, ambiguityState]);

  // Row Edit & Delete
  const handleSaveItemEdit = async (
    id: string,
    newQuantityText?: string,
    newPriceOverride?: number,
    newItemId?: string
  ) => {
    try {
      const res = await fetch('/api/session-items', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-shop-pin': shopPin,
        },
        body: JSON.stringify({
          id,
          quantityText: newQuantityText,
          priceOverride: newPriceOverride,
          itemId: newItemId,
        }),
      });
      if (res.ok && session?.sessionId) {
        fetchSessionItems(session.sessionId);
        playEarcon('chime');
      }
    } catch (err) {
      console.error('Failed to update line item:', err);
      playEarcon('warning');
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      const res = await fetch(`/api/session-items?id=${id}`, {
        method: 'DELETE',
        headers: { 'x-shop-pin': shopPin },
      });
      if (res.ok && session?.sessionId) {
        fetchSessionItems(session.sessionId);
        playEarcon('chime');
      }
    } catch (err) {
      console.error('Failed to delete line item:', err);
      playEarcon('warning');
    }
  };

  const handleSavePin = (newPin: string) => {
    setShopPin(newPin);
    if (typeof window !== 'undefined') {
      localStorage.setItem('KIRANA_SHOP_PIN', newPin);
    }
  };

  const handleSwitchSession = (selectedSessionId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'switch_session', sessionId: selectedSessionId }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col antialiased selection:bg-amber-200">
      {/* 1. Counter Header Bar */}
      <Header
        session={session}
        wsConnected={wsConnected}
        geminiReady={geminiReady}
        micState={micState}
        onOpenRecent={() => {
          fetchRecentBills();
          setIsRecentOpen(true);
        }}
        onOpenPin={() => setIsPinModalOpen(true)}
        hasValidPin={Boolean(shopPin)}
      />

      {/* 2. Main Billing Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 pb-32 sm:pb-36">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Live Bill Table (8 cols on lg) */}
          <div className="lg:col-span-8 space-y-4">
            {/* Ambiguity / Unmapped Banner */}
            <AmbiguityBanner
              state={ambiguityState}
              onSelectCandidate={handleCandidateSelect}
              onDismiss={() => setAmbiguityState(null)}
            />

            {/* Bill Table */}
            <BillTable
              items={items}
              onEditItem={(item) => setEditingItem(item)}
              onDeleteItem={handleDeleteItem}
              onQuickSimulate={handleSendTextPrompt}
            />
          </div>

          {/* Right Column: Ergo Controls (4 cols on lg) */}
          <div className="lg:col-span-4 lg:sticky lg:top-6">
            <BillingControls
              session={session}
              itemsCount={items.length}
              subtotal={subtotal}
              micState={micState}
              volumeLevel={volumeLevel}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onCloseBill={handleCloseBill}
              onStartNewBill={handleStartNewBill}
              onSendTextPrompt={handleSendTextPrompt}
            />
          </div>
        </div>
      </main>

      {/* 3. Live Voice Activity & Transcript Console (Bottom of screen) */}
      <VoiceActivityConsole
        micState={micState}
        interimTranscript={interimTranscript}
        lastDetectedSpeech={lastDetectedSpeech}
        lastAiThought={lastAiThought}
        volumeLevel={volumeLevel}
        history={voiceHistory}
      />

      {/* 4. Modals & Drawers */}
      <EditItemModal
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSave={handleSaveItemEdit}
        onDelete={handleDeleteItem}
      />

      <RecentBillsDrawer
        isOpen={isRecentOpen}
        onClose={() => setIsRecentOpen(false)}
        sessions={recentSessions}
        activeSessionId={session?.sessionId}
        onSelectSession={handleSwitchSession}
      />

      <PinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        currentPin={shopPin}
        onSavePin={handleSavePin}
      />
    </div>
  );
}
