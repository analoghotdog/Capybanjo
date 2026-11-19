// Microphone capture, device selection, live level meter and PCM recording via
// an AudioWorklet. See build plan C5 and Steps 18-19.
// NOTE: recorder-worklet.js is an addition to the C1 layout (see DEVIATIONS.md).

/** List audio input devices (labels require a prior permission grant). */
export async function listInputDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || `Input ${d.deviceId.slice(0, 6)}` }));
}

/**
 * Open the microphone. Constraints per C5: no echo cancellation, noise
 * suppression or AGC, so timing measurements are not distorted.
 */
export async function startCapture({ deviceId = null } = {}) {
  const constraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  return stream;
}

export function stopCapture(stream) {
  for (const track of stream.getTracks()) track.stop();
}

/** Encode mono Float32 PCM as a 16-bit WAV Blob (takes are stored as Blobs). */
export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Decode a WAV Blob back to Float32Array (for replay of stored takes). */
export async function decodeWav(blob) {
  const ctx = new (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext)(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  return { samples: buf.getChannelData(0), sampleRate: buf.sampleRate };
}

/** Live level meter over an AnalyserNode with a clipping warning. */
export function createLevelMeter(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  let peak = 0;
  let clipped = false;
  return {
    sample() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      let p = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        sum += v * v;
        const a = Math.abs(v);
        if (a > p) p = a;
        if (a >= 0.99) clipped = true;
      }
      peak = p;
      return { rms: Math.sqrt(sum / buf.length), peak: p, clipped };
    },
    resetClip() { clipped = false; },
  };
}

/**
 * PCM recorder backed by an AudioWorklet. Chunks are collected on the main
 * thread into one Float32Array per channel (mono mixdown).
 */
export async function createRecorder(ctx, sourceNode) {
  const workletUrl = new URL('./recorder-worklet.js', import.meta.url);
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'banjo-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  sourceNode.connect(node);
  node.connect(ctx.destination); // keep the graph pulled; output is silent

  let chunks = [];
  let recording = false;
  node.port.onmessage = (e) => {
    if (recording && e.data instanceof Float32Array) chunks.push(e.data);
  };

  return {
    start() {
      chunks = [];
      recording = true;
      node.port.postMessage('start');
    },
    /** @returns {Promise<{ samples: Float32Array, sampleRate: number }>} */
    stop() {
      recording = false;
      node.port.postMessage('stop');
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Float32Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.length;
      }
      chunks = [];
      return Promise.resolve({ samples: out, sampleRate: ctx.sampleRate });
    },
    isRecording: () => recording,
    dispose() {
      try { sourceNode.disconnect(node); node.disconnect(); } catch { /* torn down */ }
    },
  };
}
