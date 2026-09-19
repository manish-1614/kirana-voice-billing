/**
 * Kirana Voice Billing — Gemini Live WebSocket Bridge
 * 
 * Bridges client-side PCM audio to Gemini Live API via server-to-server WebSocket.
 * 
 * Responsibilities:
 * 1. Establishes secure WebSocket connection with Gemini Live API v1alpha.
 * 2. Handshakes with Kirana billing system instructions and function tools (HLD §3.3-3.4).
 * 3. Streams 16kHz 16-bit linear PCM audio chunks (Hold-to-Talk) into Gemini Live.
 * 4. Intercepts tool calls (add_line_item, close_bill, etc.), dispatches to PostgreSQL,
 *    and immediately returns function responses to keep the Gemini turn alive.
 * 5. Safely suppresses model audio chunks (HLD §3.7: visual + earcon cues only, no TTS).
 * 6. Emits status and synthetic earcon cues ('chime', 'warning') to the client WebSocket.
 * 7. Measures and logs end-to-end latency breakdowns per utterance.
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
}

export class GeminiLiveBridge {
  private geminiWs: WebSocket | null = null;
  private clientWs: WebSocket;
  private apiKey: string;
  private model: string;
  private sessionContext: SessionContext;
  private onContextChange?: (updatedContext: SessionContext) => void;

  private isGeminiReady = false;
  private isDestroyed = false;
  private utteranceStartTime = 0;
  private utteranceEndTime = 0;

  constructor(options: GeminiBridgeOptions) {
    this.apiKey = options.apiKey;
    this.clientWs = options.clientWs;
    this.sessionContext = options.sessionContext;
    this.model = options.model || process.env.GEMINI_MODEL || 'models/gemini-2.5-flash-native-audio-latest';
    this.onContextChange = options.onContextChange;

    this.connect();
  }

  /**
   * Connects to the Gemini Live v1alpha WebSocket endpoint
   */
  private connect() {
    if (this.isDestroyed) return;

    const host = 'generativelanguage.googleapis.com';
    const apiVersion = 'v1alpha';
    const wsUrl = `wss://${host}/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    console.log(`[Gemini Bridge] Connecting to Gemini Live (${this.model})...`);
    this.geminiWs = new WebSocket(wsUrl);

    this.geminiWs.on('open', () => {
      console.log('[Gemini Bridge] ✅ Connected to Gemini Live API');
      this.sendSetupMessage();
    });

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
   * Sends the initial setup handshake with tools and system instruction
   */
  private sendSetupMessage() {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;

    const setupMessage = {
      setup: {
        model: this.model,
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
                '1. On an item + quantity, call add_line_item immediately. Never ask for confirmation.',
                '2. Pass price_override only if a specific rate is quoted for this sale ("chini 70 rupaye me lagao").',
                '3. Corrections to the last row ("chini nahi, aata", "quantity 1 kilo karo", "wo hata do") -> edit_last_line_item.',
                '4. "total batao" / "bill complete" -> close_bill.',
                '5. "chini ka rate 75 karo" (permanent rate change) -> update_catalog_price.',
                '6. "token 12 kholo" -> open_session. "naya bill" -> start_new_bill.',
                '7. Output item_name and quantity_text in Roman script (Hinglish), never Devanagari. Pass quantity_text exactly as spoken; do not convert or compute numbers.',
                '8. One item per utterance. Never speak conversational filler; the screen is the response.',
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
    console.log('[Gemini Bridge] Handshake setup sent with 6 function declarations.');
  }

  private audioChunks: Buffer[] = [];
  private totalBufferedBytes = 0;
  private readonly CHUNK_FLUSH_THRESHOLD = 3200; // 100ms of 16kHz 16-bit mono PCM

  /**
   * Forwards binary 16kHz PCM audio chunk from Hold-to-Talk to Gemini Live
   */
  public sendAudioChunk(pcmChunk: Buffer | ArrayBuffer | string) {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isGeminiReady) {
      return;
    }

    const buffer = Buffer.isBuffer(pcmChunk)
      ? pcmChunk
      : typeof pcmChunk === 'string'
      ? Buffer.from(pcmChunk)
      : Buffer.from(pcmChunk);

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
   * Triggered when Hold-to-Talk button is pressed
   */
  public startSpeech() {
    this.audioChunks = [];
    this.totalBufferedBytes = 0;
    this.utteranceStartTime = Date.now();
    this.notifyClient({
      type: 'status_change',
      status: 'listening',
    });
  }

  /**
   * Triggered when Hold-to-Talk button is released: signals turnComplete
   */
  public stopSpeech() {
    this.utteranceEndTime = Date.now();
    const duration = this.utteranceEndTime - (this.utteranceStartTime || this.utteranceEndTime);

    // Flush any trailing audio samples
    this.flushAudio();

    console.log(`[Gemini Bridge] Utterance finished (${duration}ms). Signaling turnComplete...`);

    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiReady) {
      const turnCompleteMessage = {
        clientContent: {
          turnComplete: true,
        },
      };
      this.geminiWs.send(JSON.stringify(turnCompleteMessage));
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
        for (const fc of response.toolCall.functionCalls) {
          await this.executeAndRespondTool(fc.name, fc.args, fc.id);
        }
      }

      // 3. Server content (model turn)
      if (response.serverContent) {
        // Discard any audio chunks (no TTS per HLD §3.7)

        const parts = response.serverContent.modelTurn?.parts || [];
        for (const part of parts) {
          // Model text thoughts or reasoning
          if (part.text) {
            this.notifyClient({
              type: 'ai_thought',
              text: part.text,
            });
          }

          // Check if function call arrived inside modelTurn
          if (part.functionCall) {
            await this.executeAndRespondTool(
              part.functionCall.name,
              part.functionCall.args,
              part.functionCall.id || `call_${Date.now()}`
            );
          }
        }

        if (response.serverContent.turnComplete) {
          this.notifyClient({
            type: 'status_change',
            status: 'ready',
          });
        }
      }
    } catch (err) {
      console.error('[Gemini Bridge] Failed to parse message from Gemini:', err);
    }
  }

  /**
   * Executes a tool call, measures latency, replies to Gemini, and notifies client
   */
  private async executeAndRespondTool(toolName: string, args: any, callId: string) {
    const toolStartTime = Date.now();
    const toolCallLatency = this.utteranceEndTime ? (toolStartTime - this.utteranceEndTime) : 0;
    const detectedSpeech = this.formatDetectedSpeech(toolName, args);

    console.log(`\n[Gemini Bridge] 🛠️ Tool Call Received (${toolCallLatency}ms post-utterance):`);
    console.log(`   Tool: ${toolName}`);
    console.log(`   Args:`, JSON.stringify(args));
    console.log(`   Detected Speech: ${detectedSpeech}`);

    // Notify client immediately about detected speech before DB commit
    this.notifyClient({
      type: 'voice_detected',
      tool: toolName,
      detectedSpeech,
      args,
    });

    // Execute tool against Supabase database
    const result: ToolExecutionResult = await dispatchToolCall(toolName, args, this.sessionContext);
    const dbCommitTime = Date.now();
    const dbLatency = dbCommitTime - toolStartTime;
    const totalLatency = this.utteranceEndTime ? (dbCommitTime - this.utteranceEndTime) : dbLatency;

    console.log(`[Gemini Bridge] 💾 Tool Result [${result.status}] in ${dbLatency}ms (Total: ${totalLatency}ms):`);
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

    // 1. Send tool response back to Gemini Live to complete the model turn
    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
      const toolResponseMsg = {
        toolResponse: {
          functionResponses: [
            {
              id: callId,
              response: {
                output: {
                  status: result.status,
                  message: result.message,
                  data: result.data,
                },
              },
            },
          ],
        },
      };
      this.geminiWs.send(JSON.stringify(toolResponseMsg));
    }

    // 2. Notify the client tablet with status, earcon cue, and latency metrics
    this.notifyClient({
      type: 'tool_result',
      tool: toolName,
      status: result.status,
      earcon: result.earcon,
      message: result.message,
      data: result.data,
      detectedSpeech,
      args,
      session: this.sessionContext,
      latency: {
        geminiLiveMs: toolCallLatency,
        dbCommitMs: dbLatency,
        totalMs: totalLatency,
      },
    });
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
