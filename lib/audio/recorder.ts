/**
 * Kirana Voice Billing — Browser PCM Audio Recorder & Voice Signal Analyzer
 * 
 * Features:
 * 1. Warm Audio Pipeline: Acquires mic, AudioContext, and AudioWorklet ONCE and keeps it warm.
 * 2. Pre-Roll Ring Buffer: Buffers ~300ms of audio while idle so the first syllable is never lost.
 * 3. Release Tail & Deterministic Flush: Captures a 300ms tail on release, requests a worklet flush,
 *    and awaits flush acknowledgment before completing turn teardown.
 * 4. Browser SpeechRecognition: Disabled by default to eliminate mic device contention on Android Chrome;
 *    gated strictly behind ?debugSpeech=true query param or NEXT_PUBLIC_DEBUG_SPEECH env flag.
 * 5. Telemetry: Tracks audioMsSent and prerollMs per utterance for clipping diagnostics.
 */

export interface AudioTelemetry {
  audioMsSent: number;
  prerollMs: number;
}

export const RELEASE_TAIL_MS = 300;
export const PREROLL_BUFFER_MS = 300;
const BYTES_PER_MS = 32; // 16,000 samples/sec * 2 bytes/sample (16-bit mono) / 1000 ms = 32 bytes/ms

export class PcmAudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private speechRecognition: any = null;

  private isInitialized = false;
  private isInitializing = false;
  private isRecording = false;

  // Pre-roll ring buffer (stores ~300ms of 16kHz PCM audio when idle)
  private prerollChunks: ArrayBuffer[] = [];
  private maxPrerollBytes = PREROLL_BUFFER_MS * BYTES_PER_MS; // 9600 bytes (~300ms)

  // Turn metrics
  private totalBytesSentInTurn = 0;
  private prerollBytesSentInTurn = 0;

  // Active callbacks
  private activeOnChunk: ((chunk: ArrayBuffer) => void) | null = null;
  private activeOnVolume: ((level: number) => void) | null = null;
  private activeOnInterimTranscript: ((text: string) => void) | null = null;

  // Flush synchronization
  private pendingFlushResolver: (() => void) | null = null;

  // Lifecycle listeners
  private boundVisibilityHandler: (() => void) | null = null;
  private boundDeviceChangeHandler: (() => void) | null = null;

  /**
   * Initializes the warm audio capture pipeline once (on first user gesture).
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing) {
      // Await in-flight initialization
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }

    this.isInitializing = true;

    try {
      // 1. Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 2. Initialize AudioContext
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 3. Setup AnalyserNode for live volume metering
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;

      // 4. Load AudioWorklet downsampler
      await this.audioContext.audioWorklet.addModule('/audio-worklet.js');

      // 5. Create Worklet Node and Source Node
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-downsampler-processor');

      // Handle messages from downsampler worklet
      this.workletNode.port.onmessage = (event: MessageEvent<any>) => {
        this.handleWorkletMessage(event.data);
      };

      // Connect source -> analyser -> worklet
      this.sourceNode.connect(this.analyserNode);
      this.sourceNode.connect(this.workletNode);

      // 6. Monitor tab visibility to resume AudioContext if browser pauses it
      this.boundVisibilityHandler = () => {
        if (document.visibilityState === 'visible' && this.audioContext?.state === 'suspended') {
          this.audioContext.resume().catch((err) => {
            console.warn('[Recorder] Failed to resume AudioContext on visibility change:', err);
          });
        }
      };
      document.addEventListener('visibilitychange', this.boundVisibilityHandler);

      // 7. Monitor audio device changes
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        this.boundDeviceChangeHandler = () => {
          console.log('[Recorder] Audio device change detected.');
        };
        navigator.mediaDevices.addEventListener('devicechange', this.boundDeviceChangeHandler);
      }

      // 8. Start ongoing volume monitoring loop
      this.startVolumeLoop();

      this.isInitialized = true;
      console.log('[Recorder] Warm audio pipeline initialized and ready.');
    } catch (err: any) {
      console.error('[Recorder] Initialization failed:', err);
      this.cleanupNodes();
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Processes incoming chunks or flush acknowledgments from the AudioWorklet
   */
  private handleWorkletMessage(data: any) {
    if (!data) return;

    // Check for flush acknowledgment
    if (data.type === 'flushed') {
      if (this.pendingFlushResolver) {
        const resolver = this.pendingFlushResolver;
        this.pendingFlushResolver = null;
        resolver();
      }
      return;
    }

    // Extract audio chunk buffer
    const buffer: ArrayBuffer | null =
      data instanceof ArrayBuffer
        ? data
        : data.type === 'chunk' && data.data instanceof ArrayBuffer
        ? data.data
        : null;

    if (!buffer) return;

    if (this.isRecording) {
      // Actively recording: forward chunk immediately
      this.totalBytesSentInTurn += buffer.byteLength;
      if (this.activeOnChunk) {
        this.activeOnChunk(buffer);
      }
    } else {
      // Idle: accumulate into pre-roll ring buffer (~300ms)
      this.prerollChunks.push(buffer);
      let currentBytes = this.prerollChunks.reduce((acc, c) => acc + c.byteLength, 0);

      while (currentBytes > this.maxPrerollBytes && this.prerollChunks.length > 1) {
        const removed = this.prerollChunks.shift();
        if (removed) {
          currentBytes -= removed.byteLength;
        }
      }
    }
  }

  /**
   * Starts speech capture: flushes pre-roll buffer and gates chunk forwarding
   */
  async start(
    onChunk: (chunk: ArrayBuffer) => void,
    onVolume?: (level: number) => void,
    onInterimTranscript?: (text: string) => void
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }

    // Resume AudioContext if suspended (e.g. browser power saving)
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.activeOnChunk = onChunk;
    this.activeOnVolume = onVolume || null;
    this.activeOnInterimTranscript = onInterimTranscript || null;

    this.totalBytesSentInTurn = 0;
    this.prerollBytesSentInTurn = 0;

    // 1. Immediately flush all pre-roll chunks so the initial syllable is captured
    const prerollCount = this.prerollChunks.length;
    while (this.prerollChunks.length > 0) {
      const chunk = this.prerollChunks.shift();
      if (chunk) {
        this.prerollBytesSentInTurn += chunk.byteLength;
        this.totalBytesSentInTurn += chunk.byteLength;
        onChunk(chunk);
      }
    }

    this.isRecording = true;
    console.log(`[Recorder] Recording started with ${prerollCount} pre-roll chunks (${this.prerollBytesSentInTurn / BYTES_PER_MS}ms).`);

    // 2. Optional browser SpeechRecognition (DEBUG ONLY)
    this.startSpeechRecognitionIfDebug();
  }

  /**
   * Stops speech capture deterministically:
   * 1. Captures trailing audio for RELEASE_TAIL_MS (300ms) to preserve ending words
   * 2. Flushes the worklet buffer and awaits acknowledgment
   * 3. Leaves audio stream warm for the next utterance
   */
  async stop(): Promise<AudioTelemetry> {
    if (!this.isRecording) {
      return {
        audioMsSent: Math.round(this.totalBytesSentInTurn / BYTES_PER_MS),
        prerollMs: Math.round(this.prerollBytesSentInTurn / BYTES_PER_MS),
      };
    }

    // Stop debug speech recognition if running
    this.stopSpeechRecognition();

    // 1. Capture release tail (300ms) while still forwarding chunks
    await new Promise((resolve) => setTimeout(resolve, RELEASE_TAIL_MS));

    // 2. Request worklet flush and await acknowledgment
    if (this.workletNode) {
      await new Promise<void>((resolve) => {
        const fallbackTimer = setTimeout(() => {
          this.pendingFlushResolver = null;
          resolve();
        }, 200);

        this.pendingFlushResolver = () => {
          clearTimeout(fallbackTimer);
          resolve();
        };

        this.workletNode!.port.postMessage('flush');
      });
    }

    // 3. Close active turn gate
    this.isRecording = false;
    this.activeOnChunk = null;

    const audioMsSent = Math.round(this.totalBytesSentInTurn / BYTES_PER_MS);
    const prerollMs = Math.round(this.prerollBytesSentInTurn / BYTES_PER_MS);

    console.log(`[Recorder] Recording stopped. Total: ${audioMsSent}ms (Pre-roll: ${prerollMs}ms, Tail: ${RELEASE_TAIL_MS}ms). Audio graph kept warm.`);

    return { audioMsSent, prerollMs };
  }

  /**
   * Volume metering loop running on requestAnimationFrame
   */
  private startVolumeLoop() {
    if (!this.analyserNode) return;
    const pcmData = new Uint8Array(this.analyserNode.frequencyBinCount);

    const pollVolume = () => {
      if (!this.analyserNode || !this.audioContext || this.audioContext.state === 'closed') {
        return;
      }

      this.analyserNode.getByteFrequencyData(pcmData);
      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) {
        sum += pcmData[i];
      }
      const avg = sum / pcmData.length;
      const volumePercent = Math.min(100, Math.round((avg / 128) * 100));

      if (this.activeOnVolume) {
        this.activeOnVolume(volumePercent);
      }

      requestAnimationFrame(pollVolume);
    };

    requestAnimationFrame(pollVolume);
  }

  /**
   * Starts SpeechRecognition strictly if debug flag is active
   */
  private startSpeechRecognitionIfDebug() {
    if (typeof window === 'undefined') return;

    // Check debug flag: URL param ?debugSpeech=true or NEXT_PUBLIC_DEBUG_SPEECH env flag
    const urlParams = new URLSearchParams(window.location.search);
    const isDebugEnabled =
      urlParams.get('debugSpeech') === 'true' ||
      process.env.NEXT_PUBLIC_DEBUG_SPEECH === 'true';

    if (!isDebugEnabled) {
      return; // Disabled by default per HLD §3.7
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = true;
      this.speechRecognition.lang = 'hi-IN';

      this.speechRecognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          interim += event.results[i][0].transcript;
        }
        if (interim && this.activeOnInterimTranscript) {
          this.activeOnInterimTranscript(interim.trim());
        }
      };

      this.speechRecognition.onerror = () => {
        // Non-critical debug errors
      };

      this.speechRecognition.start();
      console.log('[Recorder] 🔍 Browser SpeechRecognition debug mode active.');
    } catch {}
  }

  private stopSpeechRecognition() {
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {}
      this.speechRecognition = null;
    }
  }

  private cleanupNodes() {
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {}
      this.workletNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {}
      this.analyserNode = null;
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch {}
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    this.isInitialized = false;
    this.isRecording = false;
  }

  /**
   * Complete destruction on unmount
   */
  destroy(): void {
    this.stopSpeechRecognition();

    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }

    if (this.boundDeviceChangeHandler && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', this.boundDeviceChangeHandler);
      this.boundDeviceChangeHandler = null;
    }

    this.cleanupNodes();
    console.log('[Recorder] Destroyed audio pipeline.');
  }

  get active(): boolean {
    return this.isRecording;
  }

  get warm(): boolean {
    return this.isInitialized && Boolean(this.audioContext && this.audioContext.state !== 'closed');
  }
}
