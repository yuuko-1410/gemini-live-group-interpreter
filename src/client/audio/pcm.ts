export type RecorderHandle = {
  stop(): void;
};

export async function startPcmRecorder(
  onChunk: (chunk: Uint8Array) => void,
  onLevel?: (level: number) => void,
): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const resampled = resample(input, context.sampleRate, 16000);
    onLevel?.(calculateLevel(input));
    onChunk(floatTo16BitPcm(resampled));
  };

  source.connect(processor);
  processor.connect(context.destination);

  return {
    stop() {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}

function calculateLevel(input: Float32Array): number {
  if (input.length === 0) return 0;

  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index] ?? 0;
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / input.length);
  return Math.min(1, rms * 8);
}

export class PcmPlayer {
  private context: AudioContext | null = null;
  private nextStartTime = 0;

  async unlock(sampleRate = 24000): Promise<void> {
    const context = this.getContext(sampleRate);
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  async play(chunk: Uint8Array, sampleRate = 24000): Promise<void> {
    const context = this.getContext(sampleRate);
    if (context.state === "suspended") {
      await context.resume();
    }

    const samples = pcm16ToFloat32(chunk);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(Float32Array.from(samples), 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
  }

  reset(): void {
    void this.context?.close();
    this.context = null;
    this.nextStartTime = 0;
  }

  private getContext(sampleRate: number): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate });
      this.nextStartTime = this.context.currentTime;
    }

    return this.context;
  }
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;

  const ratio = fromRate / toRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    output[index] = input[Math.floor(index * ratio)] ?? 0;
  }

  return output;
}

function floatTo16BitPcm(input: Float32Array): Uint8Array {
  const output = new DataView(new ArrayBuffer(input.length * 2));

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Uint8Array(output.buffer);
}

function pcm16ToFloat32(input: Uint8Array): Float32Array {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const output = new Float32Array(input.byteLength / 2);

  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  return output;
}
