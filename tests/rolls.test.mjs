import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRolls, validateRolls, expandRoll } from '../src/tab/library.js';
import { validateTab, totalBeats } from '../src/tab/model.js';

test('loader returns four valid exercises', async () => {
  const rolls = await loadRolls();
  assert.equal(rolls.length, 4);
  const v = validateRolls(rolls);
  assert.equal(v.ok, true, v.errors.join('; '));
  for (const tab of rolls) assert.equal(validateTab(tab).ok, true);
});

test('each roll is 4 measures of eighth notes with finger labels', async () => {
  const rolls = await loadRolls();
  for (const tab of rolls) {
    assert.equal(tab.notes.length, 32, `${tab.title}: 8 notes x 4 measures`);
    assert.equal(totalBeats(tab), 16);
    for (const n of tab.notes) {
      assert.equal(n.fret, 0);
      assert.equal(n.durationBeats, 0.5);
      assert.ok(['T', 'I', 'M'].includes(n.finger), `${tab.title}: finger ${n.finger}`);
    }
  }
});

test('expandRoll places pattern notes on the right beats', () => {
  const tab = expandRoll({
    key: 'x', title: 'X', tuning: 'openG', timeSignature: [4, 4], measures: 1,
    pattern: { strings: [3, 2, 1, 5], fingers: ['T', 'I', 'M', 'T'] },
  });
  assert.equal(tab.notes.length, 4);
  assert.deepEqual(tab.notes.map((n) => n.startBeat), [0, 0.5, 1, 1.5]);
  assert.deepEqual(tab.notes.map((n) => n.string), [3, 2, 1, 5]);
});
