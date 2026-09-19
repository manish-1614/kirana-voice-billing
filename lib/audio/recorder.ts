/**
 * Kirana Voice Billing — Browser PCM Audio Recorder & Voice Signal Analyzer
 * 
 * Captures microphone stream via Web Audio API, downsamples to 16kHz linear PCM mono via AudioWorklet,
 * buffers 100ms frames, monitors live input volume levels, and exposes interim speech recognition.
 */

export class PcmAudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private speechRecognition: any = null;
  private isRecording = false;

  async start(
    onChunk: (chunk: ArrayBuffer) => void,
    onVolume?: (level: number) => void,
    onInterimTranscript?: (text: string) => void
  ): Promise<void> {
    if (this.isRecording) return;

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

    this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.isRecording && event.data) {
        onChunk(event.data);
      }
    };

    // Connect source -> analyser -> worklet
    this.sourceNode.connect(this.analyserNode);
    this.sourceNode.connect(this.workletNode);
    this.isRecording = true;

    // 6. Volume polling loop
    if (onVolume) {
      const pcmData = new Uint8Array(this.analyserNode.frequencyBinCount);
      const pollVolume = () => {
        if (!this.isRecording || !this.analyserNode) return;
        this.analyserNode.getByteFrequencyData(pcmData);
        let sum = 0;
        for (let i = 0; i < pcmData.length; i++) {
          sum += pcmData[i];
        }
        const avg = sum / pcmData.length;
        // Normalize roughly to 0..100
        const volumePercent = Math.min(100, Math.round((avg / 128) * 100));
        onVolume(volumePercent);
        requestAnimationFrame(pollVolume);
      };
      requestAnimationFrame(pollVolume);
    }

    // 7. Optional browser speech recognition for real-time live subtitle display
    if (onInterimTranscript && typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          this.speechRecognition = new SpeechRecognition();
          this.speechRecognition.continuous = true;
          this.speechRecognition.interimResults = true;
          this.speechRecognition.lang = 'hi-IN'; // Indian Hindi/Hinglish

          this.speechRecognition.onresult = (event: any) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              interim += event.results[i][0].transcript;
            }
            if (interim) {
              onInterimTranscript(interim.trim());
            }
          };

          this.speechRecognition.onerror = (e: any) => {
            // Non-critical; ignore speech recognition errors
          };

          this.speechRecognition.start();
        } catch {}
      }
    }
  }

  stop(): void {
    this.isRecording = false;

    // Stop client speech recognition
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {}
      this.speechRecognition = null;
    }

    // Flush any remaining samples in worklet before disconnecting
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage('flush');
      } catch {}
      setTimeout(() => {
        if (this.workletNode) {
          this.workletNode.disconnect();
          this.workletNode = null;
        }
      }, 50);
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      setTimeout(() => {
        if (this.audioContext && this.audioContext.state !== 'closed') {
          this.audioContext.close();
          this.audioContext = null;
        }
      }, 100);
    }
  }

  get active(): boolean {
    return this.isRecording;
  }
}
