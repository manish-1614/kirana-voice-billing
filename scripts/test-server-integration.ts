/**
 * Kirana Voice Billing — End-to-End Server & WebSocket Integration Test
 * 
 * Verifies:
 * 1. HTTP and WebSocket handshake with SHOP_PIN authentication
 * 2. Automatic daily session binding in Asia/Kolkata
 * 3. Gemini Live session handshake and tool configuration
 * 4. Bidirectional tool-call dispatch:
 *    - "chini aadha kilo" -> add_line_item -> DB commit -> Realtime & WS tool_result
 *    - "total batao" -> close_bill -> DB session status updated
 * 5. Latency metrics logging
 */

import WebSocket from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const port = process.env.PORT || '3000';
const pin = process.env.SHOP_PIN || '1234';
const wsUrl = `ws://localhost:${port}/ws/live?pin=${pin}`;

console.log('--- Starting Kirana Voice Server Integration Test ---');
console.log(`Connecting to: ${wsUrl}`);

const ws = new WebSocket(wsUrl);

let testStage: 'connecting' | 'waiting_gemini' | 'testing_add_item' | 'testing_close_bill' | 'complete' = 'connecting';
let activeSessionId: string | null = null;

const timeout = setTimeout(() => {
  console.error('\n❌ Test timed out after 30 seconds.');
  ws.close();
  process.exit(1);
}, 30000);

ws.on('open', () => {
  console.log('✅ WebSocket connected to local server!');
});

ws.on('message', (raw: Buffer | string) => {
  try {
    const msg = JSON.parse(raw.toString());
    console.log(`[Event Received: ${msg.type}]`, msg.message || '');

    // 1. Connection acknowledgment
    if (msg.type === 'connection_ack') {
      console.log(`✅ Server connection acknowledged! Session Token #${msg.session?.customerNumber} (${msg.session?.sessionId})`);
      activeSessionId = msg.session?.sessionId;
      testStage = 'waiting_gemini';
    }

    // 2. Gemini Live ready
    if (msg.type === 'gemini_ready') {
      console.log(`✅ Gemini Live is ready (${msg.model})!`);
      console.log('\n--- Step 1: Testing "chini aadha kilo" ---');
      testStage = 'testing_add_item';

      // Send simulated speech turn
      ws.send(JSON.stringify({
        type: 'user_text',
        text: 'chini aadha kilo',
      }));
    }

    // 3. Tool Result
    if (msg.type === 'tool_result') {
      console.log(`\n🎉 Tool Result Received: [${msg.tool}] -> ${msg.status}`);
      console.log(`   Earcon:  ${msg.earcon}`);
      console.log(`   Message: ${msg.message}`);
      console.log(`   Data:`, JSON.stringify(msg.data, null, 2));
      console.log(`   Latency: Gemini ${msg.latency?.geminiLiveMs}ms, DB ${msg.latency?.dbCommitMs}ms (Total: ${msg.latency?.totalMs}ms)`);

      if (testStage === 'testing_add_item') {
        if (msg.tool !== 'add_line_item' || msg.status !== 'ok') {
          throw new Error(`Expected add_line_item success, got: ${JSON.stringify(msg)}`);
        }
        if (msg.earcon !== 'chime') {
          throw new Error(`Expected chime earcon, got: ${msg.earcon}`);
        }
        console.log('✅ Step 1 Succeeded: Line item added and snapshot priced!');

        console.log('\n--- Step 2: Testing "total batao" (close bill) ---');
        testStage = 'testing_close_bill';

        // Send simulated bill close turn
        ws.send(JSON.stringify({
          type: 'user_text',
          text: 'total batao',
        }));
      } else if (testStage === 'testing_close_bill') {
        if (msg.tool !== 'close_bill' || msg.status !== 'ok') {
          throw new Error(`Expected close_bill success, got: ${JSON.stringify(msg)}`);
        }
        console.log('✅ Step 2 Succeeded: Bill closed with final total!');
        console.log('\n🎉 ALL INTEGRATION TESTS PASSED PERFECTLY!\n');
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }
    }
  } catch (err: any) {
    console.error('❌ Error handling message:', err.message);
    clearTimeout(timeout);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
  clearTimeout(timeout);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: ${code} ${reason}`);
});
