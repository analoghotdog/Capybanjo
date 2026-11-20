// MusicXML importer (pure logic: no DOM/DOMParser, no Web Audio; ES modules).
//
// Uncompressed MusicXML only (.musicxml / .xml). A small hand-written tokenizer
// replaces DOMParser so the module runs unchanged in Node and in the browser.
//
// Documented limits (basic handling, by design):
// - The tokenizer strips <?xml?>, comments and <!DOCTYPE>; attribute values
//   must not contain '<' or '>' (true for real-world MusicXML).
// - Designed for <score-partwise>. <score-timewise> is accepted but multi-part
//   scores are only partially supported: only the FIRST <part> is imported
//   (later parts are dropped with a warning).
// - Voices inside a part are positioned with <backup>/<forward> around a time
//   cursor; chord notes (<chord/>) share the onset of the previous note and do
//   not advance the cursor. <voice> numbers themselves are ignored.
// - <divisions> (per quarter note) can change mid-piece; the value in effect
//   when a <duration> is read is used.
// - Tempo: <sound tempo="..."> wins over <metronome> directions (beat-unit +
//   <per-minute>, beat-unit dots handled, "ca. 120" read leniently). When no
//   tempo is found the tab defaults to 120 BPM. Exposed as tab.tempoHint
//   (repo Tab convention) with tab.tempo set to the same value.
// - Time signature: <time><beats>/<beat-type>. options.timeSignature overrides
//   the file; the first in-file <time> wins; later changes produce a warning
//   and are not modeled (beats are quarter notes regardless).
// - <technical><string>/<fret> map 1:1 to tab strings 1..5 (MusicXML string 1
//   = highest). Notes on string 6+ (6-string data) are ignored with a warning.
//   Without <technical>, the pitch is mapped to the nearest string/fret of the
//   tuning (smallest fret >= 0 across strings, ties -> lower string number);
//   such notes get `ambiguous: true` and are counted in a warning. Pitches
//   below every open string are dropped with a warning.
// - Grace notes (<grace/>) are skipped; rests occupy time but emit no note.
// - Tuning is not read from the file (staff-tuning ignored); use options.tuning.

import { resolveTuning, validateTab, noteToMidi } from './model.js';

const STEP_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// <type> values in quarter-note beats (used when <duration> is missing).
const TYPE_BEATS = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1,
  eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
  '128th': 0.03125, '256th': 0.015625,
};

// <beat-unit> values in quarter-note beats (metronome directions).
const UNIT_QUARTERS = TYPE_BEATS;

const COMPRESSED_ERROR =
  'This looks like a compressed .mxl file. Please export it as uncompressed MusicXML (.musicxml or .xml) and try again.';

const round6 = (x) => Math.round(x * 1e6) / 1e6;

function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9A-Fa-f]+);?/g, (full, ent) => {
    switch (ent) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const code = ent[1] === 'x' || ent[1] === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : full;
      }
    }
  });
}

const TAG_RE = /^<\s*(\/?)\s*([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\s*(\/?)\s*>$/;
const ATTR_RE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Minimal tokenizer: array of { type: 'text'|'open'|'close', name?, attrs?, value? }. */
function tokenize(xml) {
  const tokens = [];
  const re = /<[^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(xml)) != null) {
    const raw = m[0];
    if (raw[0] !== '<') {
      tokens.push({ type: 'text', value: decodeEntities(raw) });
      continue;
    }
    const t = TAG_RE.exec(raw);
    if (!t) continue; // comment / PI / DOCTYPE leftovers: skip
    const [, slash, name, attrRegion, selfClose] = t;
    if (slash) {
      tokens.push({ type: 'close', name });
      continue;
    }
    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let a;
    while ((a = ATTR_RE.exec(attrRegion)) != null) {
      attrs[a[1]] = decodeEntities(a[2] != null ? a[2] : a[3]);
    }
    tokens.push({ type: 'open', name, attrs, self: selfClose === '/' });
  }
  return tokens;
}

/**
 * Stream the tokens into parsed notes and score metadata.
 * Returns an internal state object; see parseMusicXML for the output shape.
 */
function parseScore(xml, openMidis, noteTransform) {
  const state = {
    openMidis,
    stack: [],
    text: '',
    note: null,
    noteCount: 0,
    emitted: [],
    warnings: [],
    divisions: 0,
    cursor: 0, // position in quarter-note beats
    lastOnset: 0,
    tempo: null,
    tempoFromSound: false,
    metronome: null, // { unit, perMinute, dots } while inside <metronome>
    timeSig: null,
    sawTime: false,
    title: null,
    partCount: 0,
    graceSkipped: 0,
    defaultedDurations: 0,
    ignoredParts: 0,
    ambiguousCount: 0,
    droppedSixth: 0,
    droppedBelow: 0,
    droppedNoPitch: 0,
    conversionDropped: 0,
    conversionShifted: 0,
    backupDur: null,
    forwardDur: null,
    sawRoot: false,
  };

  const openNote = () => ({
    step: null, alter: 0, octave: null, duration: null, type: null,
    rest: false, chord: false, grace: false, dots: 0, string: null, fret: null,
  });

  function finishNote() {
    const n = state.note;
    state.note = null;
    if (!n) return;
    if (n.grace) {
      state.graceSkipped++;
      return;
    }
    let dur;
    if (n.duration != null && n.duration > 0 && state.divisions > 0) {
      dur = n.duration / state.divisions;
    } else if (n.type && TYPE_BEATS[n.type] != null) {
      dur = TYPE_BEATS[n.type] * (n.dots > 0 ? 2 - Math.pow(2, -n.dots) : 1);
    } else {
      dur = 1;
      state.defaultedDurations++;
    }

    let onset;
    if (n.chord) {
      onset = state.lastOnset;
    } else {
      onset = state.cursor;
      state.lastOnset = onset;
      state.cursor += dur;
    }
    if (n.rest) return;
    if (state.partCount > 1) {
      state.ignoredParts++;
      return;
    }

    const out = { startBeat: onset, durationBeats: dur, finger: null };
    if (noteTransform) {
      const step = n.step != null ? String(n.step).toUpperCase() : null;
      const midi = step != null && STEP_OFFSETS[step] != null && n.octave != null
        ? (n.octave + 1) * 12 + STEP_OFFSETS[step] + (n.alter || 0)
        : null;
      const mapped = noteTransform({
        midi,
        string: n.string,
        fret: n.fret,
        startBeat: out.startBeat,
      });
      if (!mapped) {
        state.conversionDropped++;
        return;
      }
      out.string = mapped.string;
      out.fret = mapped.fret;
      if (mapped.octaveShift) state.conversionShifted++;
    } else if (n.string != null && n.fret != null && Number.isInteger(n.string) && Number.isInteger(n.fret)) {
      if (n.string >= 1 && n.string <= 5 && n.fret >= 0) {
        out.string = n.string;
        out.fret = n.fret;
      } else if (n.string >= 6) {
        state.droppedSixth++;
        return;
      } else {
        state.droppedNoPitch++;
        return;
      }
    } else {
      // No usable <technical>: map the pitch to the nearest string/fret.
      const step = n.step != null ? String(n.step).toUpperCase() : null;
      if (step == null || STEP_OFFSETS[step] == null || n.octave == null) {
        state.droppedNoPitch++;
        return;
      }
      const midi = (n.octave + 1) * 12 + STEP_OFFSETS[step] + (n.alter || 0);
      let best = null;
      for (let s = 1; s <= 5; s++) {
        const fret = midi - state.openMidis[s];
        if (fret >= 0 && (best === null || fret < best.fret)) {
          best = { string: s, fret }; // strict < keeps the lower string on ties
        }
      }
      if (!best) {
        state.droppedBelow++;
        return;
      }
      out.string = best.string;
      out.fret = best.fret;
      out.ambiguous = true;
      state.ambiguousCount++;
    }
    out.startBeat = round6(out.startBeat);
    out.durationBeats = round6(out.durationBeats);
    state.emitted.push(out);
  }

  function commitTime(beats, beatType) {
    const ts = [beats, beatType];
    if (!state.sawTime) {
      state.sawTime = true;
      state.timeSig = ts;
    } else if (state.timeSig[0] !== ts[0] || state.timeSig[1] !== ts[1]) {
      state.warnings.push(
        `Time signature changes are not modeled; keeping [${state.timeSig.join('/')}] and ignoring [${ts.join('/')}].`,
      );
    }
  }

  function commitMetronome() {
    const mn = state.metronome;
    state.metronome = null;
    if (!mn || state.tempo != null || !(mn.perMinute > 0)) return;
    const unitQ = UNIT_QUARTERS[mn.unit] ?? 1;
    state.tempo = mn.perMinute * unitQ * (mn.dots > 0 ? 2 - Math.pow(2, -mn.dots) : 1);
  }

  const tokens = tokenize(xml);
  for (const tok of tokens) {
    if (tok.type === 'text') {
      state.text += tok.value;
      continue;
    }
    if (tok.type === 'open') {
      const { name, attrs, self } = tok;
      state.text = '';
      switch (name) {
        case 'score-partwise':
        case 'score-timewise':
          state.sawRoot = true;
          break;
        case 'note':
          state.note = openNote();
          state.noteCount++;
          break;
        case 'chord':
          if (state.note) state.note.chord = true;
          break;
        case 'rest':
          if (state.note) state.note.rest = true;
          break;
        case 'grace':
          if (state.note) state.note.grace = true;
          break;
        case 'dot':
          if (state.note) state.note.dots++;
          break;
        case 'sound': {
          const t = parseFloat(attrs.tempo);
          if (Number.isFinite(t) && t > 0) {
            state.tempo = t;
            state.tempoFromSound = true;
          }
          break;
        }
        case 'metronome':
          state.metronome = { unit: null, perMinute: null, dots: 0 };
          break;
        case 'beat-unit-dot':
          if (state.metronome) state.metronome.dots++;
          break;
        case 'part':
          state.partCount++;
          break;
        case 'backup':
          state.backupDur = null;
          break;
        case 'forward':
          state.forwardDur = null;
          break;
        default:
          break;
      }
      if (!self) state.stack.push(name);
      continue;
    }
    // close tag
    const { name } = tok;
    const text = state.text.trim();
    state.text = '';
    switch (name) {
      case 'step':
        if (state.note) state.note.step = text;
        break;
      case 'alter':
        if (state.note) state.note.alter = parseFloat(text) || 0;
        break;
      case 'octave':
        if (state.note) state.note.octave = parseInt(text, 10);
        break;
      case 'duration': {
        const d = parseFloat(text);
        if (Number.isFinite(d)) {
          if (state.stack.includes('note')) {
            if (state.note) state.note.duration = d;
          } else if (state.stack.includes('backup')) {
            state.backupDur = d;
          } else if (state.stack.includes('forward')) {
            state.forwardDur = d;
          }
        }
        break;
      }
      case 'type':
        if (state.note) state.note.type = text;
        break;
      case 'string':
        if (state.note && state.stack.includes('technical')) {
          const s = parseInt(text, 10);
          if (Number.isInteger(s)) state.note.string = s;
        }
        break;
      case 'fret':
        if (state.note && state.stack.includes('technical')) {
          const f = parseInt(text, 10);
          if (Number.isInteger(f)) state.note.fret = f;
        }
        break;
      case 'divisions': {
        const d = parseFloat(text);
        if (Number.isFinite(d) && d > 0) state.divisions = d;
        break;
      }
      case 'beats': {
        if (state.stack.includes('time')) {
          const m = /^\s*(\d+)/.exec(text);
          if (m) state.pendingBeats = parseInt(m[1], 10);
        }
        break;
      }
      case 'beat-type': {
        if (state.stack.includes('time')) {
          const bt = parseInt(text, 10);
          if (Number.isInteger(bt) && bt > 0 && state.pendingBeats) {
            commitTime(state.pendingBeats, bt);
            state.pendingBeats = null;
          }
        }
        break;
      }
      case 'per-minute': {
        if (state.metronome) {
          const m = /[\d.]+/.exec(text);
          if (m) state.metronome.perMinute = parseFloat(m[0]);
        }
        break;
      }
      case 'beat-unit': {
        if (state.metronome) state.metronome.unit = text;
        break;
      }
      case 'metronome':
        commitMetronome();
        break;
      case 'work-title':
      case 'movement-title':
        if (!state.title && text) state.title = text;
        break;
      case 'backup': {
        const beats = state.divisions > 0 ? (state.backupDur ?? 0) / state.divisions : 0;
        state.cursor = Math.max(0, state.cursor - beats);
        break;
      }
      case 'forward': {
        const beats = state.divisions > 0 ? (state.forwardDur ?? 0) / state.divisions : 0;
        state.cursor += beats;
        break;
      }
      case 'note':
        finishNote();
        break;
      default:
        break;
    }
    // Lenient pop: drop through the matching open tag (tolerates odd nesting).
    const idx = state.stack.lastIndexOf(name);
    if (idx !== -1) state.stack.length = idx;
  }

  return state;
}

/**
 * Parse an uncompressed MusicXML document into a Tab.
 *
 * @param {string} xmlText
 * @param {object} [options] same option names as parse-ascii:
 *   title / tuning / timeSignature (option values override the file);
 *   noteTransform optionally remaps each note using its pitch and source
 *   technical string/fret before it is added to the output tab.
 * @returns {{ok:true, tab:object, warnings:string[]}|{ok:false, error:string}}
 */
export function parseMusicXML(xmlText, options = {}) {
  options = options ?? {};
  if (typeof xmlText !== 'string') {
    return { ok: false, error: 'Input must be a string of MusicXML text.' };
  }
  if (xmlText.slice(0, 2) === 'PK') {
    return { ok: false, error: COMPRESSED_ERROR };
  }

  const xml = xmlText
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '');

  const tuning = resolveTuning(options.tuning);
  const openMidis = {};
  try {
    for (const s of [1, 2, 3, 4, 5]) openMidis[s] = noteToMidi(tuning.strings[s]);
  } catch (e) {
    return { ok: false, error: `Invalid tuning: ${e.message}` };
  }

  if (options.noteTransform != null && typeof options.noteTransform !== 'function') {
    return { ok: false, error: 'options.noteTransform must be a function.' };
  }
  const state = parseScore(xml, openMidis, options.noteTransform);

  if (!state.sawRoot) {
    return {
      ok: false,
      error: 'This does not look like a MusicXML document (missing <score-partwise> or <score-timewise> root element).',
    };
  }
  if (state.noteCount === 0) {
    return { ok: false, error: 'No <note> elements were found in the MusicXML score.' };
  }

  const warnings = state.warnings;
  if (state.partCount > 1) {
    warnings.push(`The score has ${state.partCount} parts; only the first part was imported.`);
  }
  if (state.graceSkipped > 0) {
    warnings.push(`Skipped ${state.graceSkipped} grace note(s).`);
  }
  if (state.defaultedDurations > 0) {
    warnings.push(`${state.defaultedDurations} note(s) had no usable <duration>/<type>; defaulted to 1 beat.`);
  }
  if (state.droppedSixth > 0) {
    warnings.push(
      `Ignored ${state.droppedSixth} note(s) on strings 6+ (6-string tab data); only strings 1-5 are imported.`,
    );
  }
  if (state.droppedBelow > 0) {
    warnings.push(`Ignored ${state.droppedBelow} note(s) whose pitch is below every open string of the tuning.`);
  }
  if (state.droppedNoPitch > 0) {
    warnings.push(`Ignored ${state.droppedNoPitch} note(s) with no usable <pitch> or <technical> string/fret.`);
  }
  if (state.conversionShifted > 0) {
    warnings.push(`Shifted ${state.conversionShifted} guitar note(s) by octave(s) to fit the banjo range.`);
  }
  if (state.conversionDropped > 0) {
    warnings.push(`Skipped ${state.conversionDropped} guitar note(s) that could not be mapped to an available banjo string within fret 22.`);
  }
  if (state.ambiguousCount > 0) {
    warnings.push(
      `${state.ambiguousCount} note(s) had no <technical> string/fret; mapped from pitch to the nearest string/fret (marked ambiguous).`,
    );
  }
  if (state.emitted.length === 0) {
    warnings.push('No playable pitched notes were found (the score may contain only rests).');
  }

  const notes = state.emitted.sort((a, b) => a.startBeat - b.startBeat || a.string - b.string);

  const tempo = Math.round((state.tempo ?? 120) * 100) / 100;
  const tab = {
    title: options.title || state.title || 'Imported MusicXML',
    source: 'MusicXML import',
    tuning: options.tuning ?? 'openG',
    timeSignature: options.timeSignature ?? state.timeSig ?? [4, 4],
    rhythmUnknown: false,
    tempoHint: tempo, // repo Tab convention (see src/tab/library.js)
    tempo, // plain alias for convenience
    notes,
  };

  const v = validateTab(tab);
  if (!v.ok) {
    return { ok: false, error: `Parsed tab failed validation: ${v.errors.join('; ')}` };
  }
  return { ok: true, tab, warnings };
}
