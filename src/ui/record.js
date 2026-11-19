// Record view (build plan Steps 18-27, 43-45): microphone capture with device
// selection and level meter, calibration, timed assessment against the click
// (grid mode or tab mode), onset overlay with adjustable detection, waveform,
// report table, timeline, plain-language summary, and measure replay.

import { el, numberInput, select, slider } from './dom.js';
import {
  listInputDevices, startCapture, stopCapture, createLevelMeter, createRecorder,
  encodeWav, decodeWav,
} from '../audio/capture.js';
import { detectOnsets } from '../audio/onset.js';
import { computeCalibration, calibrationKey, jitterWarning } from '../audio/calibration.js';
import { scoreGrid, rollEvenness, summarizeTiming } from '../features/timing-report.js';
import { alignOnsets } from '../features/alignment.js';
import { loadRolls } from '../tab/library.js';
import { beatsPerMeasure } from '../tab/model.js';

const SUBDIVISIONS = [['1', 'Quarter notes'], ['2', 'Eighth notes'], ['3', 'Triplets'], ['4', 'Sixteenth notes']];

export function mountRecord(container, app) {
  let stream = null;
  let analyser = null;
  let meter = null;
  let meterRaf = 0;
  let recorder = null;
  let running = false;
  let runState = null; // { gridTimes, recStart, totalTicks, tickCount, unsub, expectedNotes }
  let lastTake = null; // { samples, sampleRate, report, mode }
  let onsetOptions = { sensitivity: 1.5, minIntervalMs: 60 };
  let cleanThresholdMs = 20;
  (async () => {
    onsetOptions.sensitivity = await app.settings.get('onsetSensitivity', 1.5);
    onsetOptions.minIntervalMs = await app.settings.get('onsetMinIntervalMs', 60);
    cleanThresholdMs = await app.settings.get('cleanThresholdMs', 20);
  })();
  let calibration = null;
  let exercises = [];

  // ---------- microphone panel ----------
  const deviceSelect = el('select', { 'aria-label': 'Input device' });
  const micBtn = el('button', {
    type: 'button', text: 'Enable microphone',
    onClick: async () => {
      try {
        const deviceId = deviceSelect.value || null;
        stream = await startCapture({ deviceId });
        await app.ensureAudio();
        const ctx = app.getCtx();
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        meter = createLevelMeter(analyser);
        micBtn.textContent = 'Microphone on';
        micBtn.disabled = true;
        await refreshDevices();
        await loadCalibration();
        startMeterLoop();
      } catch (err) {
        micStatus.textContent = `Microphone unavailable: ${err.message}`;
      }
    },
  });
  const micStatus = el('p', { class: 'muted small', text: 'The microphone is only requested when you press the button.' });
  const meterBar = el('div');
  const clipNote = el('span', { class: 'small', text: '' });

  async function refreshDevices() {
    try {
      const devices = await listInputDevices();
      const currentId = stream ? stream.getAudioTracks()[0].getSettings().deviceId : deviceSelect.value;
      deviceSelect.innerHTML = '';
      for (const d of devices) {
        deviceSelect.append(el('option', { value: d.deviceId, text: d.label, selected: d.deviceId === currentId }));
      }
      if (!devices.length) micStatus.textContent = 'No input devices found.';
    } catch { /* device listing not permitted yet */ }
  }

  function startMeterLoop() {
    const tick = () => {
      if (!meter) return;
      const { rms, peak, clipped } = meter.sample();
      meterBar.style.width = `${Math.min(100, Math.round(peak * 100))}%`;
      clipNote.textContent = clipped ? 'Clipping detected: lower the input level or move back.' : '';
      meterRaf = requestAnimationFrame(tick);
    };
    meterRaf = requestAnimationFrame(tick);
  }

  // ---------- calibration ----------
  const calBtn = el('button', {
    type: 'button', text: 'Calibrate',
    onClick: async () => {
      if (!stream) { calStatus.textContent = 'Enable the microphone first.'; return; }
      calStatus.textContent = 'Playing 16 clicks; play along over headphones...';
      await runCalibration();
    },
  });
  const calStatus = el('p', { class: 'muted small', text: 'No calibration for this device pair yet.' });

  async function loadCalibration() {
    const db = await app.getDb();
    const key = calibrationKey(deviceSelect.value, 'default');
    calibration = await db.get('calibrations', key);
    if (calibration) {
      calStatus.textContent = `Saved calibration: offset ${Math.round(calibration.offsetMs)} ms, jitter ${Math.round(calibration.jitterMs)} ms.`;
    }
  }

  async function runCalibration() {
    const ctx = await app.ensureAudio();
    const bpm = 60;
    app.scheduler.setBpm(bpm);
    app.scheduler.setSubdivision(1);
    app.scheduler.setMeter({ beatsPerBar: 4, beatValue: 4 });
    const clickTimes = [];
    const unsub = app.scheduler.subscribe((time, info) => {
      if (info.tick < 16) clickTimes.push(time);
    });
    app.metronome.arm({ countInBars: 0 });
    const recStart = ctx.currentTime + 0.1;
    recorder = await createRecorder(ctx, ctx.createMediaStreamSource(stream));
    recorder.start();
    app.scheduler.start();

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (clickTimes.length >= 16) { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 20000);
    });
    await new Promise((r) => setTimeout(r, 600));
    app.scheduler.stop();
    app.metronome.disarm();
    unsub();
    const take = await recorder.stop();
    recorder.dispose();
    recorder = null;

    const onsets = detectOnsets(take.samples, take.sampleRate, onsetOptions);
    const clickRel = clickTimes.map((t) => t - recStart);
    const result = computeCalibration(clickRel, onsets);
    if (result.matched < 8) {
      calStatus.textContent = `Only ${result.matched} of 16 clicks were detected. Check the input level and try again.`;
      return;
    }
    calibration = {
      id: calibrationKey(deviceSelect.value, 'default'),
      inputId: deviceSelect.value || 'default',
      outputId: 'default',
      offsetMs: result.offsetMs,
      jitterMs: result.jitterMs,
      matched: result.matched,
      at: new Date().toISOString(),
    };
    const db = await app.getDb();
    await db.put('calibrations', calibration);
    const warn = jitterWarning(result.jitterMs);
    calStatus.textContent = `Calibration saved: offset ${Math.round(result.offsetMs)} ms, jitter ${Math.round(result.jitterMs)} ms (${result.matched} clicks).`
      + (warn ? ` ${warn}` : '');
  }

  // ---------- assessment ----------
  const modeSelect = select([['grid', 'Grid mode (metronome clicks)'], ['tab', 'Tab mode (exercise notes)']],
    'grid', (v) => { mode = v; exerciseField.classList.toggle('hidden', v !== 'tab'); }, 'Mode');
  let mode = 'grid';

  const exerciseSelect = el('select', { 'aria-label': 'Exercise for tab mode' });
  const exerciseField = el('label', { class: 'field hidden' }, el('span', { text: 'Exercise' }), exerciseSelect);

  async function loadExercises() {
    exercises = await loadRolls();
    const db = await app.getDb();
    exercises = exercises.concat(await db.getAll('tabs'));
    exerciseSelect.innerHTML = '';
    for (const t of exercises) exerciseSelect.append(el('option', { value: t.id, text: t.title }));
  }

  const bpmInput = numberInput(60, { min: 30, max: 240, label: 'Assessment BPM' });
  const subdivSelect = select(SUBDIVISIONS, '2', (v) => { subdivision = parseInt(v, 10); }, 'Subdivision');
  let subdivision = 2;
  const barsInput = numberInput(4, { min: 1, max: 32, label: 'Bars to record' });
  const countInSelect = select([['1', 'Count-in 1 bar'], ['2', 'Count-in 2 bars']], '1', (v) => { countInBars = parseInt(v, 10); }, 'Count-in');
  let countInBars = 1;

  const recordBtn = el('button', {
    type: 'button', text: 'Record assessment',
    onClick: () => (running ? stopRun() : startRun()),
  });
  const runStatus = el('p', { class: 'muted small', text: 'Not recording.' });

  async function startRun() {
    if (!stream) { runStatus.textContent = 'Enable the microphone first.'; return; }
    await app.ensureAudio();
    const ctx = app.getCtx();
    const bpm = bpmInput.valueAsNumber;
    const bars = barsInput.valueAsNumber;
    const beatsPerBar = mode === 'tab' && exerciseSelect.value
      ? (exercises.find((t) => t.id === exerciseSelect.value)?.timeSignature?.[0] || 4)
      : 4;

    app.scheduler.setBpm(bpm);
    app.scheduler.setSubdivision(subdivision);
    app.scheduler.setMeter({ beatsPerBar, beatValue: 4 });
    app.metronome.setVolume(0.7);
    app.metronome.arm({ countInBars });

    const recStart = ctx.currentTime + 0.15;
    recorder = await createRecorder(ctx, ctx.createMediaStreamSource(stream));
    recorder.start();

    const gridTimes = [];
    const totalTicks = (countInBars + bars) * beatsPerBar * subdivision;
    let ticks = 0;
    let expectedNotes = null;
    if (mode === 'tab') {
      const tab = exercises.find((t) => t.id === exerciseSelect.value);
      if (tab) {
        const beatDur = 60 / bpm;
        expectedNotes = tab.notes.map((n) => ({ ...n, time: recStart + n.startBeat * beatDur }));
      }
    }
    const unsub = app.scheduler.subscribe((time, info) => {
      ticks += 1;
      const isGrid = info.tick % subdivision === 0;
      if (info.tick >= countInBars * beatsPerBar * subdivision && isGrid) gridTimes.push(time);
      if (ticks >= totalTicks) stopRun();
    });
    runState = { gridTimes, recStart, unsub, expectedNotes, bpm };
    app.scheduler.start();
    running = true;
    recordBtn.textContent = 'Stop';
    runStatus.textContent = `Recording ${bars} bar(s) at ${bpm} BPM after a ${countInBars}-bar count-in.`;
  }

  async function stopRun() {
    if (!runState || !recorder) return;
    running = false;
    recordBtn.textContent = 'Record assessment';
    const state = runState;
    app.scheduler.stop();
    app.metronome.disarm();
    state.unsub();
    const take = await recorder.stop();
    recorder.dispose();
    recorder = null;
    runState = null;

    const onsets = detectOnsets(take.samples, take.sampleRate, onsetOptions);
    lastTake = { ...take, onsets, state };
    renderResults(onsets, state);
  }

  // ---------- results ----------
  const resultsWrap = el('div');
  const waveformCanvas = el('canvas', { width: 900, height: 120, class: 'panel' });

  function drawWaveform(samples, markers) {
    const c = waveformCanvas;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent') || '#2f5d50';
    g.beginPath();
    const step = Math.max(1, Math.floor(samples.length / c.width));
    for (let x = 0; x < c.width; x++) {
      let min = 1, max = -1;
      for (let i = x * step; i < (x + 1) * step && i < samples.length; i++) {
        if (samples[i] < min) min = samples[i];
        if (samples[i] > max) max = samples[i];
      }
      g.moveTo(x, 60 + min * 55);
      g.lineTo(x, 60 + max * 55);
    }
    g.stroke();
    g.fillStyle = getComputedStyle(document.body).getPropertyValue('--warn') || '#8a5a00';
    for (const t of markers) {
      const x = (t / lastTake.sampleRate) * (c.width / (samples.length / lastTake.sampleRate)) * (samples.length / lastTake.sampleRate) / (samples.length / lastTake.sampleRate);
      const px = (t / (samples.length / lastTake.sampleRate)) * c.width;
      g.fillRect(px, 4, 2, 12);
    }
  }

  function renderResults(onsets, state) {
    resultsWrap.innerHTML = '';
    const offsetMs = calibration ? calibration.offsetMs : 0;
    let report;
    let evenness = null;

    if (mode === 'tab' && state.expectedNotes) {
      const expectedTimes = state.expectedNotes.map((n) => n.time - state.recStart);
      const { matches, missed, extra } = alignOnsets(onsets, expectedTimes, { toleranceMs: 250 });
      const devs = matches.map((m) => m.deviationMs);
      const bias = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0;
      const std = devs.length > 1 ? Math.sqrt(devs.reduce((a, b) => a + (b - bias) ** 2, 0) / (devs.length - 1)) : 0;
      report = { notes: matches.map((m) => ({ ...m, gridIndex: m.expectedIndex })), deviationsMs: devs, biasMs: bias, stdMs: std, missed, extra };
      evenness = rollEvenness({ notes: state.expectedNotes }, matches, onsets);
    } else {
      const gridRel = state.gridTimes.map((t) => t - state.recStart);
      report = scoreGrid(onsets, gridRel, { offsetMs });
    }

    const summary = summarizeTiming({
      biasMs: report.biasMs,
      stdMs: report.stdMs,
      thumbStdMs: evenness ? evenness.thumbStdMs : null,
      fingerStdMs: evenness ? evenness.fingerStdMs : null,
      ioiSpreadMs: evenness ? evenness.ioiSpreadMs : null,
      cleanThresholdMs,
    });

    // report table
    const table = el('table');
    table.append(el('tr', {},
      el('th', { text: 'Note' }), el('th', { text: 'Expected (s)' }),
      el('th', { text: 'Deviation (ms)' }), el('th', { text: 'Early / late' })));
    (report.notes || []).forEach((n, i) => {
      const dev = n.deviationMs;
      table.append(el('tr', {},
        el('td', { text: String(i + 1) }),
        el('td', { class: 'mono', text: (state.expectedNotes ? state.expectedNotes[n.gridIndex]?.time - state.recStart : state.gridTimes[n.gridIndex] - state.recStart).toFixed(3) }),
        el('td', { class: 'mono', text: dev == null ? 'not detected' : (dev > 0 ? '+' : '') + dev.toFixed(1) }),
        el('td', { text: dev == null ? '' : dev < -1 ? 'early' : dev > 1 ? 'late' : 'on time' })));
    });

    // timeline
    const timeline = renderTimeline(report, state);

    resultsWrap.append(
      el('h3', { text: 'Report' }),
      el('p', { class: 'mono', text: `Bias ${report.biasMs.toFixed(1)} ms - consistency (standard deviation) ${report.stdMs.toFixed(1)} ms - missed ${report.missed ?? 0} - extra ${report.extra ?? 0}` }),
      el('p', { text: summary.text }),
      evenness ? el('p', { class: 'small muted', text: `Thumb notes spread: ${evenness.thumbStdMs == null ? 'n/a' : Math.round(evenness.thumbStdMs) + ' ms'} - index and middle: ${evenness.fingerStdMs == null ? 'n/a' : Math.round(evenness.fingerStdMs) + ' ms'} - inter-onset interval spread: ${evenness.ioiSpreadMs == null ? 'n/a' : Math.round(evenness.ioiSpreadMs) + ' ms'}` }) : null,
      waveformCanvas,
      timeline,
      table,
      el('div', { class: 'row' },
        el('button', { type: 'button', text: 'Save take', onClick: () => saveTake(report, summary) }),
        el('button', { type: 'button', class: 'secondary', text: 'Replay recording', onClick: () => replayTake() }),
      ),
      measureReplayRow(report, state),
    );
    drawWaveform(lastTake.samples, onsets);
  }

  function renderTimeline(report, state) {
    const width = 900;
    const height = 90;
    const notes = report.notes || [];
    const n = Math.max(1, notes.length);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Timing timeline">`];
    parts.push(`<line x1="20" y1="45" x2="${width - 20}" y2="45" stroke="currentColor" stroke-width="1"/>`);
    notes.forEach((note, i) => {
      const x = 20 + (i / n) * (width - 40);
      parts.push(`<line x1="${x}" y1="25" x2="${x}" y2="65" stroke="currentColor" stroke-width="1.5"/>`);
      if (note.deviationMs != null) {
        const dx = Math.max(-18, Math.min(18, note.deviationMs / 5));
        const mx = x + dx;
        const side = note.deviationMs < -1 ? 'early' : note.deviationMs > 1 ? 'late' : 'on time';
        parts.push(`<circle cx="${mx}" cy="${45 + (dx > 0 ? 12 : -12)}" r="4" fill="currentColor"/>`);
        parts.push(`<text x="${mx}" y="${45 + (dx > 0 ? 30 : -22)}" font-size="9" text-anchor="middle" fill="currentColor">${Math.round(note.deviationMs)}</text>`);
        if (i % 4 === 0) parts.push(`<text x="${x}" y="82" font-size="8" text-anchor="middle" fill="currentColor">${side}</text>`);
      } else {
        parts.push(`<text x="${x}" y="20" font-size="9" text-anchor="middle" fill="currentColor">missed</text>`);
      }
    });
    parts.push('</svg>');
    return el('div', { class: 'panel', html: parts.join('\n') });
  }

  function measureReplayRow(report, state) {
    const measures = Math.ceil((report.notes || []).length / (state.gridTimes.length / 4 || 1));
    const input = numberInput(1, { min: 1, max: Math.max(1, measures), label: 'Measure to replay' });
    return el('div', { class: 'row' },
      el('span', { class: 'small muted', text: 'Replay one measure of the recording:' }),
      input,
      el('button', {
        type: 'button', class: 'secondary', text: 'Loop measure',
        onClick: () => loopMeasure(input.valueAsNumber, state),
      }),
    );
  }

  let measureSource = null;
  async function loopMeasure(measureNumber, state) {
    if (!lastTake) return;
    const ctx = await app.ensureAudio();
    if (measureSource) { try { measureSource.stop(); } catch { /* stopped */ } }
    const sr = lastTake.sampleRate;
    const beatsPerBar = state.expectedNotes ? 4 : 4;
    const beatDur = 60 / state.bpm;
    const measureDur = beatsPerBar * beatDur;
    const startSample = Math.floor((measureNumber - 1) * measureDur * sr);
    const endSample = Math.min(lastTake.samples.length, Math.floor(measureNumber * measureDur * sr));
    if (startSample >= endSample) return;
    const slice = lastTake.samples.slice(startSample, endSample);
    const buf = ctx.createBuffer(1, slice.length, sr);
    buf.copyToChannel ? buf.copyToChannel(slice, 0) : buf.getChannelData(0).set(slice);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
    measureSource = src;
  }

  async function replayTake() {
    if (!lastTake) return;
    const ctx = await app.ensureAudio();
    const buf = ctx.createBuffer(1, lastTake.samples.length, lastTake.sampleRate);
    buf.copyToChannel ? buf.copyToChannel(lastTake.samples, 0) : buf.getChannelData(0).set(lastTake.samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  }

  async function saveTake(report, summary) {
    if (!lastTake) return;
    const db = await app.getDb();
    const blob = encodeWav(lastTake.samples, lastTake.sampleRate);
    const exerciseId = mode === 'tab' ? exerciseSelect.value : 'grid';
    const take = {
      id: `take:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      mode,
      exerciseId,
      bpm: bpmInput.valueAsNumber,
      subdivision,
      sampleRate: lastTake.sampleRate,
      recording: blob,
      report: {
        biasMs: report.biasMs, stdMs: report.stdMs,
        missed: report.missed ?? 0, extra: report.extra ?? 0,
        deviationsMs: report.deviationsMs,
      },
      summary: summary.text,
    };
    await db.put('takes', take);
    // retention: keep at most N takes per exercise (default 20)
    const cap = await app.settings.get('recordingsPerExercise', 20);
    const all = (await db.getAll('takes')).filter((t) => t.exerciseId === exerciseId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    while (all.length > cap) {
      const old = all.shift();
      await db.delete('takes', old.id);
    }
    await app.logPractice({
      type: 'assessment',
      title: mode === 'tab' ? (exercises.find((t) => t.id === exerciseId)?.title || 'Tab assessment') : 'Grid assessment',
      exerciseId,
      bpm: bpmInput.valueAsNumber,
      stats: { cleanBpm: report.stdMs <= 20 && (report.missed ?? 0) === 0 ? bpmInput.valueAsNumber : null, biasMs: report.biasMs, stdMs: report.stdMs },
    });
    runStatus.textContent = 'Take saved to this browser.';
  }

  // ---------- detection sliders ----------
  const sensSlider = slider({
    min: 0.5, max: 3, step: 0.1, value: onsetOptions.sensitivity,
    label: 'Onset sensitivity (higher detects fewer notes)',
    onInput: (v) => { onsetOptions.sensitivity = v; redetect(); },
  });
  const intervalSlider = slider({
    min: 20, max: 300, step: 10, value: onsetOptions.minIntervalMs,
    label: 'Minimum interval between detected notes (ms)',
    onInput: (v) => { onsetOptions.minIntervalMs = v; redetect(); },
  });

  function redetect() {
    if (!lastTake) return;
    const onsets = detectOnsets(lastTake.samples, lastTake.sampleRate, onsetOptions);
    lastTake.onsets = onsets;
    renderResults(onsets, lastTake.state);
  }

  // ---------- layout ----------
  container.append(
    el('h2', { text: 'Record and timing assessment' }),
    el('div', { class: 'panel' },
      el('h3', { text: 'Microphone' }),
      el('div', { class: 'row' }, deviceSelect, micBtn),
      el('div', { class: 'meter' }, meterBar),
      clipNote,
      micStatus,
    ),
    el('div', { class: 'panel' },
      el('h3', { text: 'Calibration' }),
      el('div', { class: 'row' }, calBtn),
      calStatus,
      el('p', { class: 'muted small', text: 'Play 16 clicks over wired headphones along with the app. The mean offset and jitter are saved per device pair. Deviations in reports are corrected by the saved offset.' }),
    ),
    el('div', { class: 'panel' },
      el('h3', { text: 'Assessment' }),
      el('div', { class: 'row' }, modeSelect, exerciseField, bpmInput, subdivSelect, barsInput, countInSelect),
      el('div', { class: 'row' }, recordBtn),
      runStatus,
      el('div', { class: 'row' }, sensSlider.root, intervalSlider.root),
    ),
    resultsWrap,
  );

  loadExercises();
  refreshDevices();
  deviceSelect.addEventListener('change', loadCalibration);

  return {
    unmount() {
      if (running) stopRun();
      cancelAnimationFrame(meterRaf);
      if (stream) stopCapture(stream);
    },
    onKey(e) {
      if (e.key === 'r' || e.key === 'R') {
        if (running) stopRun(); else startRun();
        return true;
      }
      return false;
    },
  };
}
