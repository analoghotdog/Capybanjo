// Metronome engine on top of the shared scheduler. Clicks are short oscillator
// bursts with an envelope; beat one has a different (higher) pitch. Supports
// subdivisions with quieter clicks and a count-in. See build plan Steps 4-7.

const PITCH_ACCENT = 1567.98; // G6
const PITCH_BEAT = 1046.5; // C6
const PITCH_SUB = 783.99; // G5

/**
 * @param {{ scheduler, getCtx, output?, onBeat? }} opts
 *   scheduler: shared scheduler (src/audio/scheduler.js)
 *   getCtx: () => AudioContext
 *   output: optional destination node (defaults to ctx.destination)
 *   onBeat(time, info): called for every scheduled tick (for visual beat UI)
 */
export function createMetronome({ scheduler, getCtx, output = null, onBeat = null }) {
  let armed = false;
  let volume = 0.7;
  let muted = false;
  let countInBars = 0;
  let tickUnsub = null;

  function level(info) {
    if (muted) return 0;
    if (info.subIndex !== 0) return volume * 0.35;
    return info.isDownbeat ? volume : volume * 0.8;
  }

  function pitch(info) {
    if (info.subIndex !== 0) return PITCH_SUB;
    return info.isDownbeat ? PITCH_ACCENT : PITCH_BEAT;
  }

  function scheduleClick(time, info, gainScale = 1) {
    const ctx = getCtx();
    const g0 = level(info) * gainScale;
    const osc = ctx.createOscillator();
    osc.frequency.value = pitch(info);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(g0, time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(g).connect(output || ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function handleTick(time, info) {
    if (!armed) return;
    const ticksPerBar = info.beatsPerBar * info.subdivision;
    const inCountIn = countInBars > 0 && info.tick < countInBars * ticksPerBar;
    scheduleClick(time, info, inCountIn ? 1.05 : 1);
    if (onBeat) onBeat(time, { ...info, countIn: inCountIn });
  }

  return {
    /** Begin clicking. Count-in bars play before "go" and are flagged in onBeat. */
    arm({ countInBars: ci = 0 } = {}) {
      countInBars = ci;
      if (!tickUnsub) tickUnsub = scheduler.subscribe(handleTick);
      armed = true;
    },
    disarm() {
      armed = false;
      countInBars = 0;
      if (tickUnsub) { tickUnsub(); tickUnsub = null; }
    },
    isArmed: () => armed,
    setVolume(v) { volume = Math.min(1, Math.max(0, v)); },
    getVolume: () => volume,
    setMuted(m) { muted = !!m; },
    isMuted: () => muted,
    setOnBeat(fn) { onBeat = fn; },
    countInBarsRemaining(info) {
      const ticksPerBar = info.beatsPerBar * info.subdivision;
      return Math.max(0, Math.ceil((countInBars * ticksPerBar - info.tick) / ticksPerBar));
    },
  };
}
