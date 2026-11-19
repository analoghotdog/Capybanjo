// Practice session log (build plan Steps 28-30). Session and entry shapes:
//   Session { id, startedAt, endedAt, entries: [Entry] }
//   Entry   { id, at, type, title, exerciseId, bpm, durationMs, stats }
// The log view reads sessions; the trend chart reads entries with stats.cleanBpm.

export const IDLE_CLOSE_MS = 15 * 60 * 1000; // close after 15 min of inactivity

function iso(msOrDate) {
  return new Date(msOrDate).toISOString();
}

/** Current open session in db, or null. */
export async function openSession(db) {
  const all = await db.getAll('sessions');
  const open = all.filter((s) => !s.endedAt).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return open[0] || null;
}

/** Get the current session, creating one if needed (first practice action). */
export async function ensureSession(db, now = Date.now()) {
  await closeIdleSessions(db, now);
  let s = await openSession(db);
  if (!s) {
    s = { id: `ses:${now}:${Math.random().toString(36).slice(2, 8)}`, startedAt: iso(now), endedAt: null, entries: [] };
    await db.put('sessions', s);
  }
  return s;
}

/** Append an entry to the current session (creates one if needed). */
export async function logEntry(db, entry, now = Date.now()) {
  const s = await ensureSession(db, now);
  s.entries.push({
    id: `ent:${now}:${Math.random().toString(36).slice(2, 8)}`,
    at: iso(now),
    type: entry.type, // 'playback' | 'assessment' | 'speed' | 'chords' | 'tuning'
    title: entry.title || '',
    exerciseId: entry.exerciseId || null,
    bpm: entry.bpm ?? null,
    durationMs: entry.durationMs ?? null,
    stats: entry.stats || null,
  });
  await db.put('sessions', s);
  return s;
}

/** Close sessions idle for longer than idleMs. Returns closed sessions. */
export async function closeIdleSessions(db, now = Date.now(), idleMs = IDLE_CLOSE_MS) {
  const all = await db.getAll('sessions');
  const closed = [];
  for (const s of all) {
    if (s.endedAt) continue;
    const last = s.entries.length ? Date.parse(s.entries[s.entries.length - 1].at) : Date.parse(s.startedAt);
    if (now - last > idleMs) {
      s.endedAt = iso(last + idleMs);
      await db.put('sessions', s);
      closed.push(s);
    }
  }
  return closed;
}

/** Force-close the open session. */
export async function closeSession(db, now = Date.now()) {
  const s = await openSession(db);
  if (!s) return null;
  s.endedAt = iso(now);
  await db.put('sessions', s);
  return s;
}

/** Duration of a session in ms (open sessions measured to `now`). */
export function sessionDuration(session, now = Date.now()) {
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  return Math.max(0, end - Date.parse(session.startedAt));
}

/** Distinct exercise titles practiced in a session. */
export function sessionExercises(session) {
  return [...new Set(session.entries.map((e) => e.title).filter(Boolean))];
}

/**
 * Best clean BPM per exercise over time (for the trend chart).
 * Returns [{ exerciseId, title, points: [{ at, cleanBpm }] }] with points sorted.
 */
export function bestCleanBpmSeries(sessions) {
  const byEx = new Map();
  for (const s of sessions) {
    for (const e of s.entries) {
      const cleanBpm = e.stats && typeof e.stats.cleanBpm === 'number' ? e.stats.cleanBpm : null;
      if (cleanBpm == null) continue;
      const key = e.exerciseId || e.title || 'unknown';
      if (!byEx.has(key)) byEx.set(key, { exerciseId: key, title: e.title || key, points: [] });
      byEx.get(key).points.push({ at: e.at, cleanBpm });
    }
  }
  for (const series of byEx.values()) {
    series.points.sort((a, b) => (a.at < b.at ? -1 : 1));
  }
  return [...byEx.values()];
}
