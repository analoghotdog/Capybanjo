import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuitarNoteMapper } from '../src/tab/guitar-conversion.js';
import { parseAsciiTab } from '../src/tab/parse-ascii.js';
import { parseMusicXML } from '../src/tab/parse-musicxml.js';
import { validateTab } from '../src/tab/model.js';

test('guitar note mapper preserves playable pitch and shifts low notes by octaves', () => {
  const mapper = createGuitarNoteMapper('standard', 'openG');
  assert.deepEqual(mapper.mapNote({ midi: 64, startBeat: 0 }), {
    string: 1, fret: 2, octaveShift: 0,
  });
  assert.deepEqual(mapper.mapNote({ midi: 40, startBeat: 1 }), {
    string: 4, fret: 2, octaveShift: 1,
  });
  assert.deepEqual(mapper.getStats(), { shiftedNotes: 1, droppedNotes: 0 });
});

test('ASCII guitar conversion keeps all six source strings and returns a valid banjo tab', () => {
  const lines = [
    'e|-----|',
    'B|-----|',
    'G|-----|',
    'D|-----|',
    'A|-----|',
    'E|--0--|',
  ];
  const mapper = createGuitarNoteMapper('standard', 'openG');
  const result = parseAsciiTab(lines.join('\n'), {
    stringCount: 6,
    noteTransform: mapper.mapNote,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(validateTab(result.tab).ok, true);
  assert.deepEqual(
    result.tab.notes.map(({ string, fret, startBeat }) => [string, fret, startBeat]),
    [[4, 2, 0]],
  );
  assert.ok(result.warnings.some((warning) => /Shifted 1 guitar note/.test(warning)));
});

test('MusicXML guitar conversion remaps six-string pitches instead of dropping string 6', () => {
  const xml = `<score-partwise>
    <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>1</duration>
        <technical><string>6</string><fret>0</fret></technical></note>
    </measure></part>
  </score-partwise>`;
  const mapper = createGuitarNoteMapper('standard', 'openG');
  const result = parseMusicXML(xml, { noteTransform: mapper.mapNote });

  assert.equal(result.ok, true, result.error);
  assert.equal(validateTab(result.tab).ok, true);
  assert.deepEqual(
    result.tab.notes.map(({ string, fret }) => [string, fret]),
    [[4, 2]],
  );
  assert.ok(result.warnings.some((warning) => /Shifted 1 guitar note/.test(warning)));
  assert.ok(!result.warnings.some((warning) => /strings 6\+/.test(warning)));
});
