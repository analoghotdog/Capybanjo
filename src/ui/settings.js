// Settings view (build plan Steps 31-32, 51): persistent settings plus backup
// export/import and the backup-age bookkeeping behind the reminder banner.

import { el, numberInput, select } from './dom.js';
import { buildBackup, applyBackup, backupStats } from '../storage/export-import.js';

const THEMES = [['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']];

export function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
}

export function mountSettings(container, app) {
  const status = el('p', { class: 'muted small', text: '' });

  function settingField(labelText, control) {
    return el('label', { class: 'field' }, el('span', { text: labelText }), control);
  }

  async function save(key, value, message) {
    await app.settings.set(key, value);
    status.textContent = message || 'Saved.';
  }

  // ---- general ----
  const tuningSelect = select([
    ['openG', 'Open G (gDGBD)'], ['doubleC', 'Double C (gCGCD)'],
    ['sawmill', 'Sawmill / G modal'], ['openD', 'Open D'],
  ], 'openG', (v) => save('tuning', v, 'Default tuning saved.'), 'Default tuning');

  const themeSelect = select(THEMES, 'system', (v) => {
    applyTheme(v);
    save('theme', v, 'Theme saved.');
  }, 'Theme');

  // ---- tab layout ----
  const measuresPerLine = numberInput(4, {
    min: 1, max: 8, label: 'Measures per line',
    onInput: (v) => save('measuresPerLine', v, 'Tab layout saved.'),
  });
  const largeTab = el('input', {
    type: 'checkbox', id: 'large-tab',
    onChange: (e) => save('largeTab', e.target.checked, 'Tab size saved.'),
  });

  // ---- analysis defaults ----
  const sensitivity = numberInput(1.5, {
    min: 0.5, max: 3, step: 0.1, label: 'Onset sensitivity default',
    onInput: (v) => save('onsetSensitivity', v, 'Detection default saved.'),
  });
  const minInterval = numberInput(60, {
    min: 20, max: 300, step: 10, label: 'Minimum note interval (ms)',
    onInput: (v) => save('onsetMinIntervalMs', v, 'Detection default saved.'),
  });
  const cleanThreshold = numberInput(20, {
    min: 5, max: 100, step: 1, label: 'Clean threshold (ms consistency)',
    onInput: (v) => save('cleanThresholdMs', v, 'Clean threshold saved.'),
  });
  const retention = numberInput(20, {
    min: 1, max: 100, label: 'Recordings kept per exercise',
    onInput: (v) => save('recordingsPerExercise', v, 'Retention saved.'),
  });

  // ---- backup ----
  const includeRec = el('input', { type: 'checkbox', id: 'include-rec' });
  const exportBtn = el('button', {
    type: 'button', text: 'Export backup (JSON)',
    onClick: async () => {
      const db = await app.getDb();
      const backup = await buildBackup(db, { includeRecordings: includeRec.checked });
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `banjo-practice-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      await app.settings.set('lastBackupAt', new Date().toISOString());
      app.bus.emit('backup-exported');
      status.textContent = 'Backup exported. Your recordings are only included when the checkbox is ticked.';
    },
  });

  const importMode = select([['merge', 'Merge (keep existing items)'], ['replace', 'Replace (clear everything first)']],
    'merge', () => {}, 'Import mode');
  const importInput = el('input', {
    type: 'file', accept: '.json,application/json',
    onChange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const backup = JSON.parse(await file.text());
        const stats = backupStats(backup);
        const ok = window.confirm(
          `Import ${stats.total} items (${Object.entries(stats.counts).map(([k, v]) => `${k}: ${v}`).join(', ')}) ` +
          `in ${importMode.value} mode?`,
        );
        if (!ok) return;
        const db = await app.getDb();
        const result = await applyBackup(db, backup, { mode: importMode.value });
        status.textContent = result.ok
          ? `Imported ${result.imported} items, skipped ${result.skipped}.`
          : `Import failed: ${(result.errors || []).join('; ')}`;
      } catch (err) {
        status.textContent = `Could not read that file: ${err.message}`;
      }
    },
  });

  // ---- restore values ----
  (async () => {
    tuningSelect.value = await app.settings.get('tuning', 'openG');
    themeSelect.value = await app.settings.get('theme', 'system');
    measuresPerLine.value = await app.settings.get('measuresPerLine', 4);
    largeTab.checked = await app.settings.get('largeTab', true);
    sensitivity.value = await app.settings.get('onsetSensitivity', 1.5);
    minInterval.value = await app.settings.get('onsetMinIntervalMs', 60);
    cleanThreshold.value = await app.settings.get('cleanThresholdMs', 20);
    retention.value = await app.settings.get('recordingsPerExercise', 20);
    const last = await app.settings.get('lastBackupAt', null);
    status.textContent = last ? `Last backup export: ${new Date(last).toLocaleString()}` : 'No backup export yet.';
  })();

  container.append(
    el('h2', { text: 'Settings' }),
    el('div', { class: 'grid-2' },
      el('div', { class: 'panel' },
        el('h3', { text: 'General' }),
        settingField('Default tuning', tuningSelect),
        settingField('Theme', themeSelect),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Tab layout' }),
        settingField('Measures per line', measuresPerLine),
        el('label', { class: 'row' }, largeTab, el('span', { text: 'Larger tab size' })),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Analysis and recordings' }),
        settingField('Onset sensitivity default', sensitivity),
        settingField('Minimum note interval (ms)', minInterval),
        settingField('Clean threshold (ms)', cleanThreshold),
        settingField('Recordings kept per exercise', retention),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Backup' }),
        el('p', { class: 'small muted', text: 'Export includes settings, calibrations, sessions, take metadata and tabs. Recordings are large; include them only when you need them.' }),
        el('label', { class: 'row' }, includeRec, el('span', { text: 'Include recordings in the export' })),
        el('div', { class: 'row' }, exportBtn),
        el('div', { class: 'row' }, importMode),
        importInput,
      ),
    ),
    status,
    el('p', { class: 'muted small', text: 'A gentle reminder appears after 30 days without a backup export. Never commit backups or personal data to the repository.' }),
  );

  return { unmount() {} };
}
