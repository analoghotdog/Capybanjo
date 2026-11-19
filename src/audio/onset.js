/**
 * Onset detection via spectral flux (build plan C5).
 *
 * Pure logic: no DOM, no Web Audio API. Runs unchanged in Node and browsers.
 *
 * Algorithm:
 *  1. Slice the signal into overlapping frames (Hann window), compute a small
 *     radix-2 FFT per frame and the magnitude spectrum.
 *  2. Spectral flux per frame: sum of positive bin-to-bin magnitude differences.
 *  3. Crude high-pass: ignore very low frequency bins (below ~80 Hz).
 *     Magnitudes are also smoothed across neighbouring bins so spectral
 *     leakage (energy sloshing between bins as the window slides) does not
 *     create flux ripple in decaying/ringing tails.
 *  4. Adaptive threshold: running mean of the flux over a sliding window,
 *     multiplied by `sensitivity` (higher multiplier -> higher threshold ->
 *     fewer onsets). The threshold has a floor at the global mean flux so
 *     that tiny ripple in decayed tails cannot self-trigger in near-silence.
 *  5. Peak-pick local flux maxima above the threshold, enforce a minimum
 *     inter-onset interval, then refine each onset to sample accuracy by
 *     locating the sharpest rise in the local amplitude envelope.
 */

const HIGH_PASS_HZ = 80; // bins below this are ignored (crude high-pass)
const MAG_SMOOTH_BINS = 2; // +-bins of magnitude smoothing (anti-leakage)
const THRESHOLD_WINDOW_FRAMES = 16; // half-width of the sliding-mean window
const ENVELOPE_WINDOW = 128; // samples, peak-hold window for onset-time refinement

/**
 * In-place iterative radix-2 FFT.
 * @param {Float32Array} re real part (length must be a power of two)
 * @param {Float32Array} im imaginary part (same length)
 */
export function fft(re, im) {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0 || n < 2) {
    throw new RangeError('fft: length must be a power of two >= 2');
  }
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Cooley-Tukey butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const xRe = re[i + k + half];
        const xIm = im[i + k + half];
        const vRe = xRe * curRe - xIm * curIm;
        const vIm = xRe * curIm + xIm * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}

/**
 * Refine an onset frame to sample accuracy: find the sharpest rise of a causal
 * peak-hold envelope of |x| inside the search region. The peak-hold envelope
 * (max of |x| over the trailing `ENVELOPE_WINDOW` samples) is monotone on
 * decaying tails, so ringing ripple cannot beat the real attack, while a new
 * attack causes an immediate step up. The region is clamped to the midpoints
 * between neighbouring candidate frames so a nearby (weaker) attack is not
 * stolen by a larger neighbour.
 */
function refineOnsetSample(samples, frameIdx, hopSize, frameSize, candidates) {
  const n = samples.length;
  const center = frameIdx * hopSize + frameSize / 2;
  const half = frameSize / 2;
  let lo = center - half;
  let hi = center + half;
  // Clamp against neighbours' centres.
  for (const other of candidates) {
    if (other === frameIdx) continue;
    const otherCenter = other * hopSize + frameSize / 2;
    const mid = (center + otherCenter) / 2;
    if (otherCenter < center) lo = Math.max(lo, mid);
    else hi = Math.min(hi, mid);
  }
  let start = Math.max(0, Math.floor(lo));
  let end = Math.min(n, Math.ceil(hi));
  if (end - start < 4) return Math.max(0, Math.min(n - 1, center));

  const w = Math.min(ENVELOPE_WINDOW, Math.floor((end - start) / 2));
  // Causal peak-hold envelope: env[i] = max |x| over the trailing w samples.
  // Only indices with a full trailing window are evaluated (no warm-up
  // artifacts); the first valid index is start + w.
  const envLen = end - start;
  const env = new Float64Array(envLen);
  for (let i = w; i < envLen; i++) {
    let m = 0;
    for (let j = i - w + 1; j <= i; j++) {
      const a = Math.abs(samples[start + j]);
      if (a > m) m = a;
    }
    env[i] = m;
  }
  // Sharpest step up = attack (peak-hold steps at the first large |x|).
  let bestIdx = w + 1;
  let bestDiff = -Infinity;
  for (let i = w + 1; i < envLen; i++) {
    const d = env[i] - env[i - 1];
    if (d > bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  return Math.min(n - 1, start + bestIdx);
}

/**
 * Detect onsets in a mono signal.
 *
 * @param {Float32Array} samples mono time-domain samples
 * @param {number} sampleRate in Hz
 * @param {object} [options]
 * @param {number} [options.sensitivity=1.5] threshold multiplier; higher = fewer onsets
 * @param {number} [options.minIntervalMs=60] minimum inter-onset interval
 * @param {number} [options.frameSize=1024] FFT frame size (power of two)
 * @param {number} [options.hopSize=256] hop between frames
 * @returns {number[]} ascending onset times in seconds
 */
export function detectOnsets(samples, sampleRate, options = {}) {
  const sensitivity = options.sensitivity ?? 1.5;
  const minIntervalMs = options.minIntervalMs ?? 60;
  const frameSize = options.frameSize ?? 1024;
  const hopSize = options.hopSize ?? 256;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('detectOnsets: sampleRate must be a positive number');
  }
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) {
    throw new RangeError('detectOnsets: sensitivity must be a positive number');
  }
  if (!Number.isFinite(frameSize) || frameSize < 2 || (frameSize & (frameSize - 1)) !== 0) {
    throw new RangeError('detectOnsets: frameSize must be a power of two >= 2');
  }
  if (!Number.isFinite(hopSize) || hopSize <= 0) {
    throw new RangeError('detectOnsets: hopSize must be a positive number');
  }
  if (!samples || typeof samples.length !== 'number' || samples.length < frameSize) {
    return [];
  }

  const half = frameSize >> 1;
  const minBin = Math.max(1, Math.ceil((HIGH_PASS_HZ * frameSize) / sampleRate));
  const numFrames = 1 + Math.floor((samples.length - frameSize) / hopSize);

  // --- Spectral flux per frame -------------------------------------------
  const flux = new Float64Array(numFrames);
  const window = hannWindow(frameSize);
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  const magBuf = new Float64Array(half + 1);
  const prevMag = new Float64Array(half + 1);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    for (let i = 0; i < frameSize; i++) {
      re[i] = samples[offset + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    // Magnitude spectrum, smoothed across neighbouring bins to suppress
    // spectral-leakage ripple.
    for (let k = 0; k <= half; k++) magBuf[k] = Math.hypot(re[k], im[k]);
    for (let k = minBin; k <= half; k++) {
      let sum = 0;
      let count = 0;
      for (let j = -MAG_SMOOTH_BINS; j <= MAG_SMOOTH_BINS; j++) {
        const kk = k + j;
        if (kk >= minBin && kk <= half) {
          sum += magBuf[kk];
          count++;
        }
      }
      const mag = sum / count;
      const diff = mag - prevMag[k];
      if (diff > 0) flux[f] += diff;
      prevMag[k] = mag;
    }
  }

  // Global mean flux: floor for the adaptive threshold. Without it, tiny
  // ripple in decayed tails would exceed any purely relative threshold in
  // near-silence and self-trigger.
  let globalMean = 0;
  for (let i = 0; i < numFrames; i++) globalMean += flux[i];
  globalMean /= numFrames;

  // --- Adaptive threshold + peak picking ---------------------------------
  const threshold = new Float64Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const lo = Math.max(0, i - THRESHOLD_WINDOW_FRAMES);
    const hi = Math.min(numFrames - 1, i + THRESHOLD_WINDOW_FRAMES);
    let mean = 0;
    for (let j = lo; j <= hi; j++) mean += flux[j];
    mean /= hi - lo + 1;
    threshold[i] = Math.max(mean, globalMean) * sensitivity;
  }

  const candidates = [];
  for (let i = 0; i < numFrames; i++) {
    const prev = i > 0 ? flux[i - 1] : -Infinity;
    const next = i < numFrames - 1 ? flux[i + 1] : -Infinity;
    if (flux[i] > threshold[i] && flux[i] >= prev && flux[i] > next) {
      candidates.push(i);
    }
  }

  // --- Minimum inter-onset interval (greedy, first-come wins) -------------
  const minInterval = (minIntervalMs * sampleRate) / 1000; // in samples
  const kept = [];
  for (const idx of candidates) {
    const sample = idx * hopSize + frameSize / 2;
    const lastSample = kept.length === 0
      ? -Infinity
      : kept[kept.length - 1] * hopSize + frameSize / 2;
    if (sample - lastSample >= minInterval) {
      kept.push(idx);
    }
  }

  // --- Sample-accurate refinement ----------------------------------------
  const times = [];
  for (const idx of kept) {
    const sample = refineOnsetSample(samples, idx, hopSize, frameSize, kept);
    times.push(sample / sampleRate);
  }

  // Guarantee ascending, unique-ish output.
  times.sort((a, b) => a - b);
  return times;
}
