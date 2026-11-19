// Chords view (build plan Steps 49-50): chord diagrams from the chord data and
// a chord-change drill prompted by the metronome, with optional microphone
// confirmation using the pitch module.

import { el, numberInput, select } from './dom.js';
import { OPEN_G_CHORDS, renderChordDiagram, createChordDrill, isChordRootPitch } from '../features/chords.js';
import { detectPitchYIN } from '../audio/pitch.js';

export function mountChords(container, app) {
  let chosen = ['G', 'C'];
  let beatsPerChord = 4;
  let bars = 8;
  let micConfirm = false;
  let drill = null;
  let running = false;
  let unsub = null;
  let analyser = null;
  let micBuf = null;
  let rafId = 0;
  const heard = new Map(); // chordKey -> { hits, misses }

  // ---- diagrams ----
  const diagramRow = el('div', { class: 'grid-2' });
  function renderDiagrams() {
    diagramRow.innerHTML = '';
    for (const c of OPEN_G_CHORDS) {
      const card = el('div', { class: 'panel' });
      card.innerHTML = renderChordDiagram(c, { size: 120 });
      card.append(el('p', { class: 'small muted', text: 'String 5 is the short string. Shapes are data in src/features/chords.js; confirm them with your teacher.' }));
      diagramRow.append(card);
    }
  }

  // ---- drill config ----
  const chordChecks = el('div', { class: 'row' });
  for (const c of OPEN_G_CHORDS) {
    const cb = el('input', {
      type: 'checkbox', id: `chord-${c.key}`,
      checked: chosen.includes(c.key),
      onChange: (e) => {
        if (e.target.checked) chosen.push(c.key);
        else chosen = chosen.filter((k) => k !== c.key);
      },
    });
    chordChecks.append(el('label', { for: `chord-${c.key}` }, cb, c.name));
  }

  const beatsInput = numberInput(beatsPerChord, { min: 1, max: 16, label: 'Beats per chord', onInput: (v) => { beatsPerChord = v; } });
  const barsInput = numberInput(bars, { min: 1, max: 64, label: 'Bars', onInput: (v) => { bars = v; } });
  const micCheck = el('input', {
    type: 'checkbox', id: 'mic-confirm',
    onChange: (e) => { micConfirm = e.target.checked; },
  });

  const promptWrap = el('div', { class: 'panel' });
  const status = el('p', { class: 'muted small', text: 'Choose chords and press Start.' });

  const startBtn = el('button', {
    type: 'button', text: 'Start drill',
    onClick: () => (running ? stopDrill() : startDrill()),
  });

  async function startDrill() {
    if (chosen.length < 2) { status.textContent = 'Choose at least two chords.'; return; }
    await app.ensureAudio();
    drill = createChordDrill({ chords: chosen, beatsPerChord, bars });
    drill.start();
    app.scheduler.setBpm(await app.settings.get('bpm', 100));
    app.scheduler.setSubdivision(1);
    app.scheduler.setMeter({ beatsPerBar: 4, beatValue: 4 });
    app.metronome.arm({ countInBars: 0 });
    unsub = app.scheduler.subscribe((time, info) => {
      if (!info.isBeat) return;
      const step = drill.next();
      if (step.done) { stopDrill(); return; }
      renderPrompt(step);
    });
    if (micConfirm) await startMic();
    app.scheduler.start();
    running = true;
    startBtn.textContent = 'Stop drill';
    status.textContent = 'Follow the prompts on the beat.';
  }

  async function stopDrill() {
    running = false;
    app.scheduler.stop();
    app.metronome.disarm();
    if (unsub) { unsub(); unsub = null; }
    cancelAnimationFrame(rafId);
    if (analyser) analyser = null;
    startBtn.textContent = 'Start drill';
    const lines = [...heard.entries()].map(([k, v]) => `${k}: heard on ${v.hits} of ${v.hits + v.misses} changes`);
    status.textContent = 'Drill finished.' + (lines.length ? ` Microphone confirmation: ${lines.join('; ')}.` : '');
    if (heard.size) {
      app.logPractice({
        type: 'chords',
        title: `Chord changes: ${chosen.join(' - ')}`,
        bpm: await app.settings.get('bpm', 100),
        stats: Object.fromEntries([...heard.entries()].map(([k, v]) => [k, { hits: v.hits, misses: v.misses }])),
      });
    }
  }

  function renderPrompt(step) {
    promptWrap.innerHTML = '';
    promptWrap.append(
      el('p', { class: 'mono', text: `Now: ${step.chord.name}${step.changeNow ? ' - change next' : ''}` }),
      el('div', { class: 'row' }, el('div', { html: renderChordDiagram(step.chord, { size: 130 }) })),
      step.changeNow ? el('p', { class: 'small', text: `Coming up: ${step.nextChord.name}` }) : null,
    );
  }

  async function startMic() {
    try {
      const { startCapture } = await import('../audio/capture.js');
      const stream = await startCapture({ deviceId: await app.settings.get('inputDeviceId', null) });
      const ctx = app.getCtx();
      const source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      micBuf = new Float32Array(analyser.fftSize);
      checkPitchLoop();
    } catch {
      status.textContent = 'Microphone confirmation unavailable; the drill continues without it.';
      micConfirm = false;
    }
  }

  function checkPitchLoop() {
    if (!running || !analyser) return;
    analyser.getFloatTimeDomainData(micBuf);
    const { frequency } = detectPitchYIN(micBuf, app.getCtx().sampleRate);
    if (frequency && drill) {
      // Root pitch check only (within 30 cents): this confirms that the chord
      // root was played — it is deliberately not chord recognition.
      const current = promptWrap.querySelector('.mono');
      const name = current && /Now: (\w+)/.exec(current.textContent);
      if (name && isChordRootPitch(frequency, name[1], 30)) {
        if (!heard.has(name[1])) heard.set(name[1], { hits: 0, misses: 0 });
        if (!heard.get(name[1])._beat) {
          heard.get(name[1]).hits += 1;
          heard.get(name[1])._beat = true;
        }
      }
    }
    rafId = requestAnimationFrame(checkPitchLoop);
  }

  container.append(
    el('h2', { text: 'Chords' }),
    el('div', { class: 'panel' },
      el('h3', { text: 'Chord-change drill' }),
      chordChecks,
      el('div', { class: 'row' }, beatsInput, barsInput),
      el('label', { class: 'row' }, micCheck, el('span', { text: 'Confirm that the chord root was played (microphone pitch check of the root within 30 cents; not chord recognition)' })),
      el('div', { class: 'row' }, startBtn),
      status,
      promptWrap,
    ),
    el('h3', { text: 'Chord diagrams (open G tuning)' }),
    diagramRow,
    el('p', { class: 'muted small', text: 'Chord shapes are stored as editable data in src/features/chords.js. Teachers vary; confirm them against your own material.' }),
  );

  renderDiagrams();

  return {
    unmount() {
      if (running) stopDrill();
      cancelAnimationFrame(rafId);
    },
    onKey(e) {
      if (e.key === ' ') {
        if (running) stopDrill(); else startDrill();
        return true;
      }
      return false;
    },
  };
}
