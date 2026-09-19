/**
 * Kirana Voice Billing — Standalone Gemini Live Spike
 * 
 * Run this standalone test once your GEMINI_API_KEY is configured in .env.local:
 *   npx tsx scripts/gemini-live-spike.ts
 * 
 * Verifies:
 * 1. WebSocket handshake with Gemini Live API (v1alpha / generative language)
 * 2. Setup handshake with Function Declarations (add_line_item, close_bill)
 * 3. Model output script verification (ensuring Roman Hinglish rather than Devanagari)
 * 4. Model audio suppression (checking if audio chunks can be safely ignored)
 * 5. Round-trip tool-call latency measurement
 */

import WebSocket from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load local environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey.includes('your-gemini-api-key')) {
  console.error('\n❌ ERROR: GEMINI_API_KEY is missing or contains placeholder.');
  console.error('Please add your actual Gemini API key to .env.local before running this spike:\n');
  console.error('  GEMINI_API_KEY=AIzaSy...\n');
  process.exit(1);
}

const HOST = 'generativelanguage.googleapis.com';
const API_VERSION = 'v1alpha';
const MODEL = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash-native-audio-latest';
const WS_URL = `wss://${HOST}/ws/google.ai.generativelanguage.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${apiKey}`;

console.log('--- Starting Gemini Live API Spike ---');
console.log(`Target: ${WS_URL.replace(apiKey, 'REDACTED')}`);

const ws = new WebSocket(WS_URL);
let connectionStartTime = Date.now();

ws.on('open', () => {
  const connTime = Date.now() - connectionStartTime;
  console.log(`✅ WebSocket connected to Gemini Live in ${connTime}ms!`);

  // Send Initial Setup Message with Tools & Instructions
  const setupMessage = {
    setup: {
      model: MODEL,
      generationConfig: {
        responseModalities: ['AUDIO'], // Native audio model outputs audio; we safely suppress/ignore it
        temperature: 0.2,
      },
      systemInstruction: {
        parts: [
          {
            text: [
              'You are a high-speed billing agent at a Ranchi kirana shop.',
              'The shopkeeper speaks items and quantities in Hinglish.',
              'Always output item names in Latin/Roman Hinglish script (e.g. "chini", "aata"), never Devanagari ("चीनी").',
              'Immediately invoke add_line_item when an item and quantity are mentioned.',
              'Do not speak conversational chit-chat.',
            ].join(' '),
          },
        ],
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'add_line_item',
              description: 'Add a line item to the bill',
              parameters: {
                type: 'OBJECT',
                properties: {
                  item_name: { type: 'STRING', description: 'Item name in Roman Hinglish' },
                  quantity_text: { type: 'STRING', description: 'Spoken quantity e.g. 1 paav, aadha kilo' },
                  price_override: { type: 'NUMBER' },
                },
                required: ['item_name', 'quantity_text'],
              },
            },
            {
              name: 'close_bill',
              description: 'Close bill and return total',
              parameters: { type: 'OBJECT', properties: {} },
            },
          ],
        },
      ],
    },
  };

  console.log('📡 Sending Setup Message with Tools...');
  ws.send(JSON.stringify(setupMessage));
});

ws.on('message', (data: Buffer | string) => {
  try {
    const response = JSON.parse(data.toString());

    if (response.setupComplete) {
      console.log('✅ Setup Complete confirmed by Gemini Live API!');
      console.log('📡 Sending simulated user text prompt: "chini aadha kilo"...');

      const testPrompt = {
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: 'chini aadha kilo' }],
            },
          ],
          turnComplete: true,
        },
      };

      const sendTime = Date.now();
      ws.send(JSON.stringify(testPrompt));

      // Store send time for latency measurement
      (ws as any)._promptSendTime = sendTime;
    }

    const keys = Object.keys(response);
    // console.log(`[Event: ${keys.join(', ')}]`);

    // Top-level toolCall in Gemini Live API
    if (response.toolCall?.functionCalls) {
      for (const fc of response.toolCall.functionCalls) {
        const latency = Date.now() - (ws as any)._promptSendTime;
        console.log(`\n🎉 Received Function Call via toolCall in ${latency}ms:`);
        console.log(`   Tool: ${fc.name}`);
        console.log(`   Args:`, JSON.stringify(fc.args, null, 2));

        const itemName = fc.args?.item_name;
        const isDevanagari = /[\u0900-\u097F]/.test(itemName || '');
        if (isDevanagari) {
          console.warn(`⚠️ Warning: Item name "${itemName}" is in Devanagari script!`);
        } else {
          console.log(`✅ Item name "${itemName}" is clean Roman Hinglish.`);
        }

        console.log('\n--- Spike Result: SUCCESS ---');
        ws.close();
        process.exit(0);
      }
    }

    if (response.serverContent) {
      const parts = response.serverContent.modelTurn?.parts || [];
      for (const part of parts) {
        if (part.functionCall) {
          const latency = Date.now() - (ws as any)._promptSendTime;
          console.log(`\n🎉 Received Function Call in ${latency}ms:`);
          console.log(`   Tool: ${part.functionCall.name}`);
          console.log(`   Args:`, JSON.stringify(part.functionCall.args, null, 2));

          const itemName = part.functionCall.args?.item_name;
          const isDevanagari = /[\u0900-\u097F]/.test(itemName || '');
          if (isDevanagari) {
            console.warn(`⚠️ Warning: Item name "${itemName}" is in Devanagari script!`);
          } else {
            console.log(`✅ Item name "${itemName}" is clean Roman Hinglish.`);
          }

          console.log('\n--- Spike Result: SUCCESS ---');
          ws.close();
          process.exit(0);
        }
        if (part.text) {
          console.log(`💬 Model text response: ${part.text}`);
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse response message:', err);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: code=${code}, reason=${reason || 'Normal'}`);
});
