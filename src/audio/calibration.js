// Calibration: measure system latency (acoustic loopback) and the player's
// habitual play-along offset separately, so timing scores can be corrected for
// the audio path without hiding the player's own lead or lag.
// Pure statistics plus store-key helpers; the Calibrate UI orchestrates the
// click playback and recording.

/**
 * Generic measurement: match detected onsets to scheduled clicks and compute
 * the mean offset and jitter.
 * @param {number[]} clickTimes seconds (AudioContext clock, recording base)
 * @param {number[]} onsetTimes seconds (same time base)
 * @returns {{ offsetMs: number, jitterMs: number, matched: number, pairs: object[] }}
 *   offsetMs: mean(onset - click) in ms (late positive).
 *   jitterMs: standard deviation of the matched offsets (sample sd).
 */
export function computeCalibration(clickTimes, onsetTimes, toleranceMs = 400) {
  const pairs = [];
  const used = new Set();
  for (const ct of clickTimes) {
    let best = -1;
    let bestDt = Infinity;
    onsetTimes.forEach((ot, i) => {
      if (used.has(i)) return;
      const dt = ot - ct;
      if (Math.abs(dt) < Math.abs(bestDt)) { bestDt = dt; best = i; }
    });
    if (best >= 0 && Math.abs(bestDt) * 1000 <= toleranceMs) {
      used.add(best);
      pairs.push({ click: ct, onset: onsetTimes[best], offsetMs: bestDt * 1000 });
    }
  }
  if (pairs.length === 0) {
    return { offsetMs: 0, jitterMs: 0, matched: 0, pairs };
  }
  const offsets = pairs.map((p) => p.offsetMs);
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const variance = offsets.length > 1
    ? offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / (offsets.length - 1)
    : 0;
  return {
    offsetMs: mean,
    jitterMs: Math.sqrt(variance),
    matched: pairs.length,
    pairs,
  };
}

/**
 * Acoustic loopback (fix plan F7, option 2/3): the microphone hears the
 * clicks themselves (speakers, or headphones held against the mic). The
 * measured offset is the true system input+output latency, with no playing
 * involved. This is the figure subtracted in scoring.
 */
export function computeSystemCalibration(clickTimes, onsetTimes, toleranceMs = 400) {
  const r = computeCalibration(clickTimes, onsetTimes, toleranceMs);
  return {
    systemOffsetMs: r.offsetMs,
    systemJitterMs: r.jitterMs,
    matched: r.matched,
    pairs: r.pairs,
  };
}

/**
 * Play-along habit (fix plan F7): the user plays along with the clicks; the
 * residual after removing the system latency is the player's own habitual
 * lead (negative) or lag (positive). Reported informationally, never
 * subtracted in scoring.
 */
export function computePlayerHabit(clickTimes, onsetTimes, systemOffsetMs = 0, toleranceMs = 400) {
  const r = computeCalibration(clickTimes, onsetTimes, toleranceMs);
  return {
    playerOffsetMs: r.offsetMs - systemOffsetMs,
    playerJitterMs: r.jitterMs,
    playAlongOffsetMs: r.offsetMs,
    matched: r.matched,
    pairs: r.pairs,
  };
}

/** Stable store id for a device pair (input + output). */
export function calibrationKey(inputId, outputId) {
  return `cal:${inputId || 'default'}|${outputId || 'default'}`;
}

/**
 * Human-readable warning when jitter is too high (build plan C5: ~10 ms).
 * `measurement` names which figure the warning refers to (system or player).
 */
export function jitterWarning(jitterMs, thresholdMs = 10, measurement = 'this measurement') {
  if (jitterMs <= thresholdMs) return null;
  return `Timing jitter in ${measurement} is ${Math.round(jitterMs)} ms, above ${thresholdMs} ms. ` +
    'Wired headphones and a quieter machine usually help.';
}

/** Offset subtracted in scoring: the system latency only. */
export function scoringOffsetMs(calibration) {
  if (!calibration) return 0;
  return calibration.systemOffsetMs ?? calibration.offsetMs ?? 0;
}
