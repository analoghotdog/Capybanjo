// Tuner view (build plan Steps 47-48): live pitch display with note name, cents
// offset and a needle; tuning preset selector (open G, double C, sawmill,
// open D, custom) that highlights the closest target string, with the 5th
// string shown clearly. Per-string reference tones use the synth.

import { el, select } from './dom.js';
import { TUNINGS } from '../tab/model.js';
import { detectPitchYIN } from '../audio/pitch.js';
import { centsOff, noteNameFromFreq, nearestTarget, targetStrings } from '../features/tuner.js';
import { playNote } from '../audio/synth.js';

const PRESETS = [
  ['openG', TUNINGS.openG.name],
  ['doubleC', TUNINGS.doubleC.name],
  ['sawmill', TUNINGS.sawmill.name],
  ['openD', TUNINGS.openD.name],
  ['custom', 'Custom'],
];

export function mountTuner(container, app) {
  let tuningKey = 'openG';
  let customTuning = { name: 'Custom', strings: { 1: 'D4', 2: 'B3', 3: 'G3', 4: 'D3', 5: 'G4' } };
  let rafId = 0;
  let running = false;

  const tuningOf = () => (tuningKey === 'custom' ? customTuning : TUNINGS[tuningKey]);

  // ---- display ----
  const readout = el('p', { class: 'mono', text: 'Listening: press Start.' });
  const needleWrap = el('div', { class: 'panel' });
  const targetWrap = el('div', { class: 'panel' });

  function renderNeedle(cents) {
    const w = 320, h = 90;
    const clamped = Math.max(-50, Math.min(50, cents));
    const x = w / 2 + (clamped / 50) * (w / 2 - 20);
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Pitch needle">`,
      `<line x1="20" y1="60" x2="${w - 20}" y2="60" stroke="currentColor" stroke-width="1.5"/>`,
    ];
    for (let c = -50; c <= 50; c += 10) {
      const cx = w / 2 + (c / 50) * (w / 2 - 20);
      const tall = c === 0 ? 16 : 8;
      parts.push(`<line x1="${cx}" y1="60" x2="${cx}" y2="${60 - tall}" stroke="currentColor" stroke-width="${c === 0 ? 2 : 1}"/>`);
      parts.push(`<text x="${cx}" y="78" font-size="8" text-anchor="middle" fill="currentColor">${c > 0 ? '+' : ''}${c}</text>`);
    }
    parts.push(`<line x1="${x}" y1="20" x2="${x}" y2="62" stroke="currentColor" stroke-width="3"/>`);
    parts.push(`<text x="${w / 2}" y="16" font-size="11" text-anchor="middle" fill="currentColor">${cents > 1 ? 'sharp (late/high)' : cents < -1 ? 'flat (low)' : 'in tune'}</text>`);
    parts.push('</svg>');
    needleWrap.innerHTML = parts.join('\n');
  }

  function renderTargets(closest) {
    targetWrap.innerHTML = '';
    const table = el('table');
    table.append(el('tr', {}, el('th', { text: 'String' }), el('th', { text: 'Target' }), el('th', { text: 'Reference tone' })));
    for (const t of targetStrings(tuningOf())) {
      const isClosest = closest && closest.string === t.string;
      const row = el('tr', {},
        el('td', { text: `${t.string}${t.isFifth ? ' (short 5th string)' : ''}${isClosest ? ' - closest match' : ''}` }),
        el('td', { class: 'mono', text: `${t.name} - ${t.targetFreq.toFixed(2)} Hz` }),
        el('td', {},
          el('button', {
            type: 'button', class: 'secondary', text: 'Play',
            onClick: async () => {
              const ctx = await app.ensureAudio();
              playNote(ctx, t.targetFreq, ctx.currentTime + 0.02, 0.7);
            },
          })));
      if (isClosest) row.style.fontWeight = '700';
      table.append(row);
    }
    targetWrap.append(table);
    targetWrap.append(el('p', { class: 'muted small', text: 'The 5th string is the short string on the side of the neck.' }));
  }

  // ---- analysis loop ----
  let analyser = null;
  let buf = null;

  async function start() {
    try {
      const stream = await (await import('../audio/capture.js')).startCapture({
        deviceId: await app.settings.get('inputDeviceId', null),
      });
      const ctx = await app.ensureAudio();
      const source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      running = true;
      startBtn.textContent = 'Stop';
      loop();
    } catch (err) {
      readout.textContent = `Microphone unavailable: ${err.message}`;
    }
  }

  function stop() {
    running = false;
    analyser = null;
    startBtn.textContent = 'Start';
    readout.textContent = 'Stopped.';
    renderNeedle(0);
  }

  function loop() {
    if (!running || !analyser) return;
    analyser.getFloatTimeDomainData(buf);
    const { frequency, probability } = detectPitchYIN(buf, app.getCtx().sampleRate);
    if (frequency && probability > 0.8) {
      const name = noteNameFromFreq(frequency);
      const target = nearestTarget(frequency, tuningOf());
      const cents = target ? target.cents : centsOff(frequency, 440);
      readout.textContent = `${name.noteName} - ${frequency.toFixed(1)} Hz - ${name.cents >= 0 ? '+' : ''}${name.cents.toFixed(0)} cents from equal temperament`;
      renderNeedle(cents);
      renderTargets(target);
    } else {
      readout.textContent = 'Listening: play a string...';
    }
    rafId = requestAnimationFrame(loop);
  }

  // ---- custom tuning inputs ----
  const customRow = el('div', { class: 'row hidden' });
  for (const s of [5, 4, 3, 2, 1]) {
    const input = el('input', {
      type: 'text', value: customTuning.strings[s], size: 5,
      'aria-label': `Custom tuning string ${s}`,
      onChange: (e) => {
        try {
          customTuning.strings[s] = e.target.value.trim();
          renderTargets(null);
        } catch { /* keep previous */ }
      },
    });
    customRow.append(el('label', {}, `String ${s}`, input));
  }

  const presetSelect = select(PRESETS, tuningKey, (v) => {
    tuningKey = v;
    customRow.classList.toggle('hidden', v !== 'custom');
    renderTargets(null);
    app.settings.set('tuning', v);
  }, 'Tuning preset');

  const startBtn = el('button', { type: 'button', text: 'Start', onClick: () => (running ? stop() : start()) });

  container.append(
    el('h2', { text: 'Tuner' }),
    el('div', { class: 'panel' },
      el('div', { class: 'row' }, presetSelect, startBtn),
      customRow,
      readout,
      needleWrap,
      el('p', { class: 'muted small', text: 'Wired headphones are recommended so the microphone hears only your banjo.' }),
    ),
    el('h3', { text: 'Target strings and reference tones' }),
    targetWrap,
  );

  (async () => {
    tuningKey = await app.settings.get('tuning', tuningKey);
    presetSelect.value = tuningKey;
    customRow.classList.toggle('hidden', tuningKey !== 'custom');
  })();
  renderTargets(null);
  renderNeedle(0);

  return {
    unmount() {
      cancelAnimationFrame(rafId);
      if (running) stop();
    },
  };
}
