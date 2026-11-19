// Speed trainer state machine (pure logic: no DOM, no Web Audio; standard ES
// module so it runs unchanged in Node tests and in the browser).
//
// Counting rule (exact):
// - cleanCount is the number of consecutive pass() calls at the current bpm.
//   It resets to 0 on any fail() and whenever the counters are reset (a bpm
//   change via step-up or acceptDrop, or an explicit declineDrop/reset).
// - attemptsAtBpm is the number of fail() calls at the current bpm since the
//   last counter reset. pass() does NOT increment it; only fail() does. When
//   attemptsAtBpm reaches maxAttempts the trainer enters phase 'offerDrop'.
// - When cleanCount reaches requiredClean the current bpm is counted as
//   cleanly passed: bestBpm is raised to the current bpm (never lowered),
//   both counters reset, and bpm steps up by `step`, capped at targetBpm (so
//   the ladder always lands exactly on the target). If the bpm that was just
//   completed cleanly is >= targetBpm the run is finished: phase 'done' and
//   bpm stays at targetBpm.
// - acceptDrop() lowers bpm by `step` but never below minBpm (default =
//   startBpm) and resets both counters. declineDrop() keeps the bpm and
//   resets both counters. Both return to phase 'running'.
// - stop() ends the run (phase 'done') without raising bestBpm.

/**
 * Create a speed trainer.
 * @param {{ startBpm: number, targetBpm: number, step?: number,
 *           requiredClean?: number, maxAttempts?: number, minBpm?: number|null }} config
 * @returns {{ getState(): object, pass(): object, fail(): object,
 *             acceptDrop(): object, declineDrop(): object, reset(): object,
 *             stop(): object }}
 */
export function createSpeedTrainer(config = {}) {
  const { startBpm, targetBpm, step = 5, requiredClean = 2, maxAttempts = 4 } = config;
  const minBpm = config.minBpm == null ? startBpm : config.minBpm;

  if (!Number.isFinite(startBpm)) throw new TypeError('startBpm must be a finite number');
  if (!Number.isFinite(targetBpm)) throw new TypeError('targetBpm must be a finite number');
  if (!Number.isFinite(minBpm)) throw new TypeError('minBpm must be a finite number');
  if (!(step > 0)) throw new TypeError('step must be > 0');
  if (!(requiredClean >= 1)) throw new TypeError('requiredClean must be >= 1');
  if (!(maxAttempts >= 1)) throw new TypeError('maxAttempts must be >= 1');

  const initialState = () => ({
    bpm: startBpm,
    cleanCount: 0,
    attemptsAtBpm: 0,
    phase: 'idle',
    bestBpm: startBpm,
    lastEvent: null,
  });

  let s = initialState();

  const getState = () => ({ ...s });

  // pass/fail are accepted while idle (which transitions to running) and while
  // running; they are ignored in 'offerDrop' and 'done'.
  const inPlay = () => s.phase === 'idle' || s.phase === 'running';

  function pass() {
    if (!inPlay()) return getState();
    s.phase = 'running';
    s.cleanCount += 1;
    s.lastEvent = 'pass';
    if (s.cleanCount >= requiredClean) {
      if (s.bpm > s.bestBpm) s.bestBpm = s.bpm;
      s.cleanCount = 0;
      s.attemptsAtBpm = 0;
      if (s.bpm >= targetBpm) {
        s.bpm = targetBpm;
        s.phase = 'done';
        s.lastEvent = 'complete';
      } else {
        s.bpm = Math.min(s.bpm + step, targetBpm);
        s.lastEvent = 'step-up';
      }
    }
    return getState();
  }

  function fail() {
    if (!inPlay()) return getState();
    s.phase = 'running';
    s.cleanCount = 0;
    s.attemptsAtBpm += 1;
    s.lastEvent = 'fail';
    if (s.attemptsAtBpm >= maxAttempts) {
      s.phase = 'offerDrop';
      s.lastEvent = 'offer-drop';
    }
    return getState();
  }

  function acceptDrop() {
    if (s.phase !== 'offerDrop') return getState();
    s.bpm = Math.max(minBpm, s.bpm - step);
    s.cleanCount = 0;
    s.attemptsAtBpm = 0;
    s.phase = 'running';
    s.lastEvent = 'drop';
    return getState();
  }

  function declineDrop() {
    if (s.phase !== 'offerDrop') return getState();
    s.cleanCount = 0;
    s.attemptsAtBpm = 0;
    s.phase = 'running';
    s.lastEvent = 'decline';
    return getState();
  }

  function reset() {
    s = initialState();
    return getState();
  }

  function stop() {
    s.phase = 'done';
    s.lastEvent = 'stop';
    return getState();
  }

  return { getState, pass, fail, acceptDrop, declineDrop, reset, stop };
}
