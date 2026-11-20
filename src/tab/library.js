// The packaged defaults live in library/rolls.json; browser edits are stored
// in settings and expanded into the same Tab objects for every exercise view.

import { beatsPerMeasure, validateTab } from './model.js';

export const ROLL_LIBRARY_SETTING = 'rollLibrary';

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

function copyRoll(roll) {
  return {
    key: roll.key,
    title: roll.title,
    tuning: roll.tuning,
    timeSignature: [...roll.timeSignature],
    tempoHint: roll.tempoHint,
    measures: roll.measures,
    pattern: {
      strings: [...roll.pattern.strings],
      fingers: [...roll.pattern.fingers],
    },
  };
}

export function validateRollDefinition(roll) {
  const errors = [];
  if (!roll || typeof roll !== 'object') return { ok: false, errors: ['roll must be an object'] };
  if (typeof roll.key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(roll.key)) {
    errors.push('key must contain only lowercase letters, numbers and hyphens');
  }
  if (typeof roll.title !== 'string' || !roll.title.trim() || roll.title.length > 80) {
    errors.push('title must contain 1..80 characters');
  }
  if (!Number.isInteger(roll.measures) || roll.measures < 1 || roll.measures > 32) {
    errors.push('measures must be an integer from 1 to 32');
  }
  if (!Number.isInteger(roll.tempoHint) || roll.tempoHint < 30 || roll.tempoHint > 240) {
    errors.push('tempoHint must be an integer from 30 to 240');
  }
  const timeSignature = roll.timeSignature;
  if (!Array.isArray(timeSignature) || timeSignature.length !== 2
    || !timeSignature.every((value) => Number.isInteger(value) && value > 0)) {
    errors.push('timeSignature must contain two positive integers');
  }
  const pattern = roll.pattern;
  if (!pattern || !Array.isArray(pattern.strings) || !Array.isArray(pattern.fingers)
    || pattern.strings.length === 0 || pattern.strings.length > 8
    || pattern.strings.length !== pattern.fingers.length) {
    errors.push('pattern must contain 1..8 matching string and finger steps');
  } else {
    if (pattern.strings.some((string) => !Number.isInteger(string) || string < 1 || string > 5)) {
      errors.push('pattern strings must be integers from 1 to 5');
    }
    if (pattern.fingers.some((finger) => !['T', 'I', 'M'].includes(finger))) {
      errors.push('pattern fingers must be T, I or M');
    }
  }
  if (errors.length) return { ok: false, errors };
  const tabValidation = validateTab(expandRoll(roll));
  return tabValidation.ok
    ? { ok: true, errors: [] }
    : { ok: false, errors: tabValidation.errors };
}

async function loadDefaultDefinitions() {
  const url = new URL('./library/rolls.json', import.meta.url);
  const data = await readJson(url);
  if (!Array.isArray(data.rolls)) throw new Error('The roll library has an invalid format.');
  return data.rolls;
}

/** Load the packaged rolls, applying saved edits and adding user-created rolls. */
export async function loadRollDefinitions(settings) {
  const defaults = await loadDefaultDefinitions();
  const saved = settings ? await settings.get(ROLL_LIBRARY_SETTING, []) : [];
  if (!Array.isArray(saved)) throw new Error('Saved rolls have an invalid format.');

  const savedByKey = new Map();
  for (const roll of saved) {
    const validation = validateRollDefinition(roll);
    if (!validation.ok) throw new Error(`Saved roll is invalid: ${validation.errors.join('; ')}`);
    if (savedByKey.has(roll.key)) throw new Error(`Saved roll key is duplicated: ${roll.key}`);
    savedByKey.set(roll.key, roll);
  }

  const defaultKeys = new Set(defaults.map((roll) => roll.key));
  const definitions = defaults.map((roll) => {
    const override = savedByKey.get(roll.key);
    savedByKey.delete(roll.key);
    return {
      ...copyRoll(override || roll),
      builtIn: true,
      customized: Boolean(override),
    };
  });
  for (const roll of savedByKey.values()) {
    if (defaultKeys.has(roll.key)) continue;
    definitions.push({ ...copyRoll(roll), builtIn: false, customized: true });
  }
  return definitions;
}

/** Persist a built-in roll override or a new user-created roll. */
export async function saveRollDefinition(settings, roll) {
  const validation = validateRollDefinition(roll);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  await loadRollDefinitions(settings);
  const saved = await settings.get(ROLL_LIBRARY_SETTING, []);
  const definition = copyRoll(roll);
  const next = saved.filter((item) => item.key !== definition.key);
  next.push(definition);
  await settings.set(ROLL_LIBRARY_SETTING, next);
}

/** Remove a user-created roll override, restoring a built-in when applicable. */
export async function deleteRollDefinition(settings, key) {
  const definitions = await loadRollDefinitions(settings);
  const roll = definitions.find((item) => item.key === key);
  if (!roll) throw new Error('Roll not found.');
  if (roll.builtIn) throw new Error('Built-in rolls cannot be deleted.');
  const saved = await settings.get(ROLL_LIBRARY_SETTING, []);
  await settings.set(ROLL_LIBRARY_SETTING, saved.filter((item) => item.key !== key));
}

/** Restore a built-in roll to its packaged pattern. */
export async function resetRollDefinition(settings, key) {
  const definitions = await loadRollDefinitions(settings);
  const roll = definitions.find((item) => item.key === key);
  if (!roll || !roll.builtIn) throw new Error('Built-in roll not found.');
  const saved = await settings.get(ROLL_LIBRARY_SETTING, []);
  await settings.set(ROLL_LIBRARY_SETTING, saved.filter((item) => item.key !== key));
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
    source: 'Roll library',
    tuning: roll.tuning,
    timeSignature: roll.timeSignature,
    tempoHint: roll.tempoHint ?? 60,
    rhythmUnknown: false,
    notes,
    importedAt: null,
  };
}

/** Load all rolls as Tabs. */
export async function loadRolls(settings) {
  const definitions = await loadRollDefinitions(settings);
  return definitions.map(expandRoll);
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
