import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteRollDefinition,
  loadRollDefinitions,
  loadRolls,
  resetRollDefinition,
  saveRollDefinition,
  validateRollDefinition,
  validateRolls,
  expandRoll,
} from '../src/tab/library.js';
import { validateTab, totalBeats } from '../src/tab/model.js';

function makeSettings() {
  const values = new Map();
  return {
    async get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async set(key, value) {
      values.set(key, value);
    },
  };
}

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

test('saved roll edits and custom rolls load alongside packaged rolls', async () => {
  const settings = makeSettings();
  const [forward] = await loadRollDefinitions(settings);
  const edited = {
    ...forward,
    title: 'My Forward Roll',
    pattern: {
      strings: [5, ...forward.pattern.strings.slice(1)],
      fingers: [...forward.pattern.fingers],
    },
  };
  await saveRollDefinition(settings, edited);
  await saveRollDefinition(settings, {
    ...forward,
    key: 'custom-test-roll',
    title: 'Custom Test Roll',
  });

  const definitions = await loadRollDefinitions(settings);
  assert.equal(definitions.length, 5);
  assert.equal(definitions[0].title, 'My Forward Roll');
  assert.equal(definitions[0].pattern.strings[0], 5);
  assert.equal(definitions[0].builtIn, true);
  assert.equal(definitions[4].title, 'Custom Test Roll');
  assert.equal(definitions[4].builtIn, false);
  assert.equal((await loadRolls(settings)).length, 5);
});

test('custom rolls can be deleted and built-in edits reset', async () => {
  const settings = makeSettings();
  const [forward] = await loadRollDefinitions(settings);
  await saveRollDefinition(settings, {
    ...forward,
    pattern: {
      strings: [5, ...forward.pattern.strings.slice(1)],
      fingers: [...forward.pattern.fingers],
    },
  });
  await saveRollDefinition(settings, { ...forward, key: 'custom-test-roll', title: 'Custom Test Roll' });

  await resetRollDefinition(settings, 'forward');
  await deleteRollDefinition(settings, 'custom-test-roll');
  const definitions = await loadRollDefinitions(settings);
  assert.equal(definitions.length, 4);
  assert.equal(definitions[0].pattern.strings[0], 3);
  assert.equal(definitions[0].customized, false);
});

test('roll validation rejects mismatched or out-of-range pattern steps', async () => {
  const [forward] = await loadRollDefinitions();
  const mismatch = validateRollDefinition({
    ...forward,
    pattern: { strings: [1, 2], fingers: ['T'] },
  });
  assert.equal(mismatch.ok, false);

  const invalidString = validateRollDefinition({
    ...forward,
    pattern: { strings: [6], fingers: ['T'] },
  });
  assert.equal(invalidString.ok, false);
});
