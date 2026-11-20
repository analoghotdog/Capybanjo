import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../src/audio/player.js';

function fakeContext() {
  return {
    sampleRate: 8000,
    currentTime: 0,
    destination: {},
    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource() {
      return {
        connect(node) { return node; },
        start() {},
        stop() {},
      };
    },
    createGain() {
      return {
        gain: { value: 0, setTargetAtTime() {} },
        connect() { return this; },
      };
    },
  };
}

test('player repeats a four-measure loop beyond its first four bars', () => {
  const listeners = new Set();
  const scheduler = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const player = createPlayer({ scheduler, getCtx: fakeContext });
  const tab = {
    tuning: 'openG',
    timeSignature: [4, 4],
    notes: [0, 4, 8, 12].map((startBeat) => ({
      string: 3,
      fret: 0,
      startBeat,
      durationBeats: 1,
    })),
  };

  player.play(tab, { loop: { startMeasure: 0, endMeasure: 3 } });
  for (let tick = 0; tick <= 32; tick++) {
    for (const listener of listeners) {
      listener(tick, { tick, subdivision: 1, bpm: 60 });
    }
  }

  const queue = player.cursorQueue();
  assert.equal(queue.length, 9);
  assert.equal(queue[4].time, 16);
  assert.equal(queue[4].note.startBeat, 0);
  assert.equal(queue[8].time, 32);
  assert.equal(queue[8].note.startBeat, 0);
  player.stop();
});
