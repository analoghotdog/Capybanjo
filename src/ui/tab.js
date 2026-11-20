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
import { sliceSamples, entriesInRange } from '../audio/recorder-core.js';
import { alignOnsets } from '../features/alignment.js';
import { rollEvenness, summarizeTiming } from '../features/timing-report.js';

export function mountTab(container, app) {
  let tabs = []; // { tab, origin: 'roll'|'import' }
  let current = null;
  let playing = false;
  let rafId = 0;
  let passUnsub = null;
  let assessment = null; // { stream, recorder, origin } — one long-lived session
  let passStartCtx = null;
  let assessmentOn = false;
  let trainer = null;
  let loop = { startMeasure: 0, endMeasure: measureCount({ timeSignature: [4, 4], notes: [] }) };
  let beatsPlayed = 0;
  let regionBeats = 0;
  let cleanups = [];
  let routineStepStartedAt = 0;
  let trainerRoutineId = null;

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
      const routineStep = app.activeRoutine?.steps?.[app.activeRoutine.index];
      const pendingId = app.pendingTabId || (routineStep && routineStep.exerciseId);
      const pending = tabs.find((t) => t.tab.id === pendingId);
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
    const measures = Math.max(1, measureCount(tab));
    const step = app.activeRoutine?.steps?.[app.activeRoutine.index];
    const startMeasure = Math.min(measures - 1, Math.max(0, step?.startMeasure ?? 0));
    const endMeasure = Math.min(measures - 1, Math.max(startMeasure, step?.endMeasure ?? measures - 1));
    loop = { startMeasure, endMeasure };
    loopStart.value = loop.startMeasure + 1;
    loopEnd.value = loop.endMeasure + 1;
    loopStart.max = measures;
    loopEnd.max = measures;
    routineStepStartedAt = Date.now();
    const speedSettings = app.activeRoutine?.speedSettings;
    if (speedSettings && trainerRoutineId !== app.activeRoutine.id) {
      startBpmInput.value = speedSettings.startBpm;
      targetBpmInput.value = speedSettings.targetBpm;
      stepInput.value = speedSettings.step;
      requiredCleanInput.value = speedSettings.requiredClean;
      buildTrainer();
      trainerRoutineId = app.activeRoutine.id;
    }
    draw();
    updatePlayStringRow();
    updateRoutinePanel();
  }

  // ---- transport ----
  async function startPlayback() {
    if (!current) return;
    await app.ensureAudio();
    const routineStep = app.activeRoutine?.steps?.[app.activeRoutine.index];
    const drillBpm = routineStep?.bpm && trainer ? trainer.getState().bpm : routineStep?.bpm;
    const bpm = drillBpm || current.tempoHint || (await app.settings.get('bpm', 100));
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

    // Track loop windows from scheduled beat times (audio clock).
    passStartCtx = null;
    passUnsub = app.scheduler.subscribe((time, info) => {
      if (!info.isBeat) return;
      const tickCountIn = countInBars * info.beatsPerBar;
      if (info.tick < tickCountIn) return;
      if (passStartCtx == null) { passStartCtx = time; beatsPlayed = 0; return; }
      beatsPlayed += 1;
      if (beatsPlayed % regionBeats === 0) {
        const passEnd = time;
        if (assessmentOn && assessment) judgeLoop(passStartCtx, passEnd);
        passStartCtx = passEnd;
      }
    });

    // One long-lived recording session covers all loops (see setupAssessment).
    if (assessmentOn && !assessment) await setupAssessment();
  }

  function stopPlayback() {
    app.scheduler.stop();
    app.player.stop();
    app.metronome.disarm();
    if (passUnsub) { passUnsub(); passUnsub = null; }
    // The assessment recorder keeps running: it spans the whole practice
    // session and is only closed when assessment is switched off or the view
    // unmounts.
    playing = false;
    playBtn.textContent = 'Play';
    const g = svgWrap.querySelector('.tab-cursor');
    if (g) g.setAttribute('visibility', 'hidden');
  }

  /** Open the microphone and recorder once for the whole practice session. */
  async function setupAssessment() {
    if (assessment) return;
    try {
      const { startCapture, recordingOrigin } = await import('../audio/capture.js');
      const stream = await startCapture({ deviceId: await app.settings.get('inputDeviceId', null) });
      const ctx = await app.ensureAudio();
      const source = ctx.createMediaStreamSource(stream);
      // Measured origin; the recorder then runs continuously and each loop is
      // judged from a slice of the buffer.
      const { recorder: rec, originSec } = await recordingOrigin(ctx, source, {
        maxSamples: 10 * 60 * ctx.sampleRate, // bound memory at ~10 minutes
      });
      rec._stream = stream;
      assessment = { stream, recorder: rec, origin: originSec };
    } catch (err) {
      console.error('assessment recording failed', err);
      assessmentToggle.checked = false;
      assessmentOn = false;
    }
  }

  async function teardownAssessment() {
    if (!assessment) return;
    const { stopCapture } = await import('../audio/capture.js');
    try { await assessment.recorder.stop(); } catch { /* already stopped */ }
    assessment.recorder.dispose();
    stopCapture(assessment.stream);
    assessment = null;
  }

  /** Judge one completed loop from its slice of the continuous recording. */
  function judgeLoop(passStart, passEnd) {
    if (!assessment || !current) return;
    const { samples, sampleRate } = assessment.recorder.snapshot();
    const slice = sliceSamples(samples, sampleRate, assessment.origin, passStart, passEnd);
    // Expected notes of this loop: scheduled times within the loop window.
    const expected = entriesInRange(app.player.cursorQueue(), passStart, passEnd);
    const expectedTimes = expected.map((e) => e.time - passStart);
    const analysis = analyzeTake({ samples: slice.samples, sampleRate }, expectedTimes);
    judgePass(analysis);
  }

  function analyzeTake(take, expectedTimes) {
    const settings = {
      sensitivity: 1.5,
      minIntervalMs: 60,
    };
    const onsets = detectOnsets(take.samples, take.sampleRate, settings);
    const { matches, missed, extra } = alignOnsets(onsets, expectedTimes);
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

  function updateRoutinePanel() {
    const routine = app.activeRoutine;
    if (!routine || !routine.steps.length) {
      routinePanel.hidden = true;
      picker.disabled = false;
      return;
    }
    const step = routine.steps[routine.index];
    routinePanel.hidden = false;
    picker.disabled = true;
    routineNextButton.disabled = false;
    routineCancelButton.hidden = false;
    routineStatus.textContent =
      `${routine.name} - step ${routine.index + 1} of ${routine.steps.length}. ` +
      `Measures ${step.startMeasure + 1}-${step.endMeasure + 1}; press Next when ready.`;
    routineNextButton.textContent = routine.index === routine.steps.length - 1 ? 'Complete routine' : 'Next section';
  }

  async function logRoutineStep() {
    const routine = app.activeRoutine;
    if (!routine || !current) return;
    const step = routine.steps[routine.index];
    await app.logPractice({
      type: 'routine',
      title: current.title,
      exerciseId: current.id,
      bpm: step.bpm || current.tempoHint || null,
      durationMs: Math.max(0, Date.now() - routineStepStartedAt),
      stats: {
        routineName: routine.name,
        step: routine.index + 1,
        stepCount: routine.steps.length,
      },
    });
  }

  async function advanceRoutine() {
    const routine = app.activeRoutine;
    if (!routine) return;
    if (playing) stopPlayback();
    const nextIndex = routine.index + 1;
    const next = routine.steps[nextIndex];
    const exercise = next && tabs.find(({ tab }) => tab.id === next.exerciseId)?.tab;
    if (next && !exercise) {
      routineStatus.textContent = 'The next exercise is missing. Cancel the routine or restore that tab from a backup.';
      return;
    }
    try {
      await logRoutineStep();
    } catch (err) {
      routineStatus.textContent = `Could not log this step: ${err.message}`;
      console.error('routine step logging failed', err);
      return;
    }
    if (routine.index === routine.steps.length - 1) {
      app.activeRoutine = null;
      trainer = null;
      trainerRoutineId = null;
      routineStatus.textContent = 'Routine complete. Your practice was logged.';
      routinePanel.hidden = false;
      picker.disabled = false;
      routineNextButton.disabled = true;
      routineCancelButton.hidden = true;
      return;
    }
    routine.index = nextIndex;
    selectTab(exercise);
  }

  function cancelRoutine() {
    if (playing) stopPlayback();
    app.activeRoutine = null;
    trainer = null;
    trainerRoutineId = null;
    updateRoutinePanel();
  }

  // ---- controls ----
  const playBtn = el('button', {
    type: 'button',
    text: 'Play',
    onClick: () => (playing ? stopPlayback() : startPlayback()),
  });

  const routineStatus = el('p', { class: 'small', text: '' });
  const routineNextButton = el('button', {
    type: 'button', text: 'Next section', onClick: advanceRoutine,
  });
  const routineCancelButton = el('button', {
    type: 'button', class: 'secondary', text: 'Cancel routine', onClick: cancelRoutine,
  });
  const routinePanel = el('div', { class: 'panel', hidden: true },
    el('h3', { text: 'Routine in progress' }),
    routineStatus,
    el('div', { class: 'row' }, routineNextButton, routineCancelButton),
  );

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
    onInput: (v) => {
      const startMeasure = v - 1;
      loop = {
        startMeasure,
        endMeasure: Math.max(startMeasure, loop.endMeasure),
      };
      loopStart.value = loop.startMeasure + 1;
      loopEnd.value = loop.endMeasure + 1;
      const step = app.activeRoutine?.steps?.[app.activeRoutine.index];
      if (step) step.startMeasure = loop.startMeasure;
      if (step) step.endMeasure = loop.endMeasure;
      app.player.setLoop(loop);
      updateRoutinePanel();
    },
  });
  const loopEnd = numberInput(1, {
    min: 1, max: 999, label: 'Loop end measure',
    onInput: (v) => {
      const endMeasure = v - 1;
      loop = {
        startMeasure: Math.min(loop.startMeasure, endMeasure),
        endMeasure,
      };
      loopStart.value = loop.startMeasure + 1;
      loopEnd.value = loop.endMeasure + 1;
      const step = app.activeRoutine?.steps?.[app.activeRoutine.index];
      if (step) step.startMeasure = loop.startMeasure;
      if (step) step.endMeasure = loop.endMeasure;
      app.player.setLoop(loop);
      updateRoutinePanel();
    },
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
  const trainerSettings = el('div', { class: 'row' },
    el('label', { class: 'field' },
      el('span', { text: 'Start BPM' }),
      startBpmInput,
      el('span', { class: 'muted small', text: 'Tempo to begin practicing at.' }),
    ),
    el('label', { class: 'field' },
      el('span', { text: 'Target BPM' }),
      targetBpmInput,
      el('span', { class: 'muted small', text: 'Goal tempo; the trainer finishes here.' }),
    ),
    el('label', { class: 'field' },
      el('span', { text: 'Step (BPM)' }),
      stepInput,
      el('span', { class: 'muted small', text: 'Tempo increase after enough clean passes.' }),
    ),
    el('label', { class: 'field' },
      el('span', { text: 'Clean passes per step' }),
      requiredCleanInput,
      el('span', { class: 'muted small', text: 'Consecutive clean loops needed to increase tempo.' }),
    ),
  );
  const assessmentCheckbox = el('input', {
    type: 'checkbox', id: 'assessment-on',
    onChange: (e) => {
      assessmentOn = e.target.checked;
      if (assessmentOn) setupAssessment();
      else teardownAssessment();
    },
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
    trainerSettings,
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
    routinePanel,
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
      teardownAssessment();
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
