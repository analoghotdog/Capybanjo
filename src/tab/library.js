// Loader for the roll library. The data lives in library/rolls.json (editable);
// this module only loads and expands it into Tab objects.

import { beatsPerMeasure, validateTab } from './model.js';

async function readJson(url) {
  let text;
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    text = await readFile(url, 'utf8');
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load rolls.json: ${res.status}`);
    text = await res.text();
  }
  return JSON.parse(text);
}

/** Expand one roll pattern into a full Tab of open-string eighth notes. */
export function expandRoll(roll) {
  const strings = roll.pattern.strings;
  const fingers = roll.pattern.fingers;
  const step = 0.5; // eighth notes
  const beats = beatsPerMeasure(roll.timeSignature);
  const notes = [];
  for (let m = 0; m < roll.measures; m++) {
    for (let i = 0; i < strings.length; i++) {
      notes.push({
        string: strings[i],
        fret: 0,
        startBeat: m * beats + i * step,
        durationBeats: step,
        finger: fingers[i] ?? null,
      });
    }
  }
  return {
    id: `roll:${roll.key}`,
    title: roll.title,
    source: 'Roll library (rolls.json)',
    tuning: roll.tuning,
    timeSignature: roll.timeSignature,
    tempoHint: roll.tempoHint ?? 60,
    rhythmUnknown: false,
    notes,
    importedAt: null,
  };
}

/** Load all rolls as Tabs. */
export async function loadRolls() {
  const url = new URL('./library/rolls.json', import.meta.url);
  const data = await readJson(url);
  return data.rolls.map(expandRoll);
}

/** Validate every expanded roll; returns { ok, errors } for tests/tooling. */
export function validateRolls(rolls) {
  const errors = [];
  for (const tab of rolls) {
    const r = validateTab(tab);
    if (!r.ok) errors.push(`${tab.title}: ${r.errors.join('; ')}`);
  }
  return { ok: errors.length === 0, errors };
}
