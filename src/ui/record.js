// Record view (build plan Steps 18-27, 43-45): microphone capture with device
// selection and level meter, calibration, timed assessment against the click
// (grid mode or tab mode), onset overlay with adjustable detection, waveform,
// report table, timeline, plain-language summary, and measure replay.

import { el, numberInput, select, slider } from './dom.js';
import {
  listInputDevices, startCapture, stopCapture, createLevelMeter, recordingOrigin,
  encodeWav, decodeWav,
} from '../audio/capture.js';
import { toRecordingBase, shouldStopNow } from '../audio/recorder-core.js';
import { detectOnsets } from '../audio/onset.js';
import { computeSystemCalibration, computePlayerHabit, calibrationKey, jitterWarning, scoringOffsetMs } from '../audio/calibration.js';
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
  let runState = null; // { gridTimes, recStart, firstTickTime, unsub, expectedNotes, bpm }
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
  // Fix plan F7: system latency and the player's habitual offset are measured
  // separately. Option 2 (acoustic loopback) is the default until the owner
  // reports which option they prefer.
  let calMethod = 'loopback'; // 'playalong' | 'loopback' | 'both'
  const calMethodSelect = select([
    ['playalong', '1. Play-along only (bias figures are relative to your calibration)'],
    ['loopback', '2. Acoustic loopback (measures system latency; optional play-along check)'],
    ['both', '3. Both (loopback offset stored, play-along informational)'],
  ], calMethod, (v) => { calMethod = v; }, 'Calibration method');

  const calBtn = el('button', {
    type: 'button', text: 'Calibrate',
    onClick: async () => {
      if (!stream) { calStatus.textContent = 'Enable the microphone first.'; return; }
      if (calMethod === 'playalong') {
        calStatus.textContent = 'Playing 16 clicks; play along over headphones...';
        await runPlayAlong({ informational: false });
      } else {
        calStatus.textContent = 'Playing 16 clicks through the output. Do not play: the microphone should hear only the clicks (speakers, or headphones held against the microphone)...';
        await runLoopback();
        if (calMethod === 'both') {
          calStatus.textContent = 'Now playing 16 more clicks: play along (this figure is informational)...';
          await runPlayAlong({ informational: true });
        }
      }
    },
  });

  const playAlongBtn = el('button', {
    type: 'button', class: 'secondary', text: 'Play-along check',
    onClick: async () => {
      if (!stream) { calStatus.textContent = 'Enable the microphone first.'; return; }
      calStatus.textContent = 'Playing 16 clicks; play along over headphones (this reports your habitual offset)...';
      await runPlayAlong({ informational: calMethod !== 'playalong' });
    },
  });

  const calStatus = el('p', { class: 'muted small', text: 'No calibration for this device pair yet.' });

  function describeCalibration() {
    if (!calibration) return 'No calibration for this device pair yet.';
    const parts = [];
    if (calibration.method === 'playalong' && calibration.playerOffsetMs == null) {
      parts.push(`Play-along offset ${Math.round(calibration.systemOffsetMs)} ms, jitter ${Math.round(calibration.systemJitterMs ?? 0)} ms. Bias figures are relative to your calibration.`);
    } else {
      parts.push(`System offset ${Math.round(calibration.systemOffsetMs)} ms, system jitter ${Math.round(calibration.systemJitterMs ?? 0)} ms.`);
    }
    if (calibration.playerOffsetMs != null) {
      parts.push(`Your habitual offset ${Math.round(calibration.playerOffsetMs)} ms (positive = late). Informational only.`);
    }
    return parts.join(' ');
  }

  async function loadCalibration() {
    const db = await app.getDb();
    const key = calibrationKey(deviceSelect.value, 'default');
    calibration = await db.get('calibrations', key);
    calStatus.textContent = describeCalibration();
  }

  async function saveCalibration(fields) {
    calibration = {
      id: calibrationKey(deviceSelect.value, 'default'),
      inputId: deviceSelect.value || 'default',
      outputId: 'default',
      ...(calibration || {}),
      ...fields,
      at: new Date().toISOString(),
    };
    const db = await app.getDb();
    await db.put('calibrations', calibration);
    calStatus.textContent = describeCalibration();
  }

  /** One 16-click session; returns click and onset times in recording base. */
  async function runClickSession() {
    const ctx = await app.ensureAudio();
    app.scheduler.setBpm(60);
    app.scheduler.setSubdivision(1);
    app.scheduler.setMeter({ beatsPerBar: 4, beatValue: 4 });
    const clickTimes = [];
    const unsub = app.scheduler.subscribe((time, info) => {
      if (info.tick < 16) clickTimes.push(time);
    });
    app.metronome.arm({ countInBars: 0 });
    // Measured origin: the worklet reports the frame capture actually began.
    const { recorder: rec, originSec } = await recordingOrigin(ctx, ctx.createMediaStreamSource(stream));
    recorder = rec;
    // First click at least 0.2 s after the origin so the recording captures it.
    app.scheduler.start(Math.max(0.06, originSec + 0.2 - ctx.currentTime));

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (clickTimes.length >= 16) { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 20000);
    });
    // Let the last click ring and be detectable (same stop rule as assessment).
    await new Promise((resolve) => {
      const lastClick = clickTimes[clickTimes.length - 1] ?? ctx.currentTime;
      const poll = setInterval(() => {
        if (shouldStopNow(ctx.currentTime, lastClick)) { clearInterval(poll); resolve(); }
      }, 50);
    });
    app.scheduler.stop();
    app.metronome.disarm();
    unsub();
    const take = await recorder.stop();
    recorder.dispose();
    recorder = null;

    const onsets = detectOnsets(take.samples, take.sampleRate, onsetOptions);
    return { clickRel: toRecordingBase(clickTimes, originSec), onsets };
  }

  /** Acoustic loopback: the mic hears the clicks; measures system latency. */
  async function runLoopback() {
    const { clickRel, onsets } = await runClickSession();
    const result = computeSystemCalibration(clickRel, onsets);
    if (result.matched < 8) {
      calStatus.textContent = `Only ${result.matched} of 16 clicks were heard. Check the input level and try again.`;
      return;
    }
    const warn = jitterWarning(result.systemJitterMs, 10, 'the system (loopback) measurement');
    await saveCalibration({
      systemOffsetMs: result.systemOffsetMs,
      systemJitterMs: result.systemJitterMs,
      matched: result.matched,
      method: calMethod,
    });
    calStatus.textContent += ' This is the system latency, which scoring subtracts.';
    if (warn) calStatus.textContent += ` ${warn}`;
    calStatus.textContent += ' Run the play-along check to see your own habitual offset.';
  }

  /** Play-along: the player plays with the clicks; reports habit separately. */
  async function runPlayAlong({ informational = false } = {}) {
    const { clickRel, onsets } = await runClickSession();
    const system = calibration ? scoringOffsetMs(calibration) : 0;
    const result = computePlayerHabit(clickRel, onsets, system);
    if (result.matched < 8) {
      calStatus.textContent = `Only ${result.matched} of 16 clicks were detected. Check the input level and try again.`;
      return;
    }
    const warn = jitterWarning(result.playerJitterMs, 10, 'the play-along measurement');
    if (informational || calMethod !== 'playalong') {
      await saveCalibration({ playerOffsetMs: result.playerOffsetMs, playerJitterMs: result.playerJitterMs });
      calStatus.textContent += ` Your habitual offset is ${Math.round(result.playerOffsetMs)} ms (positive = late). Informational only; scoring subtracts the system offset.`;
    } else {
      // Option 1: the play-along measurement IS the stored calibration.
      await saveCalibration({
        systemOffsetMs: result.playAlongOffsetMs,
        systemJitterMs: result.playerJitterMs,
        playerOffsetMs: null,
        playerJitterMs: null,
        method: 'playalong',
      });
      calStatus.textContent += ' Stored play-along calibration. Bias figures are relative to your calibration.';
    }
    if (warn) calStatus.textContent += ` ${warn}`;
  }

  // ---------- assessment ----------
  const modeSelect = select([['grid', 'Grid mode (metronome clicks)'], ['tab', 'Tab mode (exercise notes)']],
    'grid', (v) => { mode = v; exerciseField.classList.toggle('hidden', v !== 'tab'); }, 'Mode');
  let mode = 'grid';

  const exerciseSelect = el('select', { 'aria-label': 'Exercise for tab mode' });
  const exerciseField = el('label', { class: 'field hidden' }, el('span', { text: 'Exercise' }), exerciseSelect);

  async function loadExercises() {
    exercises = await loadRolls(app.settings);
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

    // Measured origin (worklet frame), never a guessed constant.
    const { recorder: rec, originSec } = await recordingOrigin(ctx, ctx.createMediaStreamSource(stream));
    recorder = rec;
    const recStart = originSec;
    // First scheduled tick at least 0.2 s after the origin so the count-in is
    // captured fully.
    const firstTickTime = Math.max(ctx.currentTime + 0.06, recStart + 0.2);

    const gridTimes = [];
    const totalTicks = (countInBars + bars) * beatsPerBar * subdivision;
    let ticks = 0;
    let expectedNotes = null;
    const beatDur = 60 / bpm;
    // Tab notes align to the first beat after the count-in.
    const goTime = firstTickTime + countInBars * beatsPerBar * beatDur;
    if (mode === 'tab') {
      const tab = exercises.find((t) => t.id === exerciseSelect.value);
      if (tab) {
        expectedNotes = tab.notes.map((n) => ({ ...n, time: goTime + n.startBeat * beatDur }));
      }
    }
    const unsub = app.scheduler.subscribe((time, info) => {
      if (runState && runState.finished) return;
      ticks += 1;
      const isGrid = info.tick % subdivision === 0;
      if (info.tick >= countInBars * beatsPerBar * subdivision && isGrid) gridTimes.push(time);
      if (ticks >= totalTicks) {
        // Do not stop here: this tick is only scheduled, not yet sounded.
        // Stop after the last event actually rings (tail), polled off-scheduler.
        runState.finished = true;
        runState.lastTickTime = time;
        runState.poll = setInterval(() => {
          if (shouldStopNow(app.getCtx().currentTime, runState.lastTickTime)) stopRun();
        }, 50);
      }
    });
    runState = { gridTimes, recStart, firstTickTime, unsub, expectedNotes, bpm };
    app.scheduler.start(firstTickTime - ctx.currentTime);
    running = true;
    recordBtn.textContent = 'Stop';
    runStatus.textContent = `Recording ${bars} bar(s) at ${bpm} BPM after a ${countInBars}-bar count-in.`;
  }

  async function stopRun() {
    if (!runState || !recorder) return;
    running = false;
    recordBtn.textContent = 'Record assessment';
    const state = runState;
    if (state.poll) clearInterval(state.poll);
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
    const offsetMs = scoringOffsetMs(calibration);
    let report;
    let evenness = null;

    if (mode === 'tab' && state.expectedNotes) {
      const expectedTimes = toRecordingBase(state.expectedNotes.map((n) => n.time), state.recStart);
      const { matches, missed, extra } = alignOnsets(onsets, expectedTimes);
      const devs = matches.map((m) => m.deviationMs);
      const bias = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0;
      const std = devs.length > 1 ? Math.sqrt(devs.reduce((a, b) => a + (b - bias) ** 2, 0) / (devs.length - 1)) : 0;
      report = { notes: matches.map((m) => ({ ...m, gridIndex: m.expectedIndex })), deviationsMs: devs, biasMs: bias, stdMs: std, missed, extra };
      evenness = rollEvenness({ notes: state.expectedNotes }, matches, onsets);
    } else {
      const gridRel = toRecordingBase(state.gridTimes, state.recStart);
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
      el('p', { class: 'mono', text: `Bias ${report.biasMs.toFixed(1)} ms - consistency (standard deviation) ${report.stdMs.toFixed(1)} ms - missed ${report.missed ?? 0} - extra ${report.extra ?? 0}` + (calibration && calibration.method === 'playalong' && calibration.playerOffsetMs == null ? ' (bias relative to your calibration)' : '') }),
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
      calMethodSelect,
      el('div', { class: 'row' }, calBtn, playAlongBtn),
      calStatus,
      el('p', { class: 'muted small', text: 'Loopback: play 16 clicks through the speakers (or hold headphones against the microphone) so the microphone hears only the clicks; this measures the true system latency and is the only figure scoring subtracts. Play-along: play along with the clicks; your habitual lead or lag is shown separately and never subtracted. Wired headphones are recommended.' }),
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
