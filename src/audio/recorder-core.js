// Pure recorder session logic: message handling, chunk assembly with gap
// detection, and audio-clock time-base conversion. No DOM, no Web Audio —
// Node-testable with a fake port (see tests/recorder-core.test.mjs).

/** Audio-clock time (seconds) of a worklet frame. */
export function frameToCtxTime(frame, sampleRate) {
  return frame / sampleRate;
}

/** Convert audio-clock times to the recording's time base (origin = 0). */
export function toRecordingBase(times, originSec) {
  return (Array.isArray(times) ? times : []).map((t) => t - originSec);
}

/**
 * Slice a continuous recording to a [fromCtxSec, toCtxSec) window on the audio
 * clock, using the measured recording origin. Returns the slice and its
 * offset within the recording (seconds from the origin).
 */
export function sliceSamples(samples, sampleRate, originSec, fromCtxSec, toCtxSec) {
  const start = Math.max(0, Math.round((fromCtxSec - originSec) * sampleRate));
  const end = Math.min(samples.length, Math.round((toCtxSec - originSec) * sampleRate));
  return {
    samples: samples.slice(start, Math.max(start, end)),
    offsetSec: fromCtxSec - originSec,
  };
}

/** Entries whose time falls in [fromCtxSec, toCtxSec) — e.g. the scheduled
 * note events of one loop of a continuously recorded practice session. */
export function entriesInRange(entries, fromCtxSec, toCtxSec, timeOf = (e) => e.time) {
  return (Array.isArray(entries) ? entries : []).filter((e) => {
    const t = timeOf(e);
    return t >= fromCtxSec - 1e-9 && t < toCtxSec - 1e-9;
  });
}

/**
 * When a recording may stop so the last scheduled event actually rings and is
 * detectable: tailSec after the last event's scheduled time (default 0.5 s).
 */
export function stopTimeAfter(lastEventTime, tailSec = 0.5) {
  return lastEventTime + tailSec;
}

/** Poll-friendly check: has the audio clock passed the safe stop time? */
export function shouldStopNow(nowSec, lastEventTime, tailSec = 0.5) {
  return nowSec >= stopTimeAfter(lastEventTime, tailSec);
}

/**
 * Collects worklet messages and assembles the PCM buffer.
 * @param {{ sampleRate: number, maxSamples?: number }} opts
 *   maxSamples caps memory for long continuous recordings (oldest chunks are
 *   evicted; assemble() then starts at the first retained chunk).
 */
export function createRecorderSession({ sampleRate, maxSamples = Infinity } = {}) {
  let startedFrame = null;
  let stopped = false;
  let chunks = []; // { frame, samples: Float32Array }
  let totalSamples = 0;

  function evict() {
    while (totalSamples > maxSamples && chunks.length > 1) {
      const old = chunks.shift();
      totalSamples -= old.samples.length;
    }
  }

  return {
    /** Handle one worklet message; returns a description of what happened. */
    handleMessage(data) {
      if (!data || typeof data !== 'object') return { event: 'ignored' };
      if (data.type === 'started') {
        if (startedFrame == null) startedFrame = data.frame;
        return { event: 'started', ctxTime: frameToCtxTime(data.frame, data.sampleRate ?? sampleRate) };
      }
      if (data.type === 'chunk') {
        chunks.push({ frame: data.frame, samples: data.samples });
        totalSamples += data.samples.length;
        evict();
        return { event: 'chunk' };
      }
      if (data.type === 'stopped') {
        stopped = true;
        return { event: 'stopped' };
      }
      return { event: 'ignored' };
    },

    get startedFrame() { return startedFrame; },
    get startedAtCtxTime() {
      return startedFrame == null ? null : frameToCtxTime(startedFrame, sampleRate);
    },
    isStopped: () => stopped,
    chunkCount: () => chunks.length,

    /**
     * Assemble received chunks into one buffer, placed by frame so a dropped
     * chunk shows up as a gap (zero-filled) instead of shifting later audio.
     * Returns { samples, startFrame, gaps } where gaps lists dropped spans.
     */
    assemble() {
      const sorted = [...chunks].sort((a, b) => a.frame - b.frame);
      const spanStart = startedFrame != null ? startedFrame : (sorted[0] ? sorted[0].frame : 0);
      let spanEnd = spanStart;
      for (const c of sorted) spanEnd = Math.max(spanEnd, c.frame + c.samples.length);
      const samples = new Float32Array(Math.max(0, spanEnd - spanStart));

      const gaps = [];
      let expected = null;
      for (const c of sorted) {
        if (expected != null && c.frame > expected) {
          gaps.push({ atFrame: expected, missingFrames: c.frame - expected });
        }
        samples.set(c.samples, c.frame - spanStart);
        expected = c.frame + c.samples.length;
      }
      return { samples, startFrame: spanStart, gaps };
    },
  };
}
