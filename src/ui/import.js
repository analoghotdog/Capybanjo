// Import view (build plan Steps 34-40): paste ASCII tab, upload/drop text and
// MusicXML files, and link import with the network notice and CORS fallback.
// All paths share one confirmation screen (title, tuning, time signature,
// string mapping, rhythm step), a preview renderer, and the saved-tab library.

import { el, numberInput, select } from './dom.js';
import { parseAsciiTab } from '../tab/parse-ascii.js';
import { parseMusicXML } from '../tab/parse-musicxml.js';
import { renderTabSvg } from '../tab/render.js';
import { TUNINGS, noteToMidi, resolveTuning, measureCount, validateTab } from '../tab/model.js';
import { createGuitarNoteMapper, GUITAR_TUNINGS } from '../tab/guitar-conversion.js';

const TUNING_OPTIONS = [
  ['openG', TUNINGS.openG.name], ['doubleC', TUNINGS.doubleC.name],
  ['sawmill', TUNINGS.sawmill.name], ['openD', TUNINGS.openD.name],
];
const TIME_SIGNATURES = [['4,4', '4/4'], ['3,4', '3/4'], ['6,8', '6/8']];
const RHYTHM_STEPS = [['1', 'Quarter notes (1 column per beat)'], ['2', 'Eighth notes (2 columns per beat)'], ['3', 'Triplets (3 per beat)'], ['4', 'Sixteenth notes (4 per beat)']];
const GUITAR_TUNING_OPTIONS = Object.entries(GUITAR_TUNINGS).map(([key, tuning]) => [key, tuning.label]);

export function mountImport(container, app) {
  const status = el('p', { class: 'muted small', text: '' });
  const rightsNote = el('div', { class: 'notice', hidden: true,
    text: 'Tabs are often copyrighted. Imported tabs are stored only in this browser and are for personal practice only.' });
  const pipeline = el('div'); // confirmation screen container
  const libraryWrap = el('div');
  let reparseActive = null;
  const sourceTypeSelect = select([
    ['banjo', 'Banjo tab (import as-is)'],
    ['guitar', 'Guitar tab (convert to banjo)'],
  ], 'banjo', () => { if (reparseActive) reparseActive(); }, 'Source tab type');

  function parseTab(format, rawText, parseOptions) {
    const options = { ...parseOptions };
    if (sourceTypeSelect.value === 'guitar') {
      try {
        options.noteTransform = createGuitarNoteMapper(
          options.guitarTuning || 'standard',
          options.tuning || 'openG',
        ).mapNote;
      } catch (err) {
        return { ok: false, error: err.message };
      }
      if (format === 'ascii') options.stringCount = 6;
    } else {
      delete options.noteTransform;
      delete options.stringCount;
    }
    return format === 'musicxml'
      ? parseMusicXML(rawText, options)
      : parseAsciiTab(rawText, options);
  }

  // ---- one-time rights note ----
  (async () => {
    const shown = await app.settings.get('importRightsNoticeShown', false);
    if (!shown) {
      rightsNote.hidden = false;
      await app.settings.set('importRightsNoticeShown', true);
    }
  })();

  // ---- shared confirmation screen ----
  function showConfirm({ format, rawText, parseOptions, sourceLabel, initial }) {
    pipeline.innerHTML = '';
    let tab = initial.tab;
    let warnings = initial.warnings || [];

    const titleInput = el('input', { type: 'text', value: tab.title, 'aria-label': 'Tab title', size: 30 });
    const tuningSelect = select(TUNING_OPTIONS, typeof tab.tuning === 'string' ? tab.tuning : 'openG',
      (v) => { reparsed = true; parseOptions.tuning = v; reparse(); }, 'Tuning');
    const guitarTuningSelect = select(
      GUITAR_TUNING_OPTIONS,
      parseOptions.guitarTuning || 'standard',
      (v) => { parseOptions.guitarTuning = v; reparse(); },
      'Guitar tuning',
    );
    const guitarTuningField = el('label', { class: 'field hidden' },
      el('span', { text: 'Source guitar tuning' }),
      guitarTuningSelect,
    );
    const tsSelect = select(TIME_SIGNATURES, tab.timeSignature.join(','),
      (v) => { parseOptions.timeSignature = v.split(',').map(Number); reparse(); }, 'Time signature');
    const rhythmSelect = select(RHYTHM_STEPS, String(parseOptions.subdivision || 2),
      (v) => { parseOptions.subdivision = parseInt(v, 10); reparse(); }, 'Rhythm step');
    const orderSelect = select([
      ['top', 'String 1 at top (standard)'], ['bottom', 'String 1 at bottom (reversed)'],
    ], 'top', (v) => {
      parseOptions.stringMap = v === 'bottom' ? reversedStringMap(rawText) : undefined;
      reparse();
    }, 'Line order');

    const warningsBox = el('div');
    const preview = el('div', { class: 'panel' });
    const ambiguousBox = el('div');
    const editorWrap = el('div', { class: 'panel hidden' });
    let reparsed = false;
    let saveBtn;

    function refreshWarnings() {
      warningsBox.innerHTML = '';
      for (const w of warnings) warningsBox.append(el('p', { class: 'small notice warn', text: w }));
    }

    function renderPreview() {
      preview.innerHTML = renderTabSvg(tab, { measuresPerLine: 4 });
    }

    function renderAmbiguous() {
      ambiguousBox.innerHTML = '';
      const amb = (tab.notes || []).map((n, i) => ({ n, i })).filter(({ n }) => n.ambiguous);
      if (!amb.length) return;
      ambiguousBox.append(el('h3', { text: 'Confirm fret choices (marked ambiguous)' }));
      const table = el('table');
      table.append(el('tr', {}, el('th', { text: 'Note' }), el('th', { text: 'Pitch' }), el('th', { text: 'String and fret' })));
      const tuning = resolveTuning(parseOptions.tuning || tab.tuning);
      for (const { n, i } of amb) {
        const midi = noteToMidi(tuning.strings[n.string]) + n.fret;
        const candidates = [];
        for (const s of [1, 2, 3, 4, 5]) {
          const f = midi - noteToMidi(tuning.strings[s]);
          if (f >= 0 && f <= 24) candidates.push([`${s}:${f}`, `String ${s}, fret ${f}`]);
        }
        const sel = select(candidates, `${n.string}:${n.fret}`, (v) => {
          const [s, f] = v.split(':').map(Number);
          tab.notes[i] = { ...n, string: s, fret: f };
          renderPreview();
        }, `Note ${i + 1}`);
        table.append(el('tr', {}, el('td', { text: String(i + 1) }), el('td', { class: 'mono', text: String(midi) }), el('td', {}, sel)));
      }
      ambiguousBox.append(table);
    }

    function renderEditor() {
      editorWrap.innerHTML = '';
      editorWrap.append(el('h3', { text: `Edit notes (${tab.notes.length})` }));
      if (!tab.notes.length) {
        editorWrap.append(el('p', { class: 'muted small', text: 'No notes to edit. Add a note to begin.' }));
      }
      const table = el('table');
      table.append(el('tr', {},
        el('th', { text: 'Beat' }),
        el('th', { text: 'String' }),
        el('th', { text: 'Fret' }),
        el('th', { text: 'Duration (beats)' }),
        el('th', { text: '' }),
      ));
      tab.notes.forEach((note, index) => {
        const beatInput = numberInput(note.startBeat, {
          min: 0, max: 9999, step: 0.25, label: `Note ${index + 1} start beat`,
          onInput: (v) => { note.startBeat = v; renderPreview(); },
        });
        const stringSelect = select(
          [1, 2, 3, 4, 5].map((string) => [String(string), `String ${string}`]),
          String(note.string),
          (v) => { note.string = parseInt(v, 10); renderPreview(); },
          `Note ${index + 1} string`,
        );
        const fretInput = numberInput(note.fret, {
          min: 0, max: 36, label: `Note ${index + 1} fret`,
          onInput: (v) => { note.fret = v; renderPreview(); },
        });
        const durationInput = numberInput(note.durationBeats, {
          min: 0.01, max: 999, step: 0.25, label: `Note ${index + 1} duration`,
          onInput: (v) => { note.durationBeats = v; },
        });
        table.append(el('tr', {},
          el('td', {}, beatInput),
          el('td', {}, stringSelect),
          el('td', {}, fretInput),
          el('td', {}, durationInput),
          el('td', {}, el('button', {
            type: 'button', class: 'link', text: 'Delete',
            onClick: () => {
              tab.notes.splice(index, 1);
              renderEditor();
              renderPreview();
            },
          })),
        ));
      });
      editorWrap.append(table);
    }

    const editNotesButton = el('button', {
      type: 'button',
      class: 'secondary',
      text: 'Edit notes',
      onClick: () => {
        const opening = editorWrap.classList.contains('hidden');
        editorWrap.classList.toggle('hidden', !opening);
        editNotesButton.textContent = opening ? 'Hide note editor' : 'Edit notes';
        if (opening) renderEditor();
      },
    });
    const addNoteButton = el('button', {
      type: 'button',
      class: 'secondary',
      text: 'Add note',
      onClick: () => {
        const lastBeat = tab.notes.reduce((end, note) => Math.max(end, note.startBeat), 0);
        tab.notes.push({
          string: 1,
          fret: 0,
          startBeat: tab.notes.length ? lastBeat + 0.5 : 0,
          durationBeats: 0.5,
          finger: null,
        });
        renderEditor();
        renderPreview();
      },
    });

    function reparse() {
      const isGuitar = sourceTypeSelect.value === 'guitar';
      guitarTuningField.classList.toggle('hidden', !isGuitar);
      orderSelect.classList.toggle('hidden', isGuitar);
      const result = parseTab(format, rawText, parseOptions);
      if (!result.ok) {
        status.textContent = result.error;
        if (saveBtn) saveBtn.disabled = true;
        return;
      }
      if (saveBtn) saveBtn.disabled = false;
      tab = result.tab;
      warnings = result.warnings || [];
      if (titleInput.value && titleInput.value !== 'Imported ASCII tab') tab.title = titleInput.value;
      refreshWarnings();
      renderPreview();
      renderAmbiguous();
    }
    reparseActive = reparse;
    guitarTuningField.classList.toggle('hidden', sourceTypeSelect.value !== 'guitar');
    orderSelect.classList.toggle('hidden', sourceTypeSelect.value === 'guitar');

    titleInput.addEventListener('input', () => { tab.title = titleInput.value; });

    saveBtn = el('button', {
      type: 'button', text: 'Save tab',
      onClick: async () => {
        const validation = validateTab(tab);
        if (!validation.ok) {
          status.textContent = `Cannot save this tab: ${validation.errors.join('; ')}`;
          return;
        }
        tab.notes.sort((a, b) => a.startBeat - b.startBeat || a.string - b.string);
        const db = await app.getDb();
        const saved = {
          ...tab,
          id: `tab:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          title: titleInput.value || tab.title,
          source: sourceLabel,
          importedAt: new Date().toISOString(),
          userNote: '',
        };
        await db.put('tabs', saved);
        status.textContent = `Saved "${saved.title}" to the tab library.`;
        pipeline.innerHTML = '';
        reparseActive = null;
        renderLibrary();
      },
    });

    pipeline.append(
      el('h3', { text: 'Confirm import' }),
      el('div', { class: 'row' }, titleInput, tuningSelect, tsSelect),
      format === 'ascii'
        ? el('div', { class: 'row' }, orderSelect, rhythmSelect, guitarTuningField)
        : guitarTuningField,
      warningsBox,
      ambiguousBox,
      el('div', { class: 'row' }, editNotesButton, addNoteButton),
      editorWrap,
      preview,
      el('div', { class: 'row' }, saveBtn,
        el('button', { type: 'button', class: 'secondary', text: 'Cancel', onClick: () => { pipeline.innerHTML = ''; reparseActive = null; } })),
    );
    refreshWarnings();
    renderPreview();
    renderAmbiguous();
  }

  /** Labels top-to-bottom of the first tab block, for the reversed order map. */
  function reversedStringMap(text) {
    const labels = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Ga-g0-9#])\s*[|:\-]/.exec(line);
      if (m) {
        labels.push(m[1]);
        if (labels.length >= 6) break;
      } else if (labels.length) break;
    }
    const map = {};
    labels.forEach((l, i) => { map[l] = labels.length - i; });
    return map;
  }

  function runParser(format, rawText, sourceLabel, baseOptions = {}) {
    const parseOptions = { ...baseOptions, guitarTuning: 'standard' };
    const result = parseTab(format, rawText, parseOptions);
    if (!result.ok) {
      status.textContent = result.error;
      return;
    }
    showConfirm({ format, rawText, parseOptions, sourceLabel, initial: result });
  }

  function detectFormat(text) {
    const t = text.trimStart();
    return t.startsWith('<') ? 'musicxml' : 'ascii';
  }

  // ---- paste ----
  const pasteBox = el('textarea', { 'aria-label': 'Pasted tab text', placeholder: 'Paste ASCII tab or MusicXML here...' });
  const pastePane = el('div', {},
    el('p', { class: 'small muted', text: 'ASCII tab blocks are detected automatically (lines with string labels, dashes and fret numbers). MusicXML text is detected by its XML header.' }),
    pasteBox,
    el('div', { class: 'row' }, el('button', {
      type: 'button', text: 'Parse',
      onClick: () => {
        const text = pasteBox.value;
        if (!text.trim()) { status.textContent = 'Nothing to parse yet.'; return; }
        runParser(detectFormat(text), text, 'Pasted text');
      },
    })),
  );

  // ---- file upload and drop ----
  const fileInput = el('input', {
    type: 'file', accept: '.txt,.musicxml,.xml,.mxl,text/plain,application/xml',
    onChange: (e) => handleFile(e.target.files[0]),
  });
  const dropZone = el('div', {
    class: 'panel', tabindex: '0', role: 'button',
    'aria-label': 'Drop a tab file here or press Enter to choose a file',
    text: 'Drop a .txt, .musicxml or .xml file here, or choose a file.',
  });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });

  async function handleFile(file) {
    if (!file) return;
    if (/\.mxl$/i.test(file.name)) {
      status.textContent = 'This looks like a compressed .mxl file. Please export it as uncompressed MusicXML (.musicxml or .xml) and try again.';
      return;
    }
    const text = await file.text();
    const format = /\.musicxml$|\.xml$/i.test(file.name) ? 'musicxml' : detectFormat(text);
    runParser(format, text, `File: ${file.name}`);
  }

  const filePane = el('div', {}, fileInput, dropZone);

  // ---- link import ----
  const urlInput = el('input', { type: 'url', size: 50, 'aria-label': 'Tab URL', placeholder: 'https://raw.githubusercontent.com/...' });
  const linkPane = el('div', {},
    el('div', { class: 'notice', text: 'This will contact the site you enter. Only the exact URL you type is fetched; nothing else is sent.' }),
    el('div', { class: 'row' }, urlInput, el('button', {
      type: 'button', text: 'Import from link',
      onClick: async () => {
        const url = urlInput.value.trim();
        if (!url) { status.textContent = 'Enter a URL first.'; return; }
        status.textContent = `Contacting ${new URL(url).host} ...`;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          runParser(detectFormat(text), text, `Link: ${url}`);
        } catch (err) {
          status.textContent = 'The browser could not fetch that URL. Sites like most tab archives do not allow cross-origin fetching. ' +
            'Open the link in a new tab, copy the tab text, and paste it into the paste box. ' +
            `Raw files on raw.githubusercontent.com and GitHub Gists usually work. (${err.message})`;
        }
      },
    })),
    el('p', { class: 'small muted', text: 'Compressed .mxl links cannot be handled; export uncompressed MusicXML first.' }),
  );

  // ---- source tabs ----
  const panes = { paste: pastePane, file: filePane, link: linkPane };
  const tabRow = el('div', { class: 'row' });
  let currentPane = 'paste';
  function showPane(name) {
    currentPane = name;
    for (const [k, pane] of Object.entries(panes)) pane.classList.toggle('hidden', k !== name);
    for (const b of tabRow.querySelectorAll('button')) {
      b.classList.toggle('secondary', b.dataset.pane !== name);
    }
  }
  for (const [key, label] of [['paste', 'Paste text'], ['file', 'Upload or drop file'], ['link', 'Import from link']]) {
    const b = el('button', { type: 'button', text: label, onClick: () => showPane(key) });
    b.dataset.pane = key;
    tabRow.append(b);
  }

  // ---- saved tab library ----
  async function renderLibrary() {
    const db = await app.getDb();
    const tabs = (await db.getAll('tabs')).sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
    libraryWrap.innerHTML = '';
    libraryWrap.append(el('h3', { text: 'Saved tabs' }));
    if (!tabs.length) {
      libraryWrap.append(el('p', { class: 'muted', text: 'No imported tabs yet.' }));
      return;
    }
    const table = el('table');
    table.append(el('tr', {}, el('th', { text: 'Title' }), el('th', { text: 'Source' }), el('th', { text: 'Imported' }), el('th', { text: 'Measures' }), el('th', { text: 'Note' }), el('th', { text: '' })));
    for (const t of tabs) {
      const titleCell = el('td', {}, el('input', {
        type: 'text', value: t.title, 'aria-label': 'Rename tab',
        onChange: async (e) => { t.title = e.target.value; await db.put('tabs', t); },
      }));
      const noteCell = el('td', {}, el('input', {
        type: 'text', value: t.userNote || '', size: 18, 'aria-label': 'Tab note',
        onChange: async (e) => { t.userNote = e.target.value; await db.put('tabs', t); },
      }));
      table.append(el('tr', {},
        titleCell,
        el('td', { class: 'small', text: t.source || '-' }),
        el('td', { class: 'small', text: t.importedAt ? new Date(t.importedAt).toLocaleDateString() : '-' }),
        el('td', { class: 'mono', text: String(measureCount(t)) }),
        noteCell,
        el('td', {},
          el('button', {
            type: 'button', class: 'link', text: 'Open',
            onClick: () => { app.pendingTabId = t.id; app.navigate('#/tab'); },
          }),
          ' ',
          el('button', {
            type: 'button', class: 'link', text: 'Delete',
            onClick: async () => { await db.delete('tabs', t.id); renderLibrary(); },
          })),
      ));
    }
    libraryWrap.append(table);
    libraryWrap.append(el('p', { class: 'muted small', text: 'Opening a tab loads it into the Tab view for playback, looping and assessment.' }));
  }

  container.append(
    el('h2', { text: 'Import tabs' }),
    rightsNote,
    el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, el('span', { text: 'Source tab type' }), sourceTypeSelect)),
      el('p', { class: 'small muted', text: 'For ASCII guitar tabs, use six lines ordered from the highest string to the lowest. Guitar notes are remapped to playable banjo strings; out-of-range notes may be shifted by octaves.' }),
      tabRow, pastePane, filePane, linkPane, status),
    pipeline,
    libraryWrap,
  );
  showPane('paste');
  renderLibrary();

  return { unmount() {} };
}
