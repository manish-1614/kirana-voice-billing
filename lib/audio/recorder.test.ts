/**
 * Unit Tests for PcmAudioRecorder — Warm Pipeline, Pre-Roll Buffer, Tail & Flush Handshake
 */

import { PcmAudioRecorder, RELEASE_TAIL_MS } from './recorder';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

// Mock Web Audio API environment for Node.js test execution
class MockAudioWorkletPort {
  public onmessage: ((event: { data: any }) => void) | null = null;
  public postedMessages: any[] = [];

  postMessage(data: any) {
    this.postedMessages.push(data);
    if (data === 'flush' && this.onmessage) {
      // Simulate worklet flushing remaining chunk and then sending ack
      const remainingBuffer = new ArrayBuffer(1600); // 50ms of audio
      this.onmessage({ data: { type: 'chunk', data: remainingBuffer } });
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({ data: { type: 'flushed' } });
        }
      }, 20);
    }
  }
}

class MockAudioWorkletNode {
  public port = new MockAudioWorkletPort();
  connect() {}
  disconnect() {}
}

class MockAnalyserNode {
  fftSize = 256;
  frequencyBinCount = 128;
  connect() {}
  disconnect() {}
  getByteFrequencyData(arr: Uint8Array) {
    arr.fill(32);
  }
}

class MockMediaStreamTrack {
  stopCalled = false;
  stop() {
    this.stopCalled = true;
  }
}

class MockMediaStream {
  tracks = [new MockMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

class MockAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  audioWorklet = {
    addModule: async () => Promise.resolve(),
  };
  async resume() {
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
  createAnalyser() {
    return new MockAnalyserNode();
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
}

// Setup globals before running tests
let getUserMediaCallCount = 0;

function setupMockBrowser() {
  getUserMediaCallCount = 0;
  (globalThis as any).window = {
    AudioContext: MockAudioContext,
    location: { search: '' },
  };
  (globalThis as any).document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCallCount++;
          return new MockMediaStream();
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    },
    configurable: true,
    writable: true,
  });
  (globalThis as any).AudioWorkletNode = MockAudioWorkletNode;
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16);
}

export async function runRecorderTests() {
  console.log('\n--- Running PcmAudioRecorder Test Suite ---');
  setupMockBrowser();

  const recorder = new PcmAudioRecorder();

  // Test 1: First start initializes warm audio graph
  console.log('Testing Test 1: Single warm initialization...');
  const receivedChunks1: ArrayBuffer[] = [];
  await recorder.start((chunk) => {
    receivedChunks1.push(chunk);
  });

  assert(recorder.active === true, 'Recorder should be active after start');
  assert(recorder.warm === true, 'Recorder should be warm after start');
  assert(getUserMediaCallCount === 1, 'getUserMedia should be called exactly once');
  console.log('✅ Test 1 Passed: Initialized audio pipeline.');

  // Test 2: Release captures tail and deterministic flush
  console.log('Testing Test 2: Release tail and deterministic flush...');
  const stopStart = Date.now();
  const telemetry = await recorder.stop();
  const stopDuration = Date.now() - stopStart;

  assert(recorder.active === false, 'Recorder should be inactive after stop');
  assert(recorder.warm === true, 'Audio pipeline must remain warm after stop');
  assert(stopDuration >= RELEASE_TAIL_MS, `Stop duration (${stopDuration}ms) must include RELEASE_TAIL_MS (${RELEASE_TAIL_MS}ms)`);
  assert(typeof telemetry.audioMsSent === 'number', 'Telemetry must return audioMsSent');
  console.log(`✅ Test 2 Passed: Stop executed with ${stopDuration}ms tail & flush handshake.`);

  // Test 3: Second press does NOT call getUserMedia again (Warm stream)
  console.log('Testing Test 3: Second press warm reuse...');
  const receivedChunks2: ArrayBuffer[] = [];
  await recorder.start((chunk) => {
    receivedChunks2.push(chunk);
  });

  assert(getUserMediaCallCount === 1, 'getUserMedia must NOT be called again on subsequent presses');
  assert(recorder.active === true, 'Recorder is active again');
  console.log('✅ Test 3 Passed: Stream re-used with zero re-init delay.');

  // Test 4: Pre-roll buffer accumulation while idle
  console.log('Testing Test 4: Pre-roll buffer prepending...');
  await recorder.stop();

  // Simulate audio chunks arriving while recorder is idle (100ms chunks = 3200 bytes)
  const workletNode = (recorder as any).workletNode as MockAudioWorkletNode;
  const chunk1 = new ArrayBuffer(3200);
  const chunk2 = new ArrayBuffer(3200);
  workletNode.port.onmessage!({ data: { type: 'chunk', data: chunk1 } });
  workletNode.port.onmessage!({ data: { type: 'chunk', data: chunk2 } });

  // Now start recording: pre-roll chunks should be prepended immediately
  const prependedChunks: ArrayBuffer[] = [];
  await recorder.start((chunk) => {
    prependedChunks.push(chunk);
  });

  assert(prependedChunks.length >= 2, `Expected at least 2 pre-roll chunks flushed, got ${prependedChunks.length}`);
  const prerollMs = (recorder as any).prerollBytesSentInTurn / 32;
  assert(prerollMs === 200, `Expected 200ms of pre-roll flushed, got ${prerollMs}ms`);
  console.log('✅ Test 4 Passed: Pre-roll buffer captured and prepended initial audio.');

  // Test 5: Destroy tears down pipeline
  console.log('Testing Test 5: Destroy pipeline cleanup...');
  await recorder.stop();
  recorder.destroy();
  assert(recorder.warm === false, 'Recorder should not be warm after destroy');
  console.log('✅ Test 5 Passed: Clean pipeline teardown.');

  console.log('\n🎉 ALL 5 RECORDER TESTS PASSED SUCCESSFULLY!');
}

// Direct execution support
if (require.main === module) {
  runRecorderTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
