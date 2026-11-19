// Chord data, SVG fretboard diagrams and the chord-change drill logic.
// See build plan Steps 49-50.
// NOTE: chord shapes are editable data in code; like the roll library they
// should be confirmed against the owner's teaching material (README notes this).

/** frets: per string 1..5; 0 = open, -1 = not played, n = fret. */
export const OPEN_G_CHORDS = [
  { key: 'G', name: 'G', frets: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
  { key: 'C', name: 'C', frets: { 1: 0, 2: 1, 3: 0, 4: 2, 5: -1 } },
  { key: 'D', name: 'D', frets: { 1: 0, 2: 3, 3: 2, 4: 0, 5: -1 } },
  { key: 'D7', name: 'D7', frets: { 1: 0, 2: 1, 3: 2, 4: 0, 5: -1 } },
  { key: 'Em', name: 'Em', frets: { 1: 0, 2: 0, 3: 0, 4: 2, 5: -1 } },
  { key: 'Am', name: 'Am', frets: { 1: 0, 2: 1, 3: 2, 4: 2, 5: -1 } },
  { key: 'F', name: 'F', frets: { 1: 0, 2: 1, 3: 2, 4: 3, 5: -1 } },
  { key: 'A7', name: 'A7', frets: { 1: 0, 2: 0, 3: 2, 4: 0, 5: -1 } },
  { key: 'G7', name: 'G7', frets: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 } },
  { key: 'Bm', name: 'Bm', frets: { 1: 0, 2: 3, 3: 2, 4: 2, 5: -1 } },
];

export function chordByKey(key) {
  return OPEN_G_CHORDS.find((c) => c.key === key) || null;
}

/**
 * SVG chord diagram (frets horizontal, strings vertical).
 * Drawn as string 4 on the left through string 1, with the short 5th string on
 * the far right starting below the nut (standard banjo diagram layout).
 */
export function renderChordDiagram(chord, options = {}) {
  const size = options.size ?? 140;
  const fretsShown = options.fretsShown ?? 4;
  const strings = [4, 3, 2, 1, 5];
  const w = size;
  const h = size * 1.15;
  const left = size * 0.18;
  const right = size * 0.86;
  const top = size * 0.32;
  const bottom = size * 1.02;
  const gapX = (right - left) / (strings.length - 1);
  const gapY = (bottom - top) / fretsShown;

  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${chord.name} chord diagram">`);
  // nut
  p.push(`<rect x="${left - 2}" y="${top - 6}" width="${right - left + 4}" height="6" fill="currentColor"/>`);
  // frets
  for (let f = 1; f <= fretsShown; f++) {
    const y = top + f * gapY;
    p.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="currentColor" stroke-width="1"/>`);
  }
  // strings (5th string is short: starts at the 5th-fret position)
  strings.forEach((s, i) => {
    const x = left + i * gapX;
    const yStart = s === 5 ? top + gapY : top - 6;
    p.push(`<line x1="${x}" y1="${yStart}" x2="${x}" y2="${bottom}" stroke="currentColor" stroke-width="1.2"/>`);
  });
  // markers
  strings.forEach((s, i) => {
    const x = left + i * gapX;
    const f = chord.frets[s];
    if (f === -1) {
      p.push(`<text x="${x}" y="${top - 12}" font-size="12" text-anchor="middle" fill="currentColor">x</text>`);
    } else if (f === 0) {
      p.push(`<circle cx="${x}" cy="${top - 15}" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/>`);
    } else {
      const y = top + (f - 0.5) * gapY;
      p.push(`<circle cx="${x}" cy="${y}" r="7" fill="currentColor"/>`);
    }
  });
  p.push(`<text x="${w / 2}" y="${size * 0.18}" font-size="${size * 0.14}" text-anchor="middle" fill="currentColor">${chord.name}</text>`);
  p.push('</svg>');
  return p.join('\n');
}

/**
 * Chord-change drill state machine (pure). The view feeds it scheduler ticks.
 * config: { chords: [chordKeys], beatsPerChord = 4, bars = 8 }
 */
export function createChordDrill(config) {
  const seq = config.chords.map((k) => chordByKey(k)).filter(Boolean);
  const beatsPerChord = config.beatsPerChord ?? 4;
  const totalBeats = (config.bars ?? 8) * 4;
  let beat = 0;

  return {
    start() { beat = 0; },
    /** Advance one beat; returns { chord, nextChord, beatInChord, done, changeNow } */
    next() {
      if (seq.length === 0 || beat >= totalBeats) {
        return { chord: null, nextChord: null, beatInChord: 0, done: true, changeNow: false };
      }
      const idx = Math.floor(beat / beatsPerChord) % seq.length;
      const beatInChord = beat % beatsPerChord;
      const nextIdx = Math.floor((beat + 1) / beatsPerChord) % seq.length;
      const out = {
        chord: seq[idx],
        nextChord: seq[nextIdx],
        beatInChord,
        done: beat + 1 >= totalBeats,
        changeNow: beatInChord === beatsPerChord - 1,
      };
      beat += 1;
      return out;
    },
    getState: () => ({ beat, totalBeats, chords: seq }),
  };
}
