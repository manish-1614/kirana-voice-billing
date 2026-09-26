/**
 * Kirana Voice Billing — Custom Node.js Server (Next.js + WebSocket Gateway)
 * 
 * Co-locates Next.js App Router and an integrated WebSocket server on a single port.
 * Handles client PCM audio streaming to Gemini Live API with server-side API key protection
 * and validates the 4-digit SHOP_PIN on connection.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables immediately before module imports
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { GeminiLiveBridge } from './lib/gemini-live-bridge';
import {
  getOrCreateActiveSession,
  createNewSession,
  SessionContext,
} from './lib/tool-dispatcher';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);
const expectedPin = process.env.SHOP_PIN || '1234';
const geminiApiKey = process.env.GEMINI_API_KEY || '';

const app = next({ dev, hostname: '0.0.0.0', port });
const handle = app.getRequestHandler();

// Track active bridge instances per client WebSocket connection
const clientBridges = new Map<WebSocket, GeminiLiveBridge>();

app.prepare().then(() => {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const parsedUrl = parse(req.url || '', true);

    // Optional PIN header check for REST API routes (/api/*)
    if (parsedUrl.pathname?.startsWith('/api/')) {
      const pinHeader = req.headers['x-shop-pin'];
      if (expectedPin && pinHeader !== expectedPin) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid Shop PIN' }));
        return;
      }
    }

    handle(req, res, parsedUrl);
  });

  // Attach WebSocket Server on path /ws/live
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname, query } = parse(request.url || '', true);

    if (pathname === '/ws/live') {
      const pin = query.pin;
      // Validate PIN to protect against unauthorized public usage
      if (expectedPin && pin !== expectedPin) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const { query } = parse(req.url || '', true);
    const requestedSessionId = query.sessionId as string | undefined;

    console.log(`[WS] Client connected. Requested session: ${requestedSessionId || 'latest open'}`);

    try {
      // 1. Resolve or create active session context for this connection
      const activeSession: SessionContext = await getOrCreateActiveSession(requestedSessionId);
      console.log(`[WS] Session bound: Token #${activeSession.customerNumber} (${activeSession.sessionId})`);

      // 2. Initialize Gemini Live Bridge if API key is present
      let bridge: GeminiLiveBridge | null = null;
      if (geminiApiKey && !geminiApiKey.includes('your-gemini-api-key')) {
        bridge = new GeminiLiveBridge({
          apiKey: geminiApiKey,
          clientWs: ws,
          sessionContext: activeSession,
          onContextChange: (newContext) => {
            console.log(`[WS] Session context updated: Token #${newContext.customerNumber} (${newContext.sessionId})`);
          },
        });
        clientBridges.set(ws, bridge);
      } else {
        console.warn('[WS] ⚠️ GEMINI_API_KEY missing or placeholder. Running in offline/mock mode.');
      }

      // 3. Send connection acknowledgment with active session details
      ws.send(JSON.stringify({
        type: 'connection_ack',
        message: 'Connected to Kirana Voice Gateway',
        session: activeSession,
        geminiConfigured: Boolean(bridge),
        timestamp: new Date().toISOString(),
      }));

      // 4. Handle client messages (audio chunks & control events)
      ws.on('message', async (data: Buffer | string, isBinary: boolean) => {
        if (isBinary) {
          // Raw 16kHz 16-bit Mono PCM audio chunk from Hold-to-Talk recorder
          if (bridge) {
            bridge.sendAudioChunk(data);
          }
        } else {
          try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
              case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;

              case 'mic_start':
                console.log('[WS] Hold-to-Talk pressed (speech started)');
                if (bridge) {
                  bridge.startSpeech();
                }
                break;

              case 'mic_stop':
                console.log(`[WS] Hold-to-Talk released (speech ended). Audio sent: ${msg.audioMsSent || 0}ms (preroll: ${msg.prerollMs || 0}ms)`);
                if (bridge) {
                  bridge.stopSpeech({
                    audioMsSent: msg.audioMsSent,
                    prerollMs: msg.prerollMs,
                  });
                }
                break;

              case 'user_text':
                // For direct text input or testing without microphone
                console.log(`[WS] Received user text input: "${msg.text}"`);
                if (bridge) {
                  bridge.sendUserText(msg.text);
                }
                break;

              case 'start_new_bill': {
                console.log('[WS] Manual start_new_bill requested by client');
                const newContext = await createNewSession();
                if (bridge) {
                  bridge.updateSessionContext(newContext);
                }
                ws.send(JSON.stringify({
                  type: 'session_updated',
                  session: newContext,
                  message: `New bill started (Token #${newContext.customerNumber})`,
                }));
                break;
              }

              case 'switch_session': {
                console.log(`[WS] Session switch requested: ${msg.sessionId}`);
                const switched = await getOrCreateActiveSession(msg.sessionId);
                if (bridge) {
                  bridge.updateSessionContext(switched);
                }
                ws.send(JSON.stringify({
                  type: 'session_updated',
                  session: switched,
                  message: `Switched to Token #${switched.customerNumber}`,
                }));
                break;
              }

              default:
                console.log('[WS] Unhandled message type:', msg.type);
            }
          } catch (err) {
            console.error('[WS] Failed to parse client message:', err);
          }
        }
      });

      // 5. Cleanup on disconnect
      ws.on('close', () => {
        console.log(`[WS] Client disconnected from session: ${activeSession.sessionId}`);
        const activeBridge = clientBridges.get(ws);
        if (activeBridge) {
          activeBridge.destroy();
          clientBridges.delete(ws);
        }
      });

      ws.on('error', (err) => {
        console.error('[WS] Client socket error:', err);
        const activeBridge = clientBridges.get(ws);
        if (activeBridge) {
          activeBridge.destroy();
          clientBridges.delete(ws);
        }
      });
    } catch (err: any) {
      console.error('[WS] Error initializing client connection:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: `Failed to initialize session: ${err.message}`,
      }));
    }
  });

  server.listen(port, '0.0.0.0', () => {
    // Find local LAN IPv4 address for multi-device tablet access
    let networkIp = 'localhost';
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal) {
            networkIp = iface.address;
            break;
          }
        }
      }
    } catch {}

    console.log(`\n> Kirana Voice Billing is ready!`);
    console.log(`  - Local (Browser):   http://localhost:${port}`);
    console.log(`  - Local (IPv4):      http://127.0.0.1:${port}`);
    console.log(`  - Network (Tablet):  http://${networkIp}:${port}`);
    console.log(`  - WebSocket Gateway: ws://localhost:${port}/ws/live\n`);
  });
});
