// Practice log view (build plan Steps 29-30): list of sessions with detail
// views, and a trend chart of best clean BPM per exercise over time.

import { el, select } from './dom.js';
import { sessionDuration, sessionExercises, bestCleanBpmSeries } from '../features/practice-log.js';

export function mountLog(container, app) {
  const listWrap = el('div');
  const detailWrap = el('div');
  const chartWrap = el('div', { class: 'panel' });
  let sessions = [];

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fmtDuration(ms) {
    const min = Math.round(ms / 60000);
    return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
  }

  async function refresh() {
    const db = await app.getDb();
    sessions = (await db.getAll('sessions')).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    renderList();
    renderChartPicker();
  }

  function renderList() {
    listWrap.innerHTML = '';
    if (!sessions.length) {
      listWrap.append(el('p', { class: 'muted', text: 'No practice sessions yet. Sessions start on your first practice action and close after 15 minutes of inactivity.' }));
      return;
    }
    const table = el('table');
    table.append(el('tr', {}, el('th', { text: 'Date' }), el('th', { text: 'Duration' }), el('th', { text: 'Exercises' }), el('th', { text: '' })));
    for (const s of sessions) {
      table.append(el('tr', {},
        el('td', { text: fmtDate(s.startedAt) }),
        el('td', { text: fmtDuration(sessionDuration(s)) }),
        el('td', { text: sessionExercises(s).join(', ') || '-' }),
        el('td', {}, el('button', { type: 'button', class: 'link', text: 'Details', onClick: () => renderDetail(s) })),
      ));
    }
    listWrap.append(table);
  }

  function renderDetail(s) {
    detailWrap.innerHTML = '';
    const table = el('table');
    table.append(el('tr', {}, el('th', { text: 'Time' }), el('th', { text: 'Type' }), el('th', { text: 'Exercise' }), el('th', { text: 'BPM' }), el('th', { text: 'Stats' })));
    for (const e of s.entries) {
      table.append(el('tr', {},
        el('td', { text: fmtDate(e.at) }),
        el('td', { text: e.type }),
        el('td', { text: e.title || '-' }),
        el('td', { class: 'mono', text: e.bpm == null ? '-' : String(e.bpm) }),
        el('td', { class: 'small mono', text: e.stats ? JSON.stringify(e.stats) : '-' }),
      ));
    }
    detailWrap.append(
      el('h3', { text: `Session ${fmtDate(s.startedAt)}` }),
      table,
      el('button', { type: 'button', class: 'secondary', text: 'Back to list', onClick: () => { detailWrap.innerHTML = ''; } }),
    );
  }

  function renderChartPicker() {
    const series = bestCleanBpmSeries(sessions);
    chartWrap.innerHTML = '';
    chartWrap.append(el('h3', { text: 'Best clean speed per exercise' }));
    if (!series.length) {
      chartWrap.append(el('p', { class: 'muted', text: 'No clean-speed data yet. Speed trainer runs and assessments log their best clean BPM here.' }));
      return;
    }
    const options = series.map((s) => [s.exerciseId, s.title]);
    const picker = select(options, series[0].exerciseId, (v) => {
      const s = series.find((x) => x.exerciseId === v);
      renderChart(s);
    }, 'Exercise');
    chartWrap.append(picker);
    renderChart(series[0]);
  }

  function renderChart(series) {
    const width = 880, height = 260, padL = 50, padB = 30, padT = 20, padR = 20;
    const old = chartWrap.querySelector('svg');
    if (old) old.remove();
    const points = series.points;
    const bpms = points.map((p) => p.cleanBpm);
    const minBpm = Math.min(...bpms) - 5;
    const maxBpm = Math.max(...bpms) + 5;
    const x = (i) => padL + (points.length === 1 ? (width - padL - padR) / 2 : (i / (points.length - 1)) * (width - padL - padR));
    const y = (v) => padT + (1 - (v - minBpm) / Math.max(1, maxBpm - minBpm)) * (height - padT - padB);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Best clean BPM over time">`];
    parts.push(`<line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="currentColor"/>`);
    parts.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="currentColor"/>`);
    for (let v = Math.ceil(minBpm / 10) * 10; v <= maxBpm; v += 10) {
      parts.push(`<text x="${padL - 8}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="currentColor">${v}</text>`);
      parts.push(`<line x1="${padL}" y1="${y(v)}" x2="${width - padR}" y2="${y(v)}" stroke="currentColor" opacity="0.2"/>`);
    }
    if (points.length) {
      const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.cleanBpm)}`).join(' ');
      parts.push(`<path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/>`);
      points.forEach((p, i) => {
        parts.push(`<circle cx="${x(i)}" cy="${y(p.cleanBpm)}" r="3.5" fill="currentColor"/>`);
        if (points.length <= 12 || i % Math.ceil(points.length / 12) === 0) {
          parts.push(`<text x="${x(i)}" y="${height - padB + 14}" font-size="9" text-anchor="middle" fill="currentColor">${new Date(p.at).toLocaleDateString()}</text>`);
        }
      });
    }
    parts.push(`<text x="${padL}" y="${padT - 6}" font-size="10" fill="currentColor">BPM</text>`);
    parts.push('</svg>');
    chartWrap.insertAdjacentHTML('beforeend', parts.join('\n'));
  }

  container.append(
    el('h2', { text: 'Practice log' }),
    listWrap,
    detailWrap,
    chartWrap,
    el('p', { class: 'muted small', text: 'Sessions start on your first practice action and close after 15 minutes without activity. Everything stays in this browser.' }),
  );

  refresh();

  return { unmount() {} };
}
