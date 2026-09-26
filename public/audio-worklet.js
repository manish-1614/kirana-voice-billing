/**
 * Kirana Voice Billing — 16kHz PCM Downsampler AudioWorklet
 * 
 * Runs in the browser's audio rendering thread.
 * Downsamples input microphone audio from the hardware sample rate (e.g. 44.1kHz / 48kHz)
 * to 16,000 Hz 16-bit linear PCM mono as required by the Gemini Live API.
 * Buffers samples into 100ms chunks (1,600 samples = 3,200 bytes) for optimal streaming.
 */

class PcmDownsamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    // 100ms chunk at 16kHz = 1600 samples (3200 bytes)
    this.chunkSize = 1600;
    this.buffer = new Int16Array(this.chunkSize);
    this.bufferIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        if (this.bufferIndex > 0) {
          // Send whatever remaining audio is in the buffer
          const remaining = this.buffer.slice(0, this.bufferIndex);
          this.port.postMessage({ type: 'chunk', data: remaining.buffer }, [remaining.buffer]);
          this.bufferIndex = 0;
        }
        // Acknowledge that worklet buffer is completely flushed
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Mono input channel
    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // Linear interpolation downsampling
    const inputSampleRate = sampleRate; // Global in AudioWorkletGlobalScope
    const ratio = inputSampleRate / this.targetSampleRate;
    const outputLength = Math.floor(channelData.length / ratio);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const index = Math.floor(srcIndex);
      const nextIndex = Math.min(index + 1, channelData.length - 1);
      const fraction = srcIndex - index;

      // Interpolate between samples
      const sample = channelData[index] * (1 - fraction) + channelData[nextIndex] * fraction;

      // Clamp to -1.0 .. 1.0 and convert to 16-bit signed integer
      const clamped = Math.max(-1, Math.min(1, sample));
      const pcmSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      this.buffer[this.bufferIndex++] = pcmSample;

      // When buffer reaches 100ms, post chunk to main thread
      if (this.bufferIndex >= this.chunkSize) {
        const chunk = new Int16Array(this.buffer);
        this.port.postMessage({ type: 'chunk', data: chunk.buffer }, [chunk.buffer]);
        this.buffer = new Int16Array(this.chunkSize);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-downsampler-processor', PcmDownsamplerProcessor);
