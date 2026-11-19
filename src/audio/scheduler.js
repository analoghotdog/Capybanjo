// Lookahead scheduler (pure logic: injectable clock, no DOM, no Web Audio).
// See build plan C2. A pump() call schedules every tick falling inside the next
// `lookahead` seconds; listeners receive (time, tickInfo) and must only use the
// given `time` to program audio — never "now" from a timer callback.

export function createScheduler(options = {}) {
  const clock = options.clock;
  if (!clock || typeof clock.now !== 'function') {
    throw new Error('createScheduler requires a clock with now()');
  }
  const lookahead = options.lookahead ?? 0.1;
  const intervalMs = options.intervalMs ?? 25;
  const useTimer = options.useTimer !== false;
  const startDelay = options.startDelay ?? 0.06;

  let running = false;
  let timer = null;
  let nextTime = 0;
  let tick = 0;
  let bpm = options.bpm ?? 100;
  let subdivision = options.subdivision ?? 1;
  let beatsPerBar = options.beatsPerBar ?? 4;
  let beatValue = options.beatValue ?? 4;
  let pending = null; // { bpm?, subdivision? } applied at the next beat boundary
  const listeners = new Set();
  if (typeof options.onSchedule === 'function') listeners.add(options.onSchedule);

  function tickDuration() {
    return 60 / bpm / subdivision;
  }

  function emit(time) {
    const beat = Math.floor(tick / subdivision);
    const subIndex = tick % subdivision;
    const beatInBar = (beat % beatsPerBar) + 1;
    const info = {
      time,
      tick,
      beat,
      beatInBar,
      bar: Math.floor(beat / beatsPerBar),
      subIndex,
      subdivision,
      isBeat: subIndex === 0,
      isDownbeat: subIndex === 0 && beatInBar === 1,
      bpm,
      beatsPerBar,
      beatValue,
    };
    for (const fn of listeners) fn(time, info);
  }

  function pump() {
    if (!running) return;
    const horizon = clock.now() + lookahead;
    while (nextTime < horizon) {
      emit(nextTime);
      const atBeatEnd = (tick + 1) % subdivision === 0;
      if (atBeatEnd && pending) {
        if (pending.bpm != null) bpm = pending.bpm;
        if (pending.subdivision != null) subdivision = pending.subdivision;
        pending = null;
      }
      nextTime += tickDuration();
      tick += 1;
    }
  }

  function start() {
    if (running) return;
    running = true;
    tick = 0;
    pending = null;
    nextTime = clock.now() + startDelay;
    pump();
    if (useTimer) timer = setInterval(pump, intervalMs);
  }

  function stop() {
    running = false;
    if (timer != null) { clearInterval(timer); timer = null; }
  }

  /** Tempo change takes effect on the next beat. */
  function setBpm(next) {
    if (!(next > 0)) throw new Error('bpm must be > 0');
    if (!running || tick % subdivision === 0) {
      bpm = next;
      return;
    }
    pending = { ...(pending || {}), bpm: next };
  }

  /** Subdivision change takes effect on the next beat. */
  function setSubdivision(next) {
    if (!Number.isInteger(next) || next < 1) throw new Error('subdivision must be an integer >= 1');
    if (!running || tick % subdivision === 0) {
      subdivision = next;
      return;
    }
    pending = { ...(pending || {}), subdivision: next };
  }

  function setMeter({ beatsPerBar: bpb, beatValue: bv } = {}) {
    if (bpb != null) beatsPerBar = bpb;
    if (bv != null) beatValue = bv;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getState() {
    return { running, bpm, subdivision, beatsPerBar, beatValue, tick, nextTime };
  }

  return { start, stop, pump, subscribe, setBpm, setSubdivision, setMeter, getState, tickDuration };
}
