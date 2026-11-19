import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeedTrainer } from '../src/features/speed-trainer.js';

test('steps up after requiredClean consecutive passes', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 100, step: 5, requiredClean: 2 });
  assert.equal(t.getState().phase, 'idle');
  assert.equal(t.getState().bpm, 60);

  let s = t.pass();
  assert.equal(s.phase, 'running');
  assert.equal(s.bpm, 60, 'no step-up before requiredClean is reached');
  assert.equal(s.cleanCount, 1);
  assert.equal(s.lastEvent, 'pass');

  s = t.pass();
  assert.equal(s.cleanCount, 0, 'counters reset after a clean pass of the bpm');
  assert.equal(s.attemptsAtBpm, 0);
  assert.equal(s.bpm, 65);
  assert.equal(s.bestBpm, 60);
  assert.equal(s.phase, 'running');
  assert.equal(s.lastEvent, 'step-up');
});

test('clean count resets on fail and counts toward offerDrop', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 100, requiredClean: 2, maxAttempts: 3 });
  t.pass();
  let s = t.fail();
  assert.equal(s.cleanCount, 0, 'fail resets the consecutive clean count');
  assert.equal(s.attemptsAtBpm, 1);
  assert.equal(s.bpm, 60);
  assert.equal(s.phase, 'running');

  t.pass(); // clean streak restarts from 1
  s = t.getState();
  assert.equal(s.cleanCount, 1);
  s = t.pass();
  assert.equal(s.bpm, 65, 'streak rebuilt after the fail and stepped up');
});

test('enters offerDrop once attemptsAtBpm reaches maxAttempts', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 100, maxAttempts: 2 });
  t.fail();
  let s = t.fail();
  assert.equal(s.attemptsAtBpm, 2);
  assert.equal(s.phase, 'offerDrop');
  assert.equal(s.lastEvent, 'offer-drop');
  // further calls are ignored while the drop is on the table
  s = t.fail();
  assert.equal(s.phase, 'offerDrop');
  assert.equal(s.attemptsAtBpm, 2);
});

test('acceptDrop lowers bpm by step, resets counts and resumes', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 100, step: 5, requiredClean: 2, maxAttempts: 2 });
  // climb to 70 cleanly, then fail twice to trigger the drop offer
  t.pass(); t.pass(); // -> 65
  t.pass(); t.pass(); // -> 70
  assert.equal(t.getState().bpm, 70);
  t.fail(); t.fail();
  assert.equal(t.getState().phase, 'offerDrop');

  const s = t.acceptDrop();
  assert.equal(s.bpm, 65);
  assert.equal(s.cleanCount, 0);
  assert.equal(s.attemptsAtBpm, 0);
  assert.equal(s.phase, 'running');
  assert.equal(s.lastEvent, 'drop');
  assert.equal(s.bestBpm, 65, 'bestBpm is the highest bpm completed clean (70 was not)');
});

test('declineDrop keeps bpm, resets counts and resumes', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 100, maxAttempts: 2 });
  t.fail(); t.fail();
  assert.equal(t.getState().phase, 'offerDrop');

  const s = t.declineDrop();
  assert.equal(s.bpm, 60, 'bpm unchanged on decline');
  assert.equal(s.cleanCount, 0);
  assert.equal(s.attemptsAtBpm, 0);
  assert.equal(s.phase, 'running');
  assert.equal(s.lastEvent, 'decline');
});

test('completes at targetBpm after a clean pass there', () => {
  const t = createSpeedTrainer({ startBpm: 95, targetBpm: 100, step: 5, requiredClean: 1 });
  let s = t.pass(); // 95 clean -> step to 100
  assert.equal(s.bpm, 100);
  assert.equal(s.phase, 'running');

  s = t.pass(); // 100 clean -> done
  assert.equal(s.phase, 'done');
  assert.equal(s.bestBpm, 100);
  assert.equal(s.bpm, 100, 'bpm stays at target when done');
  assert.equal(s.lastEvent, 'complete');

  // no further activity once done
  s = t.pass();
  assert.equal(s.phase, 'done');
  assert.equal(s.bestBpm, 100);
});

test('step-up is capped so the ladder lands exactly on targetBpm', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 70, step: 15, requiredClean: 1 });
  const s = t.pass();
  assert.equal(s.bpm, 70, 'capped at target instead of overshooting to 75');
  assert.equal(t.pass().phase, 'done');
});

test('drop honours the minBpm floor', () => {
  const t = createSpeedTrainer({ startBpm: 80, targetBpm: 120, step: 5, requiredClean: 1, maxAttempts: 1, minBpm: 75 });
  t.fail();
  let s = t.acceptDrop();
  assert.equal(s.bpm, 75);
  t.fail();
  s = t.acceptDrop();
  assert.equal(s.bpm, 75, 'never drops below minBpm');
  assert.equal(s.phase, 'running');
});

test('minBpm defaults to startBpm', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 120, step: 5, requiredClean: 1, maxAttempts: 1 });
  t.fail();
  const s = t.acceptDrop();
  assert.equal(s.bpm, 60, 'floor at startBpm when minBpm is not given');
});

test('reset returns to startBpm/idle and stop ends without raising bestBpm', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 100, step: 5, requiredClean: 1 });
  t.pass(); // -> 65, bestBpm 60
  assert.equal(t.getState().bestBpm, 60);

  let s = t.stop();
  assert.equal(s.phase, 'done');
  assert.equal(s.bestBpm, 60, 'stop does not raise bestBpm');
  assert.equal(s.lastEvent, 'stop');

  s = t.reset();
  assert.deepEqual(
    { bpm: s.bpm, cleanCount: s.cleanCount, attemptsAtBpm: s.attemptsAtBpm, phase: s.phase, bestBpm: s.bestBpm, lastEvent: s.lastEvent },
    { bpm: 60, cleanCount: 0, attemptsAtBpm: 0, phase: 'idle', bestBpm: 60, lastEvent: null }
  );
});

test('getState returns a copy, not a live reference', () => {
  const t = createSpeedTrainer({ startBpm: 60, targetBpm: 100 });
  const s = t.getState();
  s.bpm = 999;
  assert.equal(t.getState().bpm, 60);
});
