// Tab view (build plan Steps 12-16, 36, 42-43): exercise picker (roll library +
// imported tabs), SVG rendering with playback cursor, Play/Stop with count-in
// and loop region, independent click/tab volumes, per-string test tones, and
// the speed trainer with optional automatic clean-pass detection.

import { el, numberInput, select, slider } from './dom.js';
import { loadRolls } from '../tab/library.js';
import { renderTabSvg, tabLayout, cursorRect } from '../tab/render.js';
import { stringFretToFreq, resolveTuning, beatsPerMeasure, measureCount } from '../tab/model.js';
import { playNote } from '../audio/synth.js';
import { createSpeedTrainer } from '../features/speed-trainer.js';
import { detectOnsets } from '../audio/onset.js';
import { alignOnsets } from '../features/alignment.js';
import { rollEvenness, summarizeTiming } from '../features/timing-report.js';

export function mountTab(container, app) {
  let tabs = []; // { tab, origin: 'roll'|'import' }
  let current = null;
  let playing = false;
  let rafId = 0;
  let passUnsub = null;
  let recorder = null;
  let recStartCtxTime = 0;
  let assessmentOn = false;
  let trainer = null;
  let loop = { startMeasure: 0, endMeasure: measureCount({ timeSignature: [4, 4], notes: [] }) };
  let beatsPlayed = 0;
  let regionBeats = 0;
  let cleanups = [];

  // ---- exercise picker ----
  const picker = el('select', {
    'aria-label': 'Exercise',
    onChange: (e) => {
      const found = tabs.find((t) => t.tab.id === e.target.value);
      if (found) selectTab(found.tab);
    },
  });

  async function refreshPicker() {
    const rolls = await loadRolls();
    const db = await app.getDb();
    const imported = await db.getAll('tabs');
    tabs = [
      ...rolls.map((t) => ({ tab: t, origin: 'roll' })),
      ...imported.map((t) => ({ tab: t, origin: 'import' })),
    ];
    picker.innerHTML = '';
    const groups = [
      ['Roll library', tabs.filter((t) => t.origin === 'roll')],
      ['Imported tabs', tabs.filter((t) => t.origin === 'import')],
    ];
    for (const [label, items] of groups) {
      if (!items.length) continue;
      const og = el('optgroup', { label });
      for (const it of items) og.append(el('option', { value: it.tab.id, text: it.tab.title }));
      picker.append(og);
    }
    if (tabs.length) {
      const pending = tabs.find((t) => t.tab.id === app.pendingTabId);
      if (pending) {
        app.pendingTabId = null;
        selectTab(pending.tab);
        return;
      }
      selectTab(tabs[0].tab);
    }
  }

  // ---- rendering + cursor ----
  const svgWrap = el('div', { class: 'panel', html: '' });
  let layout = null;
  let measuresPerLine = 4;
  let large = true;

  function draw() {
    if (!current) return;
    svgWrap.innerHTML = renderTabSvg(current, { measuresPerLine, large });
    layout = tabLayout(current, { measuresPerLine, large });
  }

  function moveCursor() {
    const rect = svgWrap.querySelector('#tab-cursor-rect');
    if (!rect || !playing) return;
    const entry = app.player.currentNote(app.getCtx().currentTime);
    const g = svgWrap.querySelector('.tab-cursor');
    if (!entry || !layout) {
      if (g) g.setAttribute('visibility', 'hidden');
      return;
    }
    const sys = layout.systems.find((s) => s.notes.some((n) => n.note === entry.note));
    const pos = sys && sys.notes.find((n) => n.note === entry.note);
    if (!pos) return;
    const box = cursorRect(pos, layout);
    rect.setAttribute('x', box.x);
    rect.setAttribute('y', (sys ? sys.y + 20 : 0) + box.y);
    rect.setAttribute('width', box.width);
    rect.setAttribute('height', box.height);
    g.setAttribute('visibility', 'visible');
  }

  function tick() {
    moveCursor();
    updateTrainerPanel();
    rafId = requestAnimationFrame(tick);
  }

  function selectTab(tab) {
    current = tab;
    picker.value = tab.id;
    loop = { startMeasure: 0, endMeasure: Math.max(0, measureCount(tab) - 1) };
    loopStart.value = loop.startMeasure + 1;
    loopEnd.value = loop.endMeasure + 1;
    draw();
    updatePlayStringRow();
  }

  // ---- transport ----
  async function startPlayback() {
    if (!current) return;
    await app.ensureAudio();
    const bpm = current.tempoHint || (await app.settings.get('bpm', 100));
    const ts = current.timeSignature;
    app.scheduler.setBpm(bpm);
    app.scheduler.setSubdivision(1);
    app.scheduler.setMeter({ beatsPerBar: ts[0], beatValue: ts[1] });
    bpmLabel.textContent = `Playback BPM: ${bpm}`;

    beatsPlayed = 0;
    const bpmMeasure = beatsPerMeasure(current.timeSignature);
    regionBeats = (loop.endMeasure - loop.startMeasure + 1) * bpmMeasure;
    const countInBars = clickOn ? countInValue : 0;

    app.player.play(current, {
      countInBars,
      loop,
      beatsPerBar: ts[0],
    });
    if (clickOn) {
      app.metronome.setVolume(clickVol);
      app.metronome.setMuted(clickMuted);
      app.metronome.arm({ countInBars });
    }
    app.player.setVolume(tabVol);
    app.player.setMuted(tabMuted);
    app.scheduler.start();
    playing = true;
    playBtn.textContent = 'Stop';

    // count beats to detect pass (one loop region) completion
    passUnsub = app.scheduler.subscribe((time, info) => {
      if (!info.isBeat) return;
      const tickCountIn = countInBars * info.beatsPerBar;
      if (info.tick < tickCountIn) return;
      beatsPlayed += 1;
      if (beatsPlayed % regionBeats === 0) onPassComplete();
    });

    if (assessmentOn) await startPassRecording();
  }

  function stopPlayback() {
    app.scheduler.stop();
    app.player.stop();
    app.metronome.disarm();
    if (passUnsub) { passUnsub(); passUnsub = null; }
    if (recorder) { recorder.dispose(); recorder = null; }
    playing = false;
    playBtn.textContent = 'Play';
    const g = svgWrap.querySelector('.tab-cursor');
    if (g) g.setAttribute('visibility', 'hidden');
  }

  async function startPassRecording() {
    try {
      const { startCapture, createRecorder, stopCapture } = await import('../audio/capture.js');
      const stream = await startCapture({ deviceId: await app.settings.get('inputDeviceId', null) });
      const ctx = await app.ensureAudio();
      const source = ctx.createMediaStreamSource(stream);
      recorder = await createRecorder(ctx, source);
      recorder._stream = stream;
      recStartCtxTime = ctx.currentTime + 0.05;
      recorder.start();
    } catch (err) {
      console.error('assessment recording failed', err);
      assessmentToggle.checked = false;
      assessmentOn = false;
    }
  }

  async function onPassComplete() {
    if (!assessmentOn || !recorder || !current) return;
    const rec = recorder;
    const startedAt = recStartCtxTime;
    const { stopCapture } = await import('../audio/capture.js');
    const take = await rec.stop();
    if (rec._stream) stopCapture(rec._stream);
    rec.dispose();
    recorder = null;

    // expected note times for the finished pass, in recording time base
    const expectedTimes = app.player.cursorQueue()
      .filter((e) => e.time >= startedAt)
      .map((e) => e.time - startedAt);
    const analysis = analyzeTake(take, expectedTimes);
    judgePass(analysis);

    if (playing) await startPassRecording();
  }

  function analyzeTake(take, expectedTimes) {
    const settings = {
      sensitivity: 1.5,
      minIntervalMs: 60,
    };
    const onsets = detectOnsets(take.samples, take.sampleRate, settings);
    const { matches, missed, extra } = alignOnsets(onsets, expectedTimes, { toleranceMs: 250 });
    const deviations = matches.map((m) => m.deviationMs);
    const mean = deviations.length ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0;
    const std = deviations.length > 1
      ? Math.sqrt(deviations.reduce((a, b, i) => a + (b - mean) ** 2, 0) / (deviations.length - 1))
      : 0;
    return { onsets, matches, missed, extra, biasMs: mean, stdMs: std };
  }

  async function judgePass(analysis) {
    const cleanThresholdMs = await app.settings.get('cleanThresholdMs', 20);
    const clean = analysis.missed.length === 0
      && analysis.extra.length <= 2
      && analysis.stdMs <= cleanThresholdMs;
    if (trainer) {
      if (clean) trainer.pass(); else trainer.fail();
      const state = trainer.getState();
      app.scheduler.setBpm(state.bpm);
      bpmLabel.textContent = `Speed trainer BPM: ${state.bpm}`;
      if (clean && state.phase === 'done') {
        app.logPractice({
          type: 'speed',
          title: current.title,
          exerciseId: current.id,
          bpm: state.bpm,
          stats: { cleanBpm: state.bestBpm },
        });
      }
    }
    lastPassResult.textContent = clean
      ? `Pass judged clean (consistency ${Math.round(analysis.stdMs)} ms).`
      : `Pass not clean: ${analysis.missed.length} missed, ${analysis.extra.length} extra, consistency ${Math.round(analysis.stdMs)} ms.`;
  }

  // ---- controls ----
  const playBtn = el('button', {
    type: 'button',
    text: 'Play',
    onClick: () => (playing ? stopPlayback() : startPlayback()),
  });

  const clickOn = true;
  let clickVol = 0.7, clickMuted = false, tabVol = 0.8, tabMuted = false;
  let countInValue = 1;

  const countInSelect = select([['0', 'Count-in off'], ['1', 'Count-in 1 bar'], ['2', 'Count-in 2 bars']],
    '1', (v) => { countInValue = parseInt(v, 10); }, 'Count-in');

  const clickVolume = slider({
    min: 0, max: 1, step: 0.05, value: clickVol, label: 'Click volume',
    onInput: (v) => { clickVol = v; app.metronome.setVolume(v); },
  });
  const tabVolume = slider({
    min: 0, max: 1, step: 0.05, value: tabVol, label: 'Tab volume',
    onInput: (v) => { tabVol = v; app.player.setVolume(v); },
  });
  const clickMuteBtn = el('button', {
    type: 'button', class: 'secondary', text: 'Mute click',
    onClick: () => {
      clickMuted = !clickMuted;
      app.metronome.setMuted(clickMuted);
      clickMuteBtn.textContent = clickMuted ? 'Unmute click' : 'Mute click';
    },
  });
  const tabMuteBtn = el('button', {
    type: 'button', class: 'secondary', text: 'Mute tab',
    onClick: () => {
      tabMuted = !tabMuted;
      app.player.setMuted(tabMuted);
      tabMuteBtn.textContent = tabMuted ? 'Unmute tab' : 'Mute tab';
    },
  });

  const loopStart = numberInput(1, {
    min: 1, max: 999, label: 'Loop start measure',
    onInput: (v) => { loop = { ...loop, startMeasure: v - 1 }; app.player.setLoop(loop); },
  });
  const loopEnd = numberInput(1, {
    min: 1, max: 999, label: 'Loop end measure',
    onInput: (v) => { loop = { ...loop, endMeasure: v - 1 }; app.player.setLoop(loop); },
  });

  const playStringRow = el('div', { class: 'row' });
  function updatePlayStringRow() {
    playStringRow.innerHTML = '';
    if (!current) return;
    playStringRow.append(el('span', { class: 'muted small', text: 'Test strings:' }));
    for (const s of [5, 4, 3, 2, 1]) {
      playStringRow.append(el('button', {
        type: 'button', class: 'secondary',
        text: `String ${s}`,
        onClick: async () => {
          const ctx = await app.ensureAudio();
          const freq = stringFretToFreq(resolveTuning(current.tuning), s, 0);
          playNote(ctx, freq, ctx.currentTime + 0.02, 0.8);
        },
      }));
    }
  }

  // ---- speed trainer ----
  const trainerPanel = el('div', { class: 'panel' });
  const bpmLabel = el('p', { class: 'mono small', text: '' });
  const lastPassResult = el('p', { class: 'small', text: '' });

  const startBpmInput = numberInput(40, { min: 30, max: 240, label: 'Start BPM' });
  const targetBpmInput = numberInput(80, { min: 30, max: 240, label: 'Target BPM' });
  const stepInput = numberInput(5, { min: 1, max: 50, label: 'Step' });
  const requiredCleanInput = numberInput(2, { min: 1, max: 10, label: 'Clean passes per step' });
  const assessmentCheckbox = el('input', {
    type: 'checkbox', id: 'assessment-on',
    onChange: (e) => { assessmentOn = e.target.checked; },
  });

  function buildTrainer() {
    trainer = createSpeedTrainer({
      startBpm: startBpmInput.valueAsNumber,
      targetBpm: targetBpmInput.valueAsNumber,
      step: stepInput.valueAsNumber,
      requiredClean: requiredCleanInput.valueAsNumber,
    });
    if (playing) app.scheduler.setBpm(trainer.getState().bpm);
  }

  function updateTrainerPanel() {
    if (!trainer) return;
    const s = trainer.getState();
    let text = `BPM ${Math.round(s.bpm)} - clean in a row: ${s.cleanCount} - attempts at this speed: ${s.attemptsAtBpm}`;
    if (s.phase === 'offerDrop') {
      dropRow.classList.remove('hidden');
      text += ' - maximum attempts reached; a slower step is offered.';
    } else {
      dropRow.classList.add('hidden');
    }
    if (s.phase === 'done') text += ` - finished. Best clean speed: ${Math.round(s.bestBpm)} BPM.`;
    trainerStatus.textContent = text;
  }

  const dropRow = el('div', { class: 'row hidden' },
    el('button', {
      type: 'button', text: 'Drop one step',
      onClick: () => { trainer.acceptDrop(); if (playing) app.scheduler.setBpm(trainer.getState().bpm); },
    }),
    el('button', {
      type: 'button', class: 'secondary', text: 'Keep this speed',
      onClick: () => { trainer.declineDrop(); },
    }),
  );
  const trainerStatus = el('p', { class: 'small mono', text: 'Not running.' });

  const manualPassBtn = el('button', {
    type: 'button', class: 'secondary', text: 'That was clean',
    onClick: () => { if (!trainer) buildTrainer(); trainer.pass(); if (playing) app.scheduler.setBpm(trainer.getState().bpm); },
  });
  const manualFailBtn = el('button', {
    type: 'button', class: 'secondary', text: 'Not clean',
    onClick: () => { if (!trainer) buildTrainer(); trainer.fail(); if (playing) app.scheduler.setBpm(trainer.getState().bpm); },
  });

  trainerPanel.append(
    el('h3', { text: 'Speed trainer' }),
    el('div', { class: 'row' }, startBpmInput, targetBpmInput, stepInput, requiredCleanInput),
    el('div', { class: 'row' },
      el('button', { type: 'button', text: 'Configure / restart', onClick: buildTrainer }),
      manualPassBtn, manualFailBtn,
    ),
    el('label', { class: 'row' }, assessmentCheckbox,
      el('span', { text: 'Judge passes automatically with the microphone (assessment)' })),
    dropRow,
    trainerStatus,
    lastPassResult,
    bpmLabel,
    el('p', { class: 'muted small', text: 'With assessment on, each loop of the exercise is recorded and judged: clean means all expected notes detected with consistency within the clean threshold (Settings).' }),
  );

  // ---- layout ----
  container.append(
    el('h2', { text: 'Tab playback' }),
    el('div', { class: 'panel' },
      el('div', { class: 'row' }, picker, playBtn, countInSelect),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, el('span', { text: 'Loop start measure' }), loopStart),
        el('label', { class: 'field' }, el('span', { text: 'Loop end measure' }), loopEnd),
      ),
      svgWrap,
      playStringRow,
    ),
    el('div', { class: 'panel' },
      el('h3', { text: 'Mix' }),
      el('div', { class: 'row' }, clickVolume.root, tabVolume.root, clickMuteBtn, tabMuteBtn),
    ),
    trainerPanel,
  );

  refreshPicker();
  rafId = requestAnimationFrame(tick);
  cleanups.push(() => cancelAnimationFrame(rafId));
  cleanups.push(app.bus.on('settings-changed', async ({ key }) => {
    if (key === 'measuresPerLine' || key === 'largeTab') {
      measuresPerLine = await app.settings.get('measuresPerLine', 4);
      large = await app.settings.get('largeTab', true);
      draw();
    }
  }));
  (async () => {
    measuresPerLine = await app.settings.get('measuresPerLine', 4);
    large = await app.settings.get('largeTab', true);
    draw();
  })();

  return {
    unmount() {
      if (playing) stopPlayback();
      for (const fn of cleanups) fn();
    },
    onKey(e) {
      if (e.key === ' ') {
        if (playing) stopPlayback(); else startPlayback();
        return true;
      }
      return false;
    },
  };
}
