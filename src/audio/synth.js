// Karplus-Strong plucked-string synthesis plus a simple reference tone.
// See build plan Step 13. String/fret to frequency conversion lives in
// src/tab/model.js (stringFretToFreq).

/** Generate a Karplus-Strong pluck into a new AudioBuffer. */
export function karplusStrongBuffer(ctx, freq, duration = 2, options = {}) {
  const damping = options.damping ?? 0.996;
  const brightness = options.brightness ?? 0.5;
  const sr = ctx.sampleRate;
  const n = Math.max(2, Math.round(sr / freq));
  const len = Math.max(1, Math.floor(duration * sr));
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  // Initial excitation: noise burst, low-passed by a running average so the
  // brightness parameter can mellow it.
  const burst = new Float32Array(n);
  for (let i = 0; i < n; i++) burst[i] = Math.random() * 2 - 1;
  const smooth = Math.max(1, Math.round((1 - brightness) * 8) + 1);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < smooth; k++) acc += burst[(i + k) % n];
    burst[i] = acc / smooth;
  }

  for (let i = 0; i < len; i++) {
    out[i] = i < n ? burst[i] : 0;
  }
  // Delay-line averaging feedback.
  for (let i = n; i < len; i++) {
    out[i] = damping * 0.5 * (out[i - n] + out[i - n + 1]);
  }
  // Short fade-out at the end to avoid clicks.
  const fade = Math.min(len, Math.floor(sr * 0.02));
  for (let i = 0; i < fade; i++) {
    out[len - 1 - i] *= i / fade;
  }
  return buf;
}

/**
 * Play a plucked note. Returns a handle with stop(whenSeconds).
 * `time` is an AudioContext time in the future (scheduled), never "now" from a
 * timer callback.
 */
export function playNote(ctx, freq, time, gain = 0.8, destination = null, options = {}) {
  const duration = options.duration ?? 2;
  const buf = karplusStrongBuffer(ctx, freq, duration, options);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(destination || ctx.destination);
  src.start(time);
  return {
    stop(when = ctx.currentTime) {
      try {
        g.gain.setTargetAtTime(0, when, 0.01);
        src.stop(when + 0.1);
      } catch { /* already stopped */ }
    },
    source: src,
  };
}

/** Sine reference tone with a soft envelope (tuner tests, reference pitches). */
export function playSine(ctx, freq, time, duration = 1, gain = 0.3, destination = null) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.01);
  g.gain.setValueAtTime(gain, time + duration - 0.05);
  g.gain.linearRampToValueAtTime(0, time + duration);
  osc.connect(g).connect(destination || ctx.destination);
  osc.start(time);
  osc.stop(time + duration + 0.05);
  return { stop: () => { try { osc.stop(); } catch { /* already stopped */ } } };
}
