/**
 * Pitch detection with the YIN algorithm (difference function +
 * cumulative-mean normalization + absolute threshold + parabolic
 * interpolation of the period estimate).
 *
 * Pure logic: no DOM, no Web Audio API. Runs unchanged in Node and browsers.
 * Tuned for the banjo range (~140 Hz to ~700 Hz) but configurable.
 */

const DEFAULT_MIN_FREQUENCY = 100; // Hz, safely below the banjo low D (~147 Hz)
const DEFAULT_MAX_FREQUENCY = 900; // Hz, safely above the banjo high range
const MAX_ANALYSIS_SAMPLES = 4096; // cap on the integration window (cost)
const SILENCE_RMS = 1e-5;

/**
 * Detect the fundamental frequency of a mono signal using YIN.
 *
 * The first `min(samples.length, MAX_ANALYSIS_SAMPLES + tauMax)` samples are
 * analysed as a single frame, so buffers longer than that are truncated.
 *
 * @param {Float32Array} samples mono time-domain samples
 * @param {number} sampleRate in Hz
 * @param {object} [options]
 * @param {number} [options.yinThreshold=0.15] absolute threshold on the
 *        cumulative-mean-normalized difference function (0 < t < 1)
 * @param {number} [options.minFrequency=100] lowest searchable fundamental (Hz)
 * @param {number} [options.maxFrequency=900] highest searchable fundamental (Hz)
 * @returns {{ frequency: number|null, probability: number }}
 *   `frequency` is null when no pitch is found; `probability` is a 0..1
 *   confidence estimate (1 - normalized difference at the chosen period).
 */
export function detectPitchYIN(samples, sampleRate, options = {}) {
  const yinThreshold = options.yinThreshold ?? 0.15;
  const minFrequency = options.minFrequency ?? DEFAULT_MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? DEFAULT_MAX_FREQUENCY;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('detectPitchYIN: sampleRate must be a positive number');
  }
  if (!Number.isFinite(yinThreshold) || yinThreshold <= 0 || yinThreshold >= 1) {
    throw new RangeError('detectPitchYIN: yinThreshold must be in (0, 1)');
  }
  if (!Number.isFinite(minFrequency) || !Number.isFinite(maxFrequency) ||
      minFrequency <= 0 || maxFrequency <= minFrequency) {
    throw new RangeError('detectPitchYIN: invalid frequency range');
  }
  if (!samples || typeof samples.length !== 'number') {
    return { frequency: null, probability: 0 };
  }

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const tauMax = Math.ceil(sampleRate / minFrequency);
  const w = Math.min(samples.length - tauMax, MAX_ANALYSIS_SAMPLES); // integration window
  if (!Number.isFinite(w) || w < tauMin * 2) {
    return { frequency: null, probability: 0 };
  }

  // Silence / near-silence guard.
  let energy = 0;
  for (let i = 0; i < w; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / w) < SILENCE_RMS) {
    return { frequency: null, probability: 0 };
  }

  // --- Difference function d(tau) ----------------------------------------
  const d = new Float64Array(tauMax + 1);
  for (let tau = 0; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const diff = samples[j] - samples[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // --- Cumulative mean normalized difference d'(tau) ----------------------
  const dp = new Float64Array(tauMax + 1);
  dp[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    dp[tau] = runningSum === 0 ? 1 : (d[tau] * tau) / runningSum;
  }

  // --- Absolute threshold: first dip below yinThreshold -------------------
  let tauEstimate = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dp[tau] < yinThreshold) {
      // Descend to the local minimum of the dip.
      while (tau + 1 <= tauMax && dp[tau + 1] < dp[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) {
    return { frequency: null, probability: 0 };
  }

  // --- Parabolic interpolation of the minimum ----------------------------
  let betterTau = tauEstimate;
  if (tauEstimate > 0 && tauEstimate < tauMax) {
    const s0 = dp[tauEstimate - 1];
    const s1 = dp[tauEstimate];
    const s2 = dp[tauEstimate + 1];
    const denom = s0 - 2 * s1 + s2;
    if (denom !== 0) {
      const delta = (0.5 * (s0 - s2)) / denom;
      if (Number.isFinite(delta) && Math.abs(delta) < 1) {
        betterTau = tauEstimate + delta;
      }
    }
  }

  const frequency = sampleRate / betterTau;
  const probability = Math.min(1, Math.max(0, 1 - dp[tauEstimate]));
  return { frequency, probability };
}
