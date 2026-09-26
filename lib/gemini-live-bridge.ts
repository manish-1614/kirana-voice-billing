/**
 * Kirana Voice Billing — Gemini Live WebSocket Bridge
 * 
 * Bridges client-side PCM audio to Gemini Live API via server-to-server WebSocket.
 * 
 * Key Responsibilities & Protocol Compliance:
 * 1. Establishes secure WebSocket connection with Gemini Live API v1alpha.
 * 2. Handshakes with Kirana billing system instructions and function tools (HLD §3.3-3.4).
 * 3. Manual Activity Signaling: Disables automatic VAD in setup message and signals explicit
 *    turn boundaries via realtimeInput: { activityStart: {} } and realtimeInput: { activityEnd: {} }.
 * 4. Protocol Guard & Queue: Buffers speech if user talks while a tool call is in-flight to prevent
 *    fatal Gemini 1008 protocol errors; dispatches queued activity signals immediately upon tool response.
 * 5. Serializes tool call executions sequentially via async promise chain.
 * 6. Dispatches to PostgreSQL/Supabase and returns function responses to keep the Gemini turn alive.
 * 7. Suppresses model audio chunks (HLD §3.7: earcon cues + visual DOM updates only, no TTS).
 * 8. Measures and logs end-to-end latency breakdowns along with audio duration telemetry.
 */

import WebSocket from 'ws';
import {
  dispatchToolCall,
  GEMINI_TOOL_DECLARATIONS,
  SessionContext,
  ToolExecutionResult,
} from './tool-dispatcher';

export interface GeminiBridgeOptions {
  apiKey: string;
  clientWs: WebSocket;
  sessionContext: SessionContext;
  model?: string;
  onContextChange?: (updatedContext: SessionContext) => void;
  geminiWs?: WebSocket;
}

export class GeminiLiveBridge {
  private geminiWs: WebSocket | null = null;
  private clientWs: WebSocket;
  private apiKey: string;
  private model: string;
  private sessionContext: SessionContext;
  private onContextChange?: (updatedContext: SessionContext) => void;
  private customGeminiWs?: WebSocket;

  private isGeminiReady = false;
  private isDestroyed = false;
  private utteranceStartTime = 0;
  private utteranceEndTime = 0;

  // Telemetry diagnostics
  private lastAudioMsSent = 0;
  private lastPrerollMs = 0;

  // Turn and concurrency management
  private isToolTurnPending = false;
  private isSpeechQueued = false;
  private isSpeechEndQueued = false;
  private hasToolCallInTurn = false;
  private hasUtteranceActive = false;
  private queuedAudioChunks: Buffer[] = [];
  private toolExecutionQueue: Promise<void> = Promise.resolve();

  // Audio chunk buffer (~100ms chunks)
  private audioChunks: Buffer[] = [];
  private totalBufferedBytes = 0;
  private readonly CHUNK_FLUSH_THRESHOLD = 3200; // 100ms of 16kHz 16-bit mono PCM

  constructor(options: GeminiBridgeOptions) {
    this.apiKey = options.apiKey;
    this.clientWs = options.clientWs;
    this.sessionContext = options.sessionContext;
    this.model = options.model || process.env.GEMINI_MODEL || 'models/gemini-2.5-flash-native-audio-latest';
    this.onContextChange = options.onContextChange;
    this.customGeminiWs = options.geminiWs;

    this.connect();
  }

  /**
   * Connects to the Gemini Live v1alpha WebSocket endpoint
   */
  private connect() {
    if (this.isDestroyed) return;

    if (this.customGeminiWs) {
      this.geminiWs = this.customGeminiWs;
    } else {
      const host = 'generativelanguage.googleapis.com';
      const apiVersion = 'v1alpha';
      const wsUrl = `wss://${host}/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

      console.log(`[Gemini Bridge] Connecting to Gemini Live (${this.model})...`);
      this.geminiWs = new WebSocket(wsUrl);
    }

    if (this.geminiWs.readyState === WebSocket.OPEN) {
      this.sendSetupMessage();
    } else {
      this.geminiWs.on('open', () => {
        console.log('[Gemini Bridge] ✅ Connected to Gemini Live API');
        this.sendSetupMessage();
      });
    }

    this.geminiWs.on('message', (data: Buffer | string) => {
      this.handleGeminiMessage(data);
    });

    this.geminiWs.on('error', (err) => {
      console.error('[Gemini Bridge] ❌ WebSocket error:', err.message);
      this.notifyClient({
        type: 'error',
        message: `Gemini Live connection error: ${err.message}`,
      });
    });

    this.geminiWs.on('close', (code, reason) => {
      console.log(`[Gemini Bridge] Gemini Live closed: code=${code}, reason=${reason?.toString() || 'Normal'}`);
      this.isGeminiReady = false;

      // Auto-reconnect if client is still active and bridge wasn't explicitly destroyed
      if (!this.isDestroyed && this.clientWs.readyState === WebSocket.OPEN) {
        console.log('[Gemini Bridge] Reconnecting to Gemini Live in 1.5s...');
        setTimeout(() => this.connect(), 1500);
      }
    });
  }

  /**
   * Sends initial setup handshake disabling server-side VAD (manual activity signaling per HLD §3.7)
   */
  private sendSetupMessage() {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;

    const setupMessage = {
      setup: {
        model: this.model,
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: true,
          },
        },
        generationConfig: {
          // Native audio model requires AUDIO modality; audio output is suppressed server-side
          responseModalities: ['AUDIO'],
          temperature: 0.1,
        },
        systemInstruction: {
          parts: [
            {
              text: [
                'You are a silent billing assistant at a kirana shop counter in Ranchi. The shopkeeper speaks Hinglish.',
                'Rules:',
                '1. On items and quantities, call add_line_item for each item/quantity pair in the utterance. If the operator speaks multiple items in one burst (e.g. "chini aadha kilo, atta ek kilo, chai patti do packet"), emit a separate add_line_item call for each one in order. Each call must represent exactly one item and its own quantity. Never combine several items into one item name or quantity.',
                '2. Pass price_override only if a specific sale rate is quoted for that item ("chini aadha kilo, 70 rupaye me lagao", "atta ek kilo, rate 35"). In multi-item bursts, attach each spoken price_override strictly to the item it describes. Pass price_override as spoken (e.g. "70", "nabbe", "rate 35"). Do not carry an override across calls.',
                '3. Corrections to the last row ("chini nahi, aata", "quantity 1 kilo karo", "wo hata do") -> edit_last_line_item.',
                '4. "total batao" / "bill complete" -> close_bill.',
                '5. "chini ka rate 75 karo" (explicit permanent catalog rate change) -> update_catalog_price. Never confuse a one-sale negotiated rate with a permanent catalog update.',
                '6. "token 12 kholo" -> open_session. "naya bill" -> start_new_bill.',
                '7. Output item_name and quantity_text in Roman script (Hinglish), never Devanagari. Pass quantity_text and price_override exactly as spoken; do not convert or compute numbers.',
                '8. Never speak conversational filler; the screen and audio cues are the response.',
              ].join('\n'),
            },
          ],
        },
        tools: [
          {
            functionDeclarations: GEMINI_TOOL_DECLARATIONS,
          },
        ],
      },
    };

    this.geminiWs.send(JSON.stringify(setupMessage));
    console.log('[Gemini Bridge] Handshake setup sent with automaticActivityDetection.disabled = true.');
  }

  /**
   * Forwards binary 16kHz PCM audio chunk from Hold-to-Talk to Gemini Live
   */
  public sendAudioChunk(pcmChunk: Buffer | ArrayBuffer | string) {
    const buffer = Buffer.isBuffer(pcmChunk)
      ? pcmChunk
      : typeof pcmChunk === 'string'
      ? Buffer.from(pcmChunk)
      : Buffer.from(pcmChunk);

    // If speech is queued due to an in-flight tool turn, buffer the chunk
    if (this.isSpeechQueued) {
      this.queuedAudioChunks.push(buffer);
      return;
    }

    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isGeminiReady) {
      return;
    }

    this.audioChunks.push(buffer);
    this.totalBufferedBytes += buffer.length;

    // Send when accumulated buffer reaches ~100ms
    if (this.totalBufferedBytes >= this.CHUNK_FLUSH_THRESHOLD) {
      this.flushAudio();
    }
  }

  private flushAudio() {
    if (this.audioChunks.length === 0 || !this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const combined = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    this.totalBufferedBytes = 0;

    const base64Audio = combined.toString('base64');
    const audioMessage = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        ],
      },
    };

    this.geminiWs.send(JSON.stringify(audioMessage));
  }

  /**
   * Triggered when Hold-to-Talk button is pressed:
   * Sends explicit activityStart signal to Gemini Live per manual activity protocol
   */
  public startSpeech() {
    this.audioChunks = [];
    this.totalBufferedBytes = 0;
    this.utteranceStartTime = Date.now();
    this.hasToolCallInTurn = false;
    this.hasUtteranceActive = true;

    this.notifyClient({
      type: 'status_change',
      status: 'listening',
    });

    // Guard: Gemini Live protocol forbids activityStart while a tool call is pending (throws 1008)
    if (this.isToolTurnPending) {
      console.log('[Gemini Bridge] ⏳ Tool turn pending; queueing utterance start to prevent 1008 error.');
      this.isSpeechQueued = true;
      this.isSpeechEndQueued = false;
      this.queuedAudioChunks = [];
      return;
    }

    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiReady) {
      const activityStartMessage = {
        realtimeInput: {
          activityStart: {},
        },
      };
      this.geminiWs.send(JSON.stringify(activityStartMessage));
      console.log('[Gemini Bridge] 🎙️ Speech started: Sent activityStart signal.');
    }
  }

  /**
   * Triggered when Hold-to-Talk button is released:
   * Sends explicit activityEnd signal to Gemini Live
   */
  public stopSpeech(telemetry?: { audioMsSent?: number; prerollMs?: number }) {
    this.utteranceEndTime = Date.now();
    const duration = this.utteranceEndTime - (this.utteranceStartTime || this.utteranceEndTime);

    if (telemetry) {
      this.lastAudioMsSent = telemetry.audioMsSent || 0;
      this.lastPrerollMs = telemetry.prerollMs || 0;
    }

    // If this utterance was queued, mark end of speech on the queue
    if (this.isSpeechQueued) {
      console.log(`[Gemini Bridge] ⏳ Queued utterance release recorded (${duration}ms). Will dispatch after tool response.`);
      this.isSpeechEndQueued = true;
      this.notifyClient({
        type: 'status_change',
        status: 'processing',
      });
      return;
    }

    // Flush any remaining audio samples in local buffer
    this.flushAudio();

    console.log(`[Gemini Bridge] 🛑 Utterance finished (${duration}ms | audioSent=${this.lastAudioMsSent}ms, preroll=${this.lastPrerollMs}ms). Sending activityEnd...`);

    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiReady) {
      const activityEndMessage = {
        realtimeInput: {
          activityEnd: {},
        },
      };
      this.geminiWs.send(JSON.stringify(activityEndMessage));
    }

    this.notifyClient({
      type: 'status_change',
      status: 'processing',
    });
  }

  /**
   * Text simulation mode: sends simulated text prompt for testing or manual input
   */
  public sendUserText(text: string) {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isGeminiReady) {
      console.warn('[Gemini Bridge] Cannot send text; Gemini is not ready');
      return;
    }

    this.utteranceStartTime = Date.now();
    this.utteranceEndTime = Date.now();
    this.hasToolCallInTurn = false;
    this.hasUtteranceActive = true;

    const textMessage = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    console.log(`[Gemini Bridge] Sending text prompt: "${text}"`);
    this.geminiWs.send(JSON.stringify(textMessage));

    this.notifyClient({
      type: 'status_change',
      status: 'processing',
    });
  }

  /**
   * Updates the active session context bound to this connection
   */
  public updateSessionContext(newContext: SessionContext) {
    this.sessionContext = newContext;
  }

  /**
   * Processes incoming messages from Gemini Live
   */
  private async handleGeminiMessage(raw: Buffer | string) {
    try {
      const response = JSON.parse(raw.toString());

      // 1. Setup acknowledgment
      if (response.setupComplete) {
        this.isGeminiReady = true;
        console.log('[Gemini Bridge] ✅ Setup confirmed by Gemini Live API!');
        this.notifyClient({
          type: 'gemini_ready',
          status: 'ready',
          model: this.model,
          session: this.sessionContext,
        });
        return;
      }

      // 2. Function calls via top-level toolCall
      if (response.toolCall?.functionCalls) {
        this.hasToolCallInTurn = true;
        this.isToolTurnPending = true;
        const calls = response.toolCall.functionCalls.map((fc: any) => ({
          name: fc.name,
          args: fc.args,
          id: fc.id,
        }));
        this.toolExecutionQueue = this.toolExecutionQueue.then(() =>
          this.executeBatchAndRespond(calls)
        );
      }

      // 3. Server content (model turn)
      if (response.serverContent) {
        // Discard any model audio chunks (silent counter operation per HLD §3.7)

        const parts = response.serverContent.modelTurn?.parts || [];
        const modelCalls: { name: string; args: any; id: string }[] = [];

        for (const part of parts) {
          // Model text thoughts or reasoning: logged to server only, hidden from counter UI
          if (part.text) {
            console.log(`[Gemini Bridge] 💭 AI Thought: ${part.text.replace(/\n/g, ' ')}`);
          }

          // Check if function call arrived inside modelTurn
          if (part.functionCall) {
            modelCalls.push({
              name: part.functionCall.name,
              args: part.functionCall.args,
              id: part.functionCall.id || `call_${Date.now()}_${modelCalls.length}`,
            });
          }
        }

        if (modelCalls.length > 0) {
          this.hasToolCallInTurn = true;
          this.isToolTurnPending = true;
          this.toolExecutionQueue = this.toolExecutionQueue.then(() =>
            this.executeBatchAndRespond(modelCalls)
          );
        }

        if (response.serverContent.turnComplete) {
          if (this.hasUtteranceActive && !this.hasToolCallInTurn && !this.isToolTurnPending) {
            this.hasUtteranceActive = false;
            this.notifyClient({
              type: 'tool_result',
              tool: 'none',
              status: 'no_tool_call',
              earcon: 'warning',
              message: 'No item or quantity recognized / आवाज़ समझ नहीं आई',
              session: this.sessionContext,
            });
          }
          if (this.hasToolCallInTurn) {
            this.hasUtteranceActive = false;
          }
          if (!this.isToolTurnPending && !this.isSpeechQueued) {
            this.notifyClient({
              type: 'status_change',
              status: 'ready',
            });
          }
        }
      }
    } catch (err) {
      console.error('[Gemini Bridge] Failed to parse message from Gemini:', err);
    }
  }

  /**
   * Executes a batch of tool calls for a turn, streams individual notifications to the client tablet,
   * groups all function responses into one message back to Gemini Live, and releases queued speech.
   */
  private async executeBatchAndRespond(calls: { name: string; args: any; id: string }[]) {
    const functionResponses: Array<{ id: string; response: { output: any } }> = [];

    for (const call of calls) {
      const toolStartTime = Date.now();
      const toolCallLatency = this.utteranceEndTime ? (toolStartTime - this.utteranceEndTime) : 0;
      const detectedSpeech = this.formatDetectedSpeech(call.name, call.args);

      console.log(`\n[Gemini Bridge] 🛠️ Tool Call Received (${toolCallLatency}ms post-utterance):`);
      console.log(`   Tool: ${call.name}`);
      console.log(`   Args:`, JSON.stringify(call.args));
      console.log(`   Detected Speech: ${detectedSpeech}`);

      // Notify client immediately about detected speech before DB commit
      this.notifyClient({
        type: 'voice_detected',
        tool: call.name,
        detectedSpeech,
        args: call.args,
      });

      // Execute tool against Supabase database
      const result: ToolExecutionResult = await dispatchToolCall(call.name, call.args, this.sessionContext);
      const dbCommitTime = Date.now();
      const dbLatency = dbCommitTime - toolStartTime;
      const totalLatency = this.utteranceEndTime ? (dbCommitTime - this.utteranceEndTime) : dbLatency;

      console.log(`[Gemini Bridge] 💾 Tool Result [${result.status}] in ${dbLatency}ms (Total: ${totalLatency}ms | AudioSent: ${this.lastAudioMsSent}ms, PreRoll: ${this.lastPrerollMs}ms):`);
      console.log(`   Message: ${result.message || ''}`);
      console.log(`   Earcon:  ${result.earcon}`);

      // Update internal session context if changed (e.g. start_new_bill, close_bill, open_session)
      if (result.contextUpdate) {
        this.sessionContext = {
          ...this.sessionContext,
          ...result.contextUpdate,
        };
        if (this.onContextChange) {
          this.onContextChange(this.sessionContext);
        }
      }

      // Notify the client tablet with individual row update, earcon cue, and latency metrics
      this.notifyClient({
        type: 'tool_result',
        tool: call.name,
        status: result.status,
        earcon: result.earcon,
        message: result.message,
        data: result.data,
        detectedSpeech,
        args: call.args,
        session: this.sessionContext,
        latency: {
          geminiLiveMs: toolCallLatency,
          dbCommitMs: dbLatency,
          totalMs: totalLatency,
        },
        telemetry: {
          audioMsSent: this.lastAudioMsSent,
          prerollMs: this.lastPrerollMs,
        },
      });

      // Collect response for grouped toolResponse message
      functionResponses.push({
        id: call.id,
        response: {
          output: {
            status: result.status,
            message: result.message,
            data: result.data,
          },
        },
      });
    }

    // 1. Send single grouped toolResponse message back to Gemini Live once all calls in batch complete
    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && functionResponses.length > 0) {
      const toolResponseMsg = {
        toolResponse: {
          functionResponses,
        },
      };
      this.geminiWs.send(JSON.stringify(toolResponseMsg));
    }

    // Mark tool turn completed only after the whole batch finished
    this.isToolTurnPending = false;

    // 2. Process any queued speech that arrived while this batch was executing
    this.dispatchQueuedSpeechIfAny();
  }

  /**
   * Backward compatibility helper for single tool call execution
   */
  private async executeAndRespondTool(toolName: string, args: any, callId: string) {
    return this.executeBatchAndRespond([{ name: toolName, args, id: callId }]);
  }

  /**
   * Dispatches queued speech signals and buffered audio once tool response is safely sent
   */
  private dispatchQueuedSpeechIfAny() {
    if (!this.isSpeechQueued || !this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isGeminiReady) {
      return;
    }

    console.log(`[Gemini Bridge] 🚀 Dispatched queued speech after tool turn. Flushing ${this.queuedAudioChunks.length} chunks.`);

    // 1. Send activityStart
    this.geminiWs.send(JSON.stringify({
      realtimeInput: {
        activityStart: {},
      },
    }));

    // 2. Stream all buffered media chunks
    if (this.queuedAudioChunks.length > 0) {
      const combined = Buffer.concat(this.queuedAudioChunks);
      this.queuedAudioChunks = [];
      this.geminiWs.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: 'audio/pcm;rate=16000',
              data: combined.toString('base64'),
            },
          ],
        },
      }));
    }

    this.isSpeechQueued = false;

    // 3. If the user already released while queued, send activityEnd immediately
    if (this.isSpeechEndQueued) {
      this.geminiWs.send(JSON.stringify({
        realtimeInput: {
          activityEnd: {},
        },
      }));
      this.isSpeechEndQueued = false;
      console.log('[Gemini Bridge] 🛑 Sent queued activityEnd signal.');
    }
  }

  private formatDetectedSpeech(toolName: string, args: any): string {
    if (!args) return toolName;
    switch (toolName) {
      case 'add_line_item':
        return `"${args.item_name} ${args.quantity_text}"` + (args.price_override ? ` at ₹${args.price_override}` : '');
      case 'edit_last_line_item':
        return `Correction: ${args.correction_type} ${args.new_value || ''}`.trim();
      case 'update_catalog_price':
        return `Rate change: "${args.item_name}" to ₹${args.new_price}`;
      case 'close_bill':
        return '"total batao" (Close Bill)';
      case 'open_session':
        return `"token ${args.token_number} kholo"`;
      case 'start_new_bill':
        return '"naya bill" (New Bill)';
      default:
        return `${toolName}`;
    }
  }

  /**
   * Helper to send JSON payloads to the connected client
   */
  private notifyClient(payload: any) {
    if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
      this.clientWs.send(JSON.stringify(payload));
    }
  }

  /**
   * Clean teardown when client disconnects
   */
  public destroy() {
    this.isDestroyed = true;
    this.isGeminiReady = false;

    if (this.geminiWs) {
      this.geminiWs.removeAllListeners();
      if (this.geminiWs.readyState === WebSocket.OPEN) {
        this.geminiWs.close();
      }
      this.geminiWs = null;
    }
  }
}
