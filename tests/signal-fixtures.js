/**
 * Shared synthetic-signal helpers for audio tests.
 * Pure functions, no DOM / Web Audio. Deterministic (seeded noise).
 */

/** Deterministic uniform noise in [-1, 1). */
export function seededRandom(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Pure sine wave of `durationSec` seconds, starting at phase 0. */
export function makeSine({ sampleRate, frequency, durationSec, amp = 0.8 }) {
  const n = Math.round(sampleRate * durationSec);
  const out = new Float32Array(n);
  const w = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(w * i);
  return out;
}

/**
 * Silence with short noise-burst clicks at the given times (seconds).
 * Each click is a Hann-bumped burst of deterministic noise.
 */
export function makeClickBursts({
  sampleRate,
  durationSec,
  times,
  clickMs = 2,
  amps = null,
  amp = 0.8,
  seed = 42,
}) {
  const n = Math.round(sampleRate * durationSec);
  const out = new Float32Array(n);
  const rnd = seededRandom(seed);
  const clickLen = Math.max(2, Math.round((sampleRate * clickMs) / 1000));
  times.forEach((t, idx) => {
    const a = amps ? amps[idx] : amp;
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < clickLen && start + i < n; i++) {
      const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / clickLen); // Hann bump
      out[start + i] += a * env * rnd();
    }
  });
  return out;
}

/**
 * Plucked-string-like signal: harmonic stack with exponential decay starting
 * at each time in `times`. Optional "ringing" harmonics with a much slower
 * decay simulate a sustained/ringing banjo tail.
 *
 * @param {object} opts
 * @param {number} opts.sampleRate
 * @param {number} opts.durationSec total length
 * @param {number[]} opts.times onset times (seconds)
 * @param {number} opts.frequency fundamental (Hz)
 * @param {number[]} [opts.harmonics] relative amplitudes, index 0 = fundamental
 * @param {number} [opts.decaySec=0.25] exponential decay time constant
 * @param {number[]} [opts.ringHarmonics] relative amplitudes of ringing partials
 * @param {number} [opts.ringDecaySec=1.5] decay time constant for ringing partials
 * @param {number|number[]} [opts.amp=0.8] overall amplitude per pluck
 */
export function makePlucks({
  sampleRate,
  durationSec,
  times,
  frequency,
  harmonics = [1, 0.55, 0.35, 0.2],
  decaySec = 0.25,
  ringHarmonics = [],
  ringDecaySec = 1.5,
  amp = 0.8,
}) {
  const n = Math.round(sampleRate * durationSec);
  const out = new Float32Array(n);
  times.forEach((t, idx) => {
    const a = Array.isArray(amp) ? amp[idx] : amp;
    const start = Math.round(t * sampleRate);
    for (let i = start; i < n; i++) {
      const tt = (i - start) / sampleRate;
      let s = 0;
      for (let k = 0; k < harmonics.length; k++) {
        s += harmonics[k] * Math.sin(2 * Math.PI * frequency * (k + 1) * tt) * Math.exp(-tt / decaySec);
      }
      for (let k = 0; k < ringHarmonics.length; k++) {
        s += ringHarmonics[k] * Math.sin(2 * Math.PI * frequency * (k + 1) * tt) * Math.exp(-tt / ringDecaySec);
      }
      out[i] += a * s;
    }
  });
  return out;
}

/** Distance between two frequencies in cents (absolute value). */
export function centsError(detected, expected) {
  return Math.abs(1200 * Math.log2(detected / expected));
}
