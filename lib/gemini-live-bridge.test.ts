/**
 * Unit Tests for GeminiLiveBridge — Manual Activity Signaling, Queueing & Tool Serialization
 */

import { EventEmitter } from 'events';
import { GeminiLiveBridge } from './gemini-live-bridge';
import { SessionContext } from './tool-dispatcher';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

// Mock WebSocket implementation for unit testing Gemini and Client sockets
class MockWs extends EventEmitter {
  public readyState = 1; // WebSocket.OPEN
  public sentMessages: string[] = [];

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit('close', 1000, 'Normal');
  }

  simulateIncoming(data: any) {
    this.emit('message', Buffer.from(JSON.stringify(data)));
  }
}

export async function runBridgeTests() {
  console.log('\n--- Running GeminiLiveBridge Test Suite ---');

  const mockClientWs = new MockWs();
  const mockGeminiWs = new MockWs();
  const sessionContext: SessionContext = {
    sessionId: 'test-session-123',
    customerNumber: 1,
    sessionDate: '2026-09-19',
    status: 'open',
  };

  // Instantiate bridge with injected mockGeminiWs
  const bridge = new GeminiLiveBridge({
    apiKey: 'mock-key',
    clientWs: mockClientWs as any,
    sessionContext,
    geminiWs: mockGeminiWs as any,
  });

  // Test 1: Handshake setup disables automaticActivityDetection
  console.log('Testing Test 1: Setup handshake with automaticActivityDetection.disabled = true...');
  assert(mockGeminiWs.sentMessages.length >= 1, 'Setup message should be sent on connection');
  const setupMsg = JSON.parse(mockGeminiWs.sentMessages[0]);
  assert(
    setupMsg.setup?.realtimeInputConfig?.automaticActivityDetection?.disabled === true,
    'setup must disable automaticActivityDetection'
  );
  console.log('✅ Test 1 Passed: Handshake disables automatic VAD.');

  // Simulate setupComplete from Gemini
  mockGeminiWs.simulateIncoming({ setupComplete: {} });
  assert((bridge as any).isGeminiReady === true, 'Bridge should be marked ready after setupComplete');

  // Test 2: Speech Start sends activityStart signal
  console.log('Testing Test 2: Manual activityStart signaling...');
  const msgCountBeforeStart = mockGeminiWs.sentMessages.length;
  bridge.startSpeech();

  const startMsg = JSON.parse(mockGeminiWs.sentMessages[msgCountBeforeStart]);
  assert(startMsg.realtimeInput?.activityStart !== undefined, 'startSpeech must send realtimeInput.activityStart');
  console.log('✅ Test 2 Passed: activityStart signal dispatched.');

  // Test 3: Audio chunk streaming via realtimeInput.mediaChunks
  console.log('Testing Test 3: PCM audio chunk streaming...');
  const msgCountBeforeChunk = mockGeminiWs.sentMessages.length;
  // Send 3200 bytes (100ms threshold)
  bridge.sendAudioChunk(Buffer.alloc(3200, 1));
  const chunkMsg = JSON.parse(mockGeminiWs.sentMessages[msgCountBeforeChunk]);
  assert(chunkMsg.realtimeInput?.mediaChunks?.length > 0, 'Audio chunk must be sent via realtimeInput.mediaChunks');
  assert(chunkMsg.realtimeInput.mediaChunks[0].mimeType === 'audio/pcm;rate=16000', 'Mime type must be audio/pcm;rate=16000');
  console.log('✅ Test 3 Passed: 16kHz PCM audio chunk streamed.');

  // Test 4: Speech Stop sends activityEnd signal (NOT turnComplete)
  console.log('Testing Test 4: Manual activityEnd signaling on release...');
  const msgCountBeforeStop = mockGeminiWs.sentMessages.length;
  bridge.stopSpeech({ audioMsSent: 400, prerollMs: 200 });

  const stopMsg = JSON.parse(mockGeminiWs.sentMessages[msgCountBeforeStop]);
  assert(stopMsg.realtimeInput?.activityEnd !== undefined, 'stopSpeech must send realtimeInput.activityEnd');
  assert(stopMsg.clientContent === undefined, 'Must not send clientContent.turnComplete on manual activity turn');
  console.log('✅ Test 4 Passed: activityEnd signal dispatched on release.');

  // Test 5: Overlapping speech buffering during in-flight tool call (Gemini 1008 protection)
  console.log('Testing Test 5: Overlapping speech queueing during pending tool call...');
  // Simulate Gemini emitting a tool call
  (bridge as any).isToolTurnPending = true;

  const geminiMsgCountBeforeQueued = mockGeminiWs.sentMessages.length;
  bridge.startSpeech();
  assert(mockGeminiWs.sentMessages.length === geminiMsgCountBeforeQueued, 'Must NOT send activityStart while tool turn is pending');
  assert((bridge as any).isSpeechQueued === true, 'Speech must be marked queued');

  // Stream audio while queued
  bridge.sendAudioChunk(Buffer.alloc(3200, 2));
  assert((bridge as any).queuedAudioChunks.length > 0, 'Audio must be buffered in queuedAudioChunks');

  // User releases while tool is still pending
  bridge.stopSpeech({ audioMsSent: 300, prerollMs: 100 });
  assert((bridge as any).isSpeechEndQueued === true, 'Speech end must be marked queued');
  assert(mockGeminiWs.sentMessages.length === geminiMsgCountBeforeQueued, 'Must NOT send activityEnd while tool turn is pending');

  // Now simulate tool call response completion
  (bridge as any).isToolTurnPending = false;
  (bridge as any).dispatchQueuedSpeechIfAny();

  // Verify that activityStart, mediaChunks, and activityEnd were flushed in sequence
  const newMessages = mockGeminiWs.sentMessages.slice(geminiMsgCountBeforeQueued).map((m) => JSON.parse(m));
  const hasActivityStart = newMessages.some((m) => m.realtimeInput?.activityStart !== undefined);
  const hasMediaChunks = newMessages.some((m) => m.realtimeInput?.mediaChunks !== undefined);
  const hasActivityEnd = newMessages.some((m) => m.realtimeInput?.activityEnd !== undefined);

  assert(hasActivityStart, 'Queued activityStart must be sent after tool turn');
  assert(hasMediaChunks, 'Queued media chunks must be sent after tool turn');
  assert(hasActivityEnd, 'Queued activityEnd must be sent after tool turn');
  // Test 6: Multiple tool calls in one turn and grouped response behavior
  console.log('Testing Test 6: Multiple tool calls in one turn and grouped response...');
  const geminiMsgCountBeforeBatch = mockGeminiWs.sentMessages.length;
  const clientMsgCountBeforeBatch = mockClientWs.sentMessages.length;

  // Simulate Gemini sending a batch of 2 function calls in one turn
  mockGeminiWs.simulateIncoming({
    toolCall: {
      functionCalls: [
        {
          id: 'call_burst_1',
          name: 'add_line_item',
          args: { item_name: 'chini', quantity_text: '1 paav' },
        },
        {
          id: 'call_burst_2',
          name: 'add_line_item',
          args: { item_name: 'aata', quantity_text: '1 kilo' },
        },
      ],
    },
  });

  // Wait for queue promise to settle
  await (bridge as any).toolExecutionQueue;

  // Verify Gemini received exactly ONE toolResponse containing both functionResponses
  const geminiNewMsgs = mockGeminiWs.sentMessages.slice(geminiMsgCountBeforeBatch).map((m) => JSON.parse(m));
  const toolResponseMsgs = geminiNewMsgs.filter((m) => m.toolResponse !== undefined);
  assert(toolResponseMsgs.length === 1, `Expected 1 grouped toolResponse, got ${toolResponseMsgs.length}`);
  const fResponses = toolResponseMsgs[0].toolResponse.functionResponses;
  assert(fResponses.length === 2, `Expected 2 functionResponses in grouped toolResponse, got ${fResponses.length}`);
  assert(fResponses[0].id === 'call_burst_1', 'First response ID must match call_burst_1');
  assert(fResponses[1].id === 'call_burst_2', 'Second response ID must match call_burst_2');

  // Verify Client tablet received individual real-time updates for each item
  const clientNewMsgs = mockClientWs.sentMessages.slice(clientMsgCountBeforeBatch).map((m) => JSON.parse(m));
  const toolResultMsgs = clientNewMsgs.filter((m) => m.type === 'tool_result');
  assert(toolResultMsgs.length === 2, `Expected 2 client tool_result events, got ${toolResultMsgs.length}`);
  assert(toolResultMsgs[0].data?.canonical_name === 'Sugar (Chini)', 'First tool_result should be Sugar');
  assert(toolResultMsgs[1].data?.canonical_name === 'Aashirvaad Atta', 'Second tool_result should be Atta');
  console.log('✅ Test 6 Passed: Multi-item burst processed sequentially with grouped Gemini toolResponse.');

  bridge.destroy();
  console.log('\n🎉 ALL 6 GEMINI LIVE BRIDGE TESTS PASSED SUCCESSFULLY!');
}

// Direct execution support
if (require.main === module) {
  runBridgeTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
