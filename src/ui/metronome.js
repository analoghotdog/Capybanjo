// Metronome view (build plan Steps 2, 5, 6, 7): BPM input + slider, Start/Stop,
// tap tempo, subdivisions, time signatures, count-in, click volume/mute, test
// tone, and a visual beat indicator driven by scheduled audio times.

import { el, numberInput, select, slider } from './dom.js';
import { playSine } from '../audio/synth.js';

const METERS = {
  '4/4': { beatsPerBar: 4, beatValue: 4 },
  '3/4': { beatsPerBar: 3, beatValue: 4 },
  '6/8': { beatsPerBar: 6, beatValue: 8 },
};
const SUBDIVISIONS = [
  ['1', 'Quarter notes'], ['2', 'Eighth notes'], ['3', 'Triplets'], ['4', 'Sixteenth notes'],
];

export function mountMetronome(container, app) {
  let bpm = 100;
  let subdivision = 1;
  let meterKey = '4/4';
  let countIn = 0;
  let running = false;
  let rafId = 0;
  let taps = [];
  const beatEvents = []; // { time, beatInBar, isDownbeat, countIn }
  const cleanups = [];

  // ---- indicator ----
  const dotsWrap = el('div', { class: 'beat-dots', role: 'status', 'aria-label': 'Beat indicator' });
  let dots = [];
  function buildDots() {
    dotsWrap.innerHTML = '';
    dots = [];
    const { beatsPerBar } = METERS[meterKey];
    for (let i = 0; i < beatsPerBar; i++) {
      const d = el('div', { class: `beat-dot${i === 0 ? ' downbeat' : ''}` });
      dots.push(d);
      dotsWrap.append(d);
    }
  }

  function onBeat(time, info) {
    beatEvents.push({ time, beatInBar: info.beatInBar, isDownbeat: info.isDownbeat, countIn: info.countIn });
  }

  function tickIndicator() {
    const now = app.getCtx().currentTime;
    while (beatEvents.length && beatEvents[0].time < now - 0.35) beatEvents.shift();
    for (const d of dots) d.classList.remove('on', 'countin');
    let current = null;
    for (const e of beatEvents) {
      if (e.time <= now && now - e.time < 0.3) current = e;
    }
    if (current) {
      const d = dots[current.beatInBar - 1];
      if (d) {
        d.classList.add('on');
        if (current.countIn) d.classList.add('countin');
      }
    }
    rafId = requestAnimationFrame(tickIndicator);
  }

  // ---- transport ----
  function applyScheduler() {
    const m = METERS[meterKey];
    app.scheduler.setBpm(bpm);
    app.scheduler.setSubdivision(subdivision);
    app.scheduler.setMeter({ beatsPerBar: m.beatsPerBar, beatValue: m.beatValue });
  }

  async function start() {
    await app.ensureAudio();
    applyScheduler();
    app.metronome.setOnBeat(onBeat);
    app.metronome.arm({ countInBars: countIn });
    app.scheduler.start();
    running = true;
    startStopBtn.textContent = 'Stop';
    status.textContent = countIn > 0 ? `Count-in: ${countIn} bar(s), then go.` : 'Running.';
  }

  function stop() {
    app.scheduler.stop();
    app.metronome.disarm();
    running = false;
    startStopBtn.textContent = 'Start';
    status.textContent = 'Stopped.';
  }

  // ---- tap tempo ----
  function tap() {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 2000);
    taps.push(now);
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length && intervals.length < 4; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(Math.round(60000 / avg));
    }
  }

  function setBpm(next) {
    bpm = Math.min(240, Math.max(30, next));
    bpmInput.value = bpm;
    bpmSlider.value = bpm;
    if (running) app.scheduler.setBpm(bpm);
    app.settings.set('bpm', bpm);
  }

  // ---- build UI ----
  const bpmInput = numberInput(bpm, {
    min: 30, max: 240, label: 'BPM',
    onInput: (v) => setBpm(v),
  });
  const bpmSlider = el('input', {
    type: 'range', min: 30, max: 240, step: 1, value: bpm,
    'aria-label': 'BPM slider',
    onInput: (e) => setBpm(parseInt(e.target.value, 10)),
  });

  const startStopBtn = el('button', {
    type: 'button',
    onClick: () => (running ? stop() : start()),
    text: 'Start',
  });

  const status = el('p', { class: 'muted small', text: 'Stopped.' });

  const subdivSelect = select(SUBDIVISIONS, String(subdivision), (v) => {
    subdivision = parseInt(v, 10);
    if (running) app.scheduler.setSubdivision(subdivision);
    app.settings.set('metronomeSubdivision', subdivision);
  }, 'Subdivision');

  const meterSelect = select(Object.keys(METERS).map((k) => [k, k]), meterKey, (v) => {
    meterKey = v;
    buildDots();
    if (running) applyScheduler();
    app.settings.set('timeSignature', meterKey);
  }, 'Time signature');

  const countInSelect = select([['0', 'No count-in'], ['1', 'Count-in 1 bar'], ['2', 'Count-in 2 bars']],
    String(countIn), (v) => { countIn = parseInt(v, 10); }, 'Count-in');

  const volume = slider({
    min: 0, max: 1, step: 0.05, value: app.metronome.getVolume(),
    label: 'Click volume',
    onInput: (v) => { app.metronome.setVolume(v); app.settings.set('clickVolume', v); },
  });

  const muteBtn = el('button', {
    type: 'button', class: 'secondary',
    text: app.metronome.isMuted() ? 'Unmute click' : 'Mute click',
    onClick: () => {
      app.metronome.setMuted(!app.metronome.isMuted());
      muteBtn.textContent = app.metronome.isMuted() ? 'Unmute click' : 'Mute click';
    },
  });

  const tapBtn = el('button', { type: 'button', class: 'secondary', text: 'Tap tempo', onClick: tap });

  const testToneBtn = el('button', {
    type: 'button', class: 'secondary', text: 'Test tone',
    onClick: async () => {
      const ctx = await app.ensureAudio();
      playSine(ctx, 440, ctx.currentTime + 0.02, 0.25, 0.3);
    },
  });

  container.append(
    el('h2', { text: 'Metronome' }),
    el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, el('span', { text: 'BPM (30 to 240)' }), bpmInput),
        tapBtn,
        startStopBtn,
      ),
      bpmSlider,
      el('div', { class: 'row' }, subdivSelect, meterSelect, countInSelect),
      dotsWrap,
      status,
    ),
    el('div', { class: 'panel' },
      el('div', { class: 'row' }, volume.root, muteBtn, testToneBtn),
      el('p', { class: 'muted small', text: 'Space starts and stops. Arrow up and down change BPM. M mutes the click.' }),
    ),
  );

  // ---- restore settings ----
  (async () => {
    bpm = await app.settings.get('bpm', bpm);
    bpmInput.value = bpm;
    bpmSlider.value = bpm;
    subdivision = await app.settings.get('metronomeSubdivision', subdivision);
    subdivSelect.value = String(subdivision);
    meterKey = await app.settings.get('timeSignature', meterKey);
    meterSelect.value = meterKey;
    buildDots();
    const v = await app.settings.get('clickVolume', null);
    if (v != null) { app.metronome.setVolume(v); volume.input.value = v; }
    app.metronome.setMuted(await app.settings.get('clickMuted', false));
    muteBtn.textContent = app.metronome.isMuted() ? 'Unmute click' : 'Mute click';
  })();
  buildDots();
  rafId = requestAnimationFrame(tickIndicator);
  cleanups.push(() => cancelAnimationFrame(rafId));

  return {
    unmount() {
      if (running) stop();
      app.metronome.setOnBeat(null);
      for (const fn of cleanups) fn();
    },
    onKey(e) {
      if (e.key === ' ') {
        if (running) stop(); else start();
        return true;
      }
      if (e.key === 'ArrowUp') { setBpm(bpm + (e.shiftKey ? 5 : 1)); return true; }
      if (e.key === 'ArrowDown') { setBpm(bpm - (e.shiftKey ? 5 : 1)); return true; }
      if (e.key === 'm' || e.key === 'M') {
        app.metronome.setMuted(!app.metronome.isMuted());
        muteBtn.textContent = app.metronome.isMuted() ? 'Unmute click' : 'Mute click';
        app.settings.set('clickMuted', app.metronome.isMuted());
        return true;
      }
      return false;
    },
  };
}
