// Static tab renderer producing SVG: five lines (string 1 on top), fret numbers
// on the lines, beat and measure bars, finger labels beneath each note, and
// wrapping to several systems for long tabs. See build plan Step 12.
// renderTabSvg returns an SVG string (testable without a DOM); tabLayout gives
// coordinates so the view can drive the playback cursor.

import { beatsPerMeasure, measureCount, notesInMeasure } from './model.js';

const LINE_GAP = 20;
const STAFF_H = LINE_GAP * 4; // 5 lines
const SYS_H = 170;
const MARGIN_X = 46;

/** Geometry for one tab. Stable for given options. */
export function tabLayout(tab, options = {}) {
  const width = options.width ?? 920;
  const measuresPerLine = options.measuresPerLine ?? 4;
  const large = !!options.large;
  const fretSize = large ? 18 : 14;
  const beats = beatsPerMeasure(tab.timeSignature);
  const totalMeasures = measureCount(tab);
  const systems = [];

  for (let s = 0; s * measuresPerLine < totalMeasures; s++) {
    const m0 = s * measuresPerLine;
    const mCount = Math.min(measuresPerLine, totalMeasures - m0);
    const measureW = (width - 2 * MARGIN_X) / measuresPerLine;
    const notes = [];
    for (let m = m0; m < m0 + mCount; m++) {
      for (const n of notesInMeasure(tab, m)) {
        const beatInM = n.startBeat - m * beats;
        const x = MARGIN_X + (m - m0) * measureW + (beatInM / beats) * measureW;
        notes.push({ x, y: (n.string - 1) * LINE_GAP, note: n });
      }
    }
    notes.sort((a, b) => a.x - b.x);
    const measureBars = [];
    for (let m = 0; m <= mCount; m++) measureBars.push(MARGIN_X + m * measureW);
    const beatMarks = [];
    for (let m = 0; m < mCount; m++) {
      for (let b = 0; b < beats; b++) {
        beatMarks.push(MARGIN_X + m * measureW + (b / beats) * measureW);
      }
    }
    systems.push({ y: s * SYS_H, notes, measureBars, beatMarks });
  }

  return {
    width,
    height: systems.length * SYS_H + 20,
    systems,
    staffH: STAFF_H,
    sysH: SYS_H,
    fretSize,
  };
}

/** Cursor box (highlight) for the note at position `pos` from a layout system. */
export function cursorRect(pos, layout) {
  return {
    x: pos.x - 11,
    y: pos.y - 12,
    width: 22,
    height: 24,
  };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Full SVG markup for a tab. */
export function renderTabSvg(tab, options = {}) {
  const layout = tabLayout(tab, options);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="100%" role="img" aria-label="Tab for ${esc(tab.title)}">`);
  parts.push('<rect x="0" y="0" width="100%" height="100%" fill="none"/>');
  parts.push('<g class="tab-cursor" visibility="hidden"><rect id="tab-cursor-rect" x="0" y="0" width="0" height="0" rx="4"/></g>');

  layout.systems.forEach((sys, si) => {
    const y0 = sys.y + 20;
    // string lines
    for (let s = 0; s < 5; s++) {
      const y = y0 + s * LINE_GAP;
      parts.push(`<line x1="${MARGIN_X}" y1="${y}" x2="${layout.width - MARGIN_X}" y2="${y}" stroke="currentColor" stroke-width="1.2"/>`);
      parts.push(`<text x="${MARGIN_X - 12}" y="${y + 4}" font-size="11" fill="currentColor" text-anchor="middle">${s + 1}</text>`);
    }
    // beat ticks (short) and measure bars (full height)
    for (const x of sys.beatMarks) {
      parts.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + 6}" stroke="currentColor" stroke-width="1" opacity="0.5"/>`);
    }
    for (const x of sys.measureBars) {
      parts.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + STAFF_H}" stroke="currentColor" stroke-width="1.4"/>`);
    }
    // notes: fret numbers on the lines
    for (const pos of sys.notes) {
      const y = y0 + pos.y;
      parts.push(`<text class="tab-note" data-note="true" x="${pos.x}" y="${y + layout.fretSize * 0.36}" font-size="${layout.fretSize}" fill="currentColor" text-anchor="middle" stroke="var(--bg, #fff)" stroke-width="3" paint-order="stroke">${pos.note.fret}</text>`);
      if (pos.note.finger) {
        parts.push(`<text x="${pos.x}" y="${y0 + STAFF_H + 20}" font-size="11" fill="currentColor" text-anchor="middle" opacity="0.8">${esc(pos.note.finger)}</text>`);
      }
    }
    parts.push(`<text x="${MARGIN_X - 12}" y="${y0 + STAFF_H + 20}" font-size="10" fill="currentColor" text-anchor="middle" opacity="0.6">fin.</text>`);
    if (si < layout.systems.length - 1) {
      parts.push(`<text x="${layout.width - MARGIN_X + 8}" y="${y0 + STAFF_H + 20}" font-size="11" fill="currentColor">m. ${si * (options.measuresPerLine ?? 4) + 1}</text>`);
    }
  });

  parts.push('</svg>');
  return parts.join('\n');
}
