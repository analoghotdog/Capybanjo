// ASCII tab importer (pure logic: no DOM, no Web Audio; standard ES modules).
//
// Recognizes blocks of five (or six) consecutive string lines like:
//
//   D|--0--2--|
//   B|--0--1--|
//   G|--0--0--|
//   D|--0--0--|
//   g|-------|
//
// Rhythm is not encoded in ASCII tab, so note columns are placed evenly:
// one column per `options.subdivision` beats (default 2 = eighth notes), and
// the tab is marked `rhythmUnknown: true`. Columns are the distinct character
// positions where a fret number starts within a system (aligned digits across
// lines form one column = one onset). Several stacked blocks are treated as
// continuation of one piece: columns are concatenated across systems.
//
// Documented limits / assumptions:
// - Every string line must start with a string label followed by '|'
//   (e.g. "D|---0---2--", "g|---", "1|--0--3--"). Unlabeled lines are ignored.
// - Only digit runs are read as frets. Hammer-on/pull-off/bend marks (h, p, s,
//   /, \, ~, x ...) are ignored and do not create columns.
// - Spaced multi-digit frets ("1 0") are not supported; write "10".
// - Bar lines '|' inside the tab are visual only (rhythm is unknown anyway)
//   and never create note columns.
// - A 6-line block imports its top five lines as banjo strings 1..5 by default.
//   Guitar conversion can instead retain all six lines and remap their pitches.
// - Runs of tab lines that cannot form a 5-line block are skipped, with a
//   warning (or a hard error when no block is found at all).

import { validateTab } from './model.js';

const STRING_LINE_RE = /^\s*([A-Za-z0-9#b]+)\s*\|(.*)$/;

/** Parse one candidate string line: { label, content } or null. */
function parseStringLine(line) {
  const m = STRING_LINE_RE.exec(line);
  if (!m) return null;
  const content = m[2];
  if (!/[-0-9]/.test(content)) return null;
  return { label: m[1], content };
}

/**
 * Split a run of consecutive string lines into systems. Guitar conversion
 * treats each six-line system as a complete source tab; normal imports retain
 * the existing five-line behavior.
 */
function chunkRun(lines, warnings, stringCount) {
  const systems = [];
  let i = 0;
  if (stringCount === 6) {
    while (lines.length - i >= 6) {
      systems.push({ lines: lines.slice(i, i + 6), six: false });
      i += 6;
    }
    if (lines.length - i > 0) {
      warnings.push(`Ignored ${lines.length - i} stray line(s) that do not form a complete 6-line guitar tab block.`);
    }
    return systems;
  }
  while (lines.length - i >= 5) {
    const rem = lines.length - i;
    if (rem === 6) {
      systems.push({ lines: lines.slice(i, i + 6), six: true });
      i += 6;
    } else {
      systems.push({ lines: lines.slice(i, i + 5), six: false });
      i += 5;
    }
  }
  const stray = lines.length - i;
  if (stray > 0) {
    warnings.push(`Ignored ${stray} stray line(s) that do not form a complete 5-line tab block.`);
  }
  return systems;
}

/**
 * Map the 5 lines of a system to tab string numbers 1..5.
 *
 * Per line, in order:
 * 1. options.stringMap[label] when provided (exact label match);
 * 2. label "5" or "g" pins the line to string 5 (the short 5th string);
 * 3. labels "1".."4" pin the line to that string;
 * 4. otherwise fill remaining strings top-down ("top line -> string 1").
 */
function mapStrings(lines, stringMap, warnings) {
  const n = lines.length;
  const mapping = new Array(n).fill(null);
  const claimed = new Set();
  const desired = lines.map(({ label }) => {
    if (stringMap && Object.prototype.hasOwnProperty.call(stringMap, label)) return stringMap[label];
    if (label === '5' || label === 'g') return 5;
    if (/^[1-4]$/.test(label)) return Number(label);
    return null;
  });
  for (let i = 0; i < n; i++) {
    const d = desired[i];
    if (d == null) continue;
    if (claimed.has(d)) {
      warnings.push(`Duplicate string label "${lines[i].label}"; falling back to line position.`);
      continue;
    }
    mapping[i] = d;
    claimed.add(d);
  }
  for (let i = 0; i < n; i++) {
    if (mapping[i] != null) continue;
    for (let s = 1; s <= 5; s++) {
      if (!claimed.has(s)) {
        mapping[i] = s;
        claimed.add(s);
        break;
      }
    }
    if (mapping[i] == null) {
      warnings.push(`Could not assign a string to line "${lines[i].label}"; ignoring that line.`);
    }
  }
  return mapping;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Parse an ASCII tab into a Tab.
 *
 * @param {string} text ASCII tab text (possibly several stacked systems).
 * @param {object} [options]
 * @param {string|object} [options.tuning='openG'] tuning key or Tuning object.
 * @param {number[]} [options.timeSignature=[4, 4]]
 * @param {string} [options.title='Imported ASCII tab']
 * @param {number} [options.subdivision=2] columns per beat (2 = eighth notes).
 * @param {object} [options.stringMap] { label: 1..5 } label overrides.
 * @returns {{ok:true, tab:object, warnings:string[]}|{ok:false, error:string}}
 */
export function parseAsciiTab(text, options = {}) {
  options = options ?? {};
  const warnings = [];

  if (typeof text !== 'string') {
    return { ok: false, error: 'Input must be a string of ASCII tab text.' };
  }

  const subdivision = options.subdivision ?? 2;
  if (typeof subdivision !== 'number' || !Number.isFinite(subdivision) || subdivision <= 0) {
    return { ok: false, error: 'options.subdivision must be a positive number.' };
  }
  if (options.stringCount != null && options.stringCount !== 6) {
    return { ok: false, error: 'options.stringCount must be 6 when importing a guitar tab.' };
  }
  if (options.stringCount === 6 && typeof options.noteTransform !== 'function') {
    return { ok: false, error: 'A note transform is required when importing six-string guitar tabs.' };
  }

  const stringMap = options.stringMap ?? null;
  if (stringMap != null) {
    if (typeof stringMap !== 'object') {
      return { ok: false, error: 'options.stringMap must be an object mapping labels to string numbers 1..5.' };
    }
    for (const [label, s] of Object.entries(stringMap)) {
      if (!Number.isInteger(s) || s < 1 || s > 5) {
        return { ok: false, error: `options.stringMap["${label}"] must be an integer 1..5.` };
      }
    }
  }

  // Find maximal runs of consecutive string lines.
  const runs = [];
  let run = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const parsed = parseStringLine(line);
    if (parsed) {
      run.push(parsed);
    } else {
      if (run.length) runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);

  const systems = [];
  for (const r of runs) systems.push(...chunkRun(r, warnings, options.stringCount));

  if (systems.length === 0) {
    return {
      ok: false,
      error: 'No ASCII tab block found. Expected five (or six) consecutive lines starting with string labels like "D|---0---2--", containing dashes and fret digits.',
    };
  }

  const notes = [];
  let shiftedNotes = 0;
  let droppedNotes = 0;
  let colOffset = 0; // columns consumed by earlier systems

  for (const sys of systems) {
    let sysLines = sys.lines;
    if (options.stringCount !== 6 && sys.six) {
      warnings.push('A 6-line block was found; ignoring its lowest line and importing only banjo strings 1-5.');
      sysLines = sysLines.slice(0, 5);
    }

    // Guitar tab lines run from string 1 (highest) to string 6 (lowest).
    const mapping = options.stringCount === 6
      ? sysLines.map((_, i) => i + 1)
      : mapStrings(sysLines, stringMap, warnings);

    // Fret runs per line, keyed by the character index where the run starts.
    const cols = sysLines.map(({ content }) =>
      [...content.matchAll(/\d+/g)].map((m) => ({ index: m.index, fret: parseInt(m[0], 10) })),
    );

    const positions = [...new Set(cols.flat().map((d) => d.index))].sort((a, b) => a - b);
    if (positions.length === 0) {
      warnings.push('A tab block contained no fret numbers; skipping it.');
      continue;
    }
    const colRank = new Map(positions.map((p, i) => [p, i]));

    for (let li = 0; li < sysLines.length; li++) {
      const string = mapping[li];
      if (string == null) continue;
      for (const d of cols[li]) {
        const note = {
          string,
          fret: d.fret,
          startBeat: round6((colOffset + colRank.get(d.index)) / subdivision),
          durationBeats: round6(1 / subdivision),
          finger: null,
        };
        const mapped = options.noteTransform ? options.noteTransform(note) : note;
        if (!mapped) {
          droppedNotes++;
          continue;
        }
        if (mapped.octaveShift) shiftedNotes++;
        notes.push({ ...note, string: mapped.string, fret: mapped.fret });
      }
    }
    colOffset += positions.length;
  }

  if (shiftedNotes > 0) {
    warnings.push(`Shifted ${shiftedNotes} guitar note(s) by octave(s) to fit the banjo range.`);
  }
  if (droppedNotes > 0) {
    warnings.push(`Skipped ${droppedNotes} guitar note(s) that could not be mapped to an available banjo string within fret 22.`);
  }

  notes.sort((a, b) => a.startBeat - b.startBeat || a.string - b.string);

  const tab = {
    title: options.title || 'Imported ASCII tab',
    source: 'ASCII import',
    tuning: options.tuning ?? 'openG',
    timeSignature: options.timeSignature ?? [4, 4],
    rhythmUnknown: true,
    notes,
  };

  const v = validateTab(tab);
  if (!v.ok) {
    return { ok: false, error: `Parsed tab failed validation: ${v.errors.join('; ')}` };
  }
  return { ok: true, tab, warnings };
}
