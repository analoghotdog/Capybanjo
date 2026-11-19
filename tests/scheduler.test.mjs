import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/audio/scheduler.js';

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (dt) => { t += dt; }, set: (v) => { t = v; } };
}

test('schedules each event once, in order, inside the lookahead window', () => {
  const clock = fakeClock();
  const events = [];
  const s = createScheduler({
    clock, bpm: 120, subdivision: 1, lookahead: 0.1, startDelay: 0, useTimer: false,
    onSchedule: (time, info) => events.push({ time, info }),
  });
  s.start();
  s.pump();
  const first = events.map((e) => e.time);
  assert.ok(first.length >= 1);
  for (const t of first) assert.ok(t >= 0 && t < 0.1, `time ${t} outside window`);
  // pumping again without advancing the clock must not duplicate events
  s.pump();
  assert.equal(events.length, first.length);
  // advancing produces only new events, still in order
  clock.advance(0.3);
  s.pump();
  const times = events.map((e) => e.time);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], 'times must strictly increase');
  const seen = new Set(times);
  assert.equal(seen.size, times.length, 'no duplicate event times');
  for (const t of times.slice(first.length)) assert.ok(t >= 0.3 && t < 0.4);
});

test('tick info describes beats, bars and downbeats', () => {
  const clock = fakeClock();
  const events = [];
  const s = createScheduler({
    clock, bpm: 600, subdivision: 2, beatsPerBar: 4, lookahead: 10, startDelay: 0, useTimer: false,
    onSchedule: (time, info) => events.push(info),
  });
  s.start();
  s.pump();
  assert.equal(events[0].beat, 0);
  assert.equal(events[0].beatInBar, 1);
  assert.equal(events[0].isDownbeat, true);
  assert.equal(events[0].isBeat, true);
  assert.equal(events[1].isBeat, false, 'subdivision tick is not a beat');
  assert.equal(events[1].subIndex, 1);
  assert.equal(events[2].beat, 1);
  assert.equal(events[2].beatInBar, 2);
  assert.equal(events[2].isDownbeat, false);
});

test('tempo changes take effect on the next beat, not immediately', () => {
  const clock = fakeClock();
  const events = [];
  const s = createScheduler({
    clock, bpm: 120, subdivision: 1, lookahead: 0.05, startDelay: 0, useTimer: false,
    onSchedule: (time) => events.push(time),
  });
  s.start();
  s.pump(); // tick at 0
  clock.advance(0.6);
  s.pump(); // tick at 0.5 (still 120 bpm)
  assert.equal(events[1], 0.5);
  s.setBpm(60); // mid-beat (next beat would be at 1.0)
  clock.advance(0.55);
  s.pump(); // tick at 1.0 completes the old-tempo beat
  assert.equal(events[2], 1.0);
  clock.advance(1.1);
  s.pump(); // first new-tempo beat at 2.0
  assert.equal(events[3], 2.0);
  clock.advance(1.1);
  s.pump();
  assert.equal(events[4], 3.0);
});

test('stop halts scheduling', () => {
  const clock = fakeClock();
  const events = [];
  const s = createScheduler({
    clock, bpm: 120, lookahead: 0.1, startDelay: 0, useTimer: false,
    onSchedule: (time) => events.push(time),
  });
  s.start();
  s.pump();
  const n = events.length;
  s.stop();
  clock.advance(5);
  s.pump();
  assert.equal(events.length, n);
});

test('subscribe and unsubscribe listeners', () => {
  const clock = fakeClock();
  const got = [];
  const s = createScheduler({ clock, bpm: 600, lookahead: 1, startDelay: 0, useTimer: false });
  const un = s.subscribe((time) => got.push(time));
  s.start();
  s.pump();
  assert.ok(got.length > 0);
  const n = got.length;
  un();
  clock.advance(1);
  s.pump();
  assert.equal(got.length, n);
});
