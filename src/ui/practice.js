import { el, numberInput, select } from './dom.js';
import {
  deleteRollDefinition,
  expandRoll,
  loadRollDefinitions,
  resetRollDefinition,
  saveRollDefinition,
} from '../tab/library.js';
import { measureCount } from '../tab/model.js';

const ROUTINES_KEY = 'practiceRoutines';

export function mountPractice(container, app) {
  let exercises = [];
  let rollDefinitions = [];
  let routines = [];
  let builderSteps = [];
  const status = el('p', { class: 'muted small', text: '' });
  const rollStatus = el('p', { class: 'muted small', text: '' });
  const guide = el('div', { class: 'panel', hidden: true });
  const rollList = el('div');
  const rollEditor = el('div', { class: 'panel', hidden: true });
  const rollPattern = el('div');
  let editingRollKey = null;
  let rollDraft = null;
  const routineList = el('div');
  const builderList = el('div');

  const exerciseOptions = () => exercises.map(({ tab }) => [tab.id, tab.title]);
  const focusExercise = select([], '', () => updateFocusHint(), 'Exercise for focused drill');
  const routineExercise = select([], '', () => updateRoutineHint(), 'Exercise to add');
  const focusHint = el('p', { class: 'muted small', text: '' });
  const routineHint = el('p', { class: 'muted small', text: '' });

  function selectedExercise(control) {
    return exercises.find(({ tab }) => tab.id === control.value)?.tab || null;
  }

  function settingField(labelText, control) {
    return el('label', { class: 'field' }, el('span', { text: labelText }), control);
  }

  const rollTitle = el('input', { type: 'text', 'aria-label': 'Roll name', maxLength: 80 });
  const rollMeasures = numberInput(4, { min: 1, max: 32, label: 'Measures' });
  const rollTempo = numberInput(60, { min: 30, max: 240, label: 'Starting BPM' });

  function renderRollPattern() {
    rollPattern.innerHTML = '';
    const table = el('table');
    table.append(el('tr', {},
      el('th', { text: 'Step' }),
      el('th', { text: 'String' }),
      el('th', { text: 'Finger' }),
    ));
    rollDraft.pattern.strings.forEach((string, index) => {
      table.append(el('tr', {},
        el('th', { scope: 'row', text: String(index + 1) }),
        el('td', {}, select(
          [1, 2, 3, 4, 5].map((value) => [String(value), `String ${value}`]),
          String(string),
          (value) => { rollDraft.pattern.strings[index] = Number(value); },
          `Step ${index + 1} string`,
        )),
        el('td', {}, select(
          [['T', 'Thumb'], ['I', 'Index'], ['M', 'Middle']],
          rollDraft.pattern.fingers[index],
          (value) => { rollDraft.pattern.fingers[index] = value; },
          `Step ${index + 1} finger`,
        )),
      ));
    });
    rollPattern.append(table);
  }

  function openRollEditor(definition) {
    editingRollKey = definition ? definition.key : null;
    rollDraft = definition ? {
      ...definition,
      timeSignature: [...definition.timeSignature],
      pattern: {
        strings: [...definition.pattern.strings],
        fingers: [...definition.pattern.fingers],
      },
    } : {
      key: '',
      title: '',
      tuning: 'openG',
      timeSignature: [4, 4],
      tempoHint: 60,
      measures: 4,
      pattern: {
        strings: [3, 2, 1, 3, 2, 1, 3, 2],
        fingers: ['T', 'I', 'M', 'T', 'I', 'M', 'T', 'I'],
      },
    };
    rollTitle.value = rollDraft.title;
    rollMeasures.value = rollDraft.measures;
    rollTempo.value = rollDraft.tempoHint;
    rollStatus.textContent = '';
    renderRollPattern();
    rollEditor.hidden = false;
  }

  function renderRollList() {
    rollList.innerHTML = '';
    if (!rollDefinitions.length) {
      rollList.append(el('p', { class: 'muted', text: 'No rolls available.' }));
      return;
    }
    for (const roll of rollDefinitions) {
      const actions = [
        el('button', { type: 'button', class: 'secondary', text: 'Edit', onClick: () => openRollEditor(roll) }),
      ];
      if (roll.builtIn && roll.customized) {
        actions.push(el('button', {
          type: 'button',
          class: 'link',
          text: 'Reset',
          onClick: async () => {
            try {
              await resetRollDefinition(app.settings, roll.key);
              await loadPage();
              rollStatus.textContent = `${roll.title} restored to its original pattern.`;
            } catch (err) {
              rollStatus.textContent = `Could not reset the roll: ${err.message}`;
            }
          },
        }));
      } else if (!roll.builtIn) {
        actions.push(el('button', {
          type: 'button',
          class: 'link',
          text: 'Delete',
          onClick: async () => {
            try {
              await deleteRollDefinition(app.settings, roll.key);
              await loadPage();
              rollStatus.textContent = `${roll.title} deleted.`;
            } catch (err) {
              rollStatus.textContent = `Could not delete the roll: ${err.message}`;
            }
          },
        }));
      }
      rollList.append(el('div', { class: 'panel' },
        el('h4', { text: roll.title }),
        el('p', { class: 'muted small', text: `${roll.builtIn ? 'Built-in' : 'My roll'} · ${roll.pattern.strings.length} eighth-note steps · ${roll.measures} measures` }),
        el('div', { class: 'row' }, actions),
      ));
    }
  }

  const saveRollButton = el('button', {
    type: 'button',
    text: 'Save roll',
    onClick: async () => {
      const title = rollTitle.value.trim();
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const roll = {
        ...rollDraft,
        key: editingRollKey || `custom-${slug || 'roll'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        measures: rollMeasures.valueAsNumber,
        tempoHint: rollTempo.valueAsNumber,
      };
      try {
        await saveRollDefinition(app.settings, roll);
        rollEditor.hidden = true;
        await loadPage();
        rollStatus.textContent = `${title} saved on this device.`;
      } catch (err) {
        rollStatus.textContent = `Could not save the roll: ${err.message}`;
      }
    },
  });
  const cancelRollEditButton = el('button', {
    type: 'button',
    class: 'secondary',
    text: 'Cancel',
    onClick: () => { rollEditor.hidden = true; },
  });
  rollEditor.append(
    el('h4', { text: 'Roll details' }),
    settingField('Roll name', rollTitle),
    el('div', { class: 'row' }, settingField('Measures', rollMeasures), settingField('Starting BPM', rollTempo)),
    el('p', { class: 'muted small', text: 'Each step plays an open-string eighth note. Choose its string and picking finger.' }),
    rollPattern,
    el('div', { class: 'row' }, saveRollButton, cancelRollEditButton),
  );

  function boundsFor(tab) {
    const count = tab ? Math.max(1, measureCount(tab)) : 1;
    return { count, max: Math.max(1, count) };
  }

  const focusStart = numberInput(1, { min: 1, max: 999, label: 'First measure' });
  const focusEnd = numberInput(1, { min: 1, max: 999, label: 'Last measure' });
  const focusBpm = numberInput(60, { min: 30, max: 240, label: 'Starting BPM' });
  const focusTargetBpm = numberInput(80, { min: 30, max: 240, label: 'Target BPM' });
  const focusStep = numberInput(5, { min: 1, max: 50, label: 'BPM increase' });
  const focusCleanPasses = numberInput(2, { min: 1, max: 10, label: 'Clean passes per step' });

  function updateFocusHint() {
    const tab = selectedExercise(focusExercise);
    const { count } = boundsFor(tab);
    focusStart.max = count;
    focusEnd.max = count;
    focusHint.textContent = tab
      ? `${count} measure(s). The selected section will loop continuously; the speed trainer can raise tempo after clean passes.`
      : 'Choose a roll or tab to practice a measure range.';
  }

  const routineName = el('input', { type: 'text', 'aria-label': 'Routine name', placeholder: 'e.g. Warm-up' });
  const routineStart = numberInput(1, { min: 1, max: 999, label: 'First measure' });
  const routineEnd = numberInput(1, { min: 1, max: 999, label: 'Last measure' });

  function updateRoutineHint() {
    const tab = selectedExercise(routineExercise);
    const { count } = boundsFor(tab);
    routineStart.max = count;
    routineEnd.max = count;
    routineHint.textContent = tab
      ? `${count} measure(s) in this exercise. Add a section to the routine.`
      : 'Choose a roll or tab to add to the routine.';
  }

  function renderBuilderSteps() {
    builderList.innerHTML = '';
    if (!builderSteps.length) {
      builderList.append(el('p', { class: 'muted small', text: 'No steps added yet.' }));
      return;
    }
    const list = el('ol');
    builderSteps.forEach((step, index) => {
      const exercise = exercises.find(({ tab }) => tab.id === step.exerciseId)?.tab;
      list.append(el('li', {},
        `${exercise ? exercise.title : 'Missing exercise'} - measures ${step.startMeasure + 1}-${step.endMeasure + 1} `,
        el('button', {
          type: 'button', class: 'link', text: 'Remove',
          onClick: () => { builderSteps.splice(index, 1); renderBuilderSteps(); },
        }),
      ));
    });
    builderList.append(list);
  }

  function renderRoutines() {
    routineList.innerHTML = '';
    if (!routines.length) {
      routineList.append(el('p', { class: 'muted', text: 'No routines saved yet.' }));
      return;
    }
    for (const routine of routines) {
      const details = routine.steps.map((step) => {
        const exercise = exercises.find(({ tab }) => tab.id === step.exerciseId)?.tab;
        return exercise
          ? `${exercise.title} (measures ${step.startMeasure + 1}-${step.endMeasure + 1})`
          : 'Missing exercise';
      }).join(' -> ');
      routineList.append(el('div', { class: 'panel' },
        el('h3', { text: routine.name }),
        el('p', { class: 'muted small', text: details }),
        el('div', { class: 'row' },
          el('button', { type: 'button', text: 'Start routine', onClick: () => startRoutine(routine) }),
          el('button', {
            type: 'button', class: 'secondary', text: 'Delete',
            onClick: async () => {
              try {
                routines = routines.filter((item) => item.id !== routine.id);
                await app.settings.set(ROUTINES_KEY, routines);
                renderRoutines();
              } catch (err) {
                status.textContent = `Could not delete the routine: ${err.message}`;
              }
            },
          }),
        ),
      ));
    }
  }

  async function startRoutine(routine) {
    const first = routine.steps[0];
    if (!first || !exercises.some(({ tab }) => tab.id === first.exerciseId)) {
      status.textContent = "This routine's first exercise is missing. Edit or delete the routine.";
      return;
    }
    app.activeRoutine = {
      id: routine.id,
      name: routine.name,
      steps: routine.steps.map((step) => ({ ...step })),
      index: 0,
    };
    app.pendingTabId = first.exerciseId;
    app.navigate('#/tab');
  }

  function startFocusedDrill() {
    const tab = selectedExercise(focusExercise);
    if (!tab) {
      status.textContent = 'Choose an exercise for the focused drill.';
      return;
    }
    const speedSettings = {
      startBpm: focusBpm.valueAsNumber,
      targetBpm: focusTargetBpm.valueAsNumber,
      step: focusStep.valueAsNumber,
      requiredClean: focusCleanPasses.valueAsNumber,
    };
    if (Object.values(speedSettings).some((value) => !Number.isFinite(value))
      || speedSettings.targetBpm < speedSettings.startBpm) {
      status.textContent = 'Enter valid speeds and make the target BPM at least as high as the starting BPM.';
      return;
    }
    const { count } = boundsFor(tab);
    const startMeasure = Math.min(count, Math.max(1, focusStart.valueAsNumber || 1));
    const endMeasure = Math.min(count, Math.max(startMeasure, focusEnd.valueAsNumber || startMeasure));
    app.activeRoutine = {
      id: `focus:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      name: `Focused drill: ${tab.title}`,
      index: 0,
      speedSettings,
      steps: [{
        exerciseId: tab.id,
        startMeasure: startMeasure - 1,
        endMeasure: endMeasure - 1,
        bpm: focusBpm.valueAsNumber,
      }],
    };
    app.pendingTabId = tab.id;
    app.navigate('#/tab');
  }

  const startFocusButton = el('button', {
    type: 'button', text: 'Start focused drill', onClick: startFocusedDrill,
  });
  const addStepButton = el('button', {
    type: 'button', class: 'secondary', text: 'Add exercise section',
    onClick: () => {
      const tab = selectedExercise(routineExercise);
      if (!tab) {
        status.textContent = 'Choose an exercise to add to the routine.';
        return;
      }
      const { count } = boundsFor(tab);
      const startMeasure = Math.min(count, Math.max(1, routineStart.valueAsNumber || 1));
      const endMeasure = Math.min(count, Math.max(startMeasure, routineEnd.valueAsNumber || startMeasure));
      builderSteps.push({
        exerciseId: tab.id,
        startMeasure: startMeasure - 1,
        endMeasure: endMeasure - 1,
      });
      status.textContent = '';
      renderBuilderSteps();
    },
  });
  const saveRoutineButton = el('button', {
    type: 'button',
    text: 'Save routine',
    onClick: async () => {
      const name = routineName.value.trim();
      if (!name || !builderSteps.length) {
        status.textContent = 'Enter a routine name and add at least one exercise section.';
        return;
      }
      try {
        routines.push({
          id: `routine:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          name,
          steps: builderSteps.map((step) => ({ ...step })),
        });
        await app.settings.set(ROUTINES_KEY, routines);
        routineName.value = '';
        builderSteps = [];
        renderBuilderSteps();
        renderRoutines();
        status.textContent = 'Routine saved on this device.';
      } catch (err) {
        status.textContent = `Could not save the routine: ${err.message}`;
      }
    },
  });

  const guideContent = el('div', {},
    el('h3', { text: 'A quick start' }),
    el('ol', {},
      el('li', { text: 'Choose a roll or tab, then press Play. A count-in helps you get ready.' }),
      el('li', { text: 'Use a focused drill to repeat a measure range, or build a routine from several sections.' }),
      el('li', { text: 'The microphone is optional. Allow access only when you want automatic timing assessment.' }),
    ),
    el('p', { class: 'muted small', text: 'Your tabs, routines, settings and practice data stay in this browser. The app works offline after it has loaded.' }),
    el('div', { class: 'row' },
      el('button', { type: 'button', text: 'Start with a roll', onClick: startFirstRoll }),
      el('button', { type: 'button', class: 'secondary', text: 'Open metronome', onClick: () => app.navigate('#/metronome') }),
    ),
  );
  const guideStatus = el('p', { class: 'muted small', text: '' });
  const guideDismiss = el('button', {
    type: 'button', class: 'secondary', text: 'Hide quick start',
    onClick: async () => {
      try {
        await app.settings.set('quickStartDismissed', true);
        guide.hidden = true;
        guideStatus.textContent = 'You can reopen the quick start any time.';
      } catch (err) {
        guideStatus.textContent = `Could not save this preference: ${err.message}`;
      }
    },
  });
  const guideToggle = el('button', {
    type: 'button', class: 'link', text: 'Show quick start',
    onClick: () => { guide.hidden = false; guideStatus.textContent = ''; },
  });
  guide.append(guideContent, guideDismiss);

  function startFirstRoll() {
    const roll = exercises.find(({ origin }) => origin === 'roll');
    if (!roll) {
      status.textContent = 'The roll library could not be loaded.';
      return;
    }
    app.pendingTabId = roll.tab.id;
    app.navigate('#/tab');
  }

  const focusPanel = el('div', { class: 'panel' },
    el('h3', { text: 'Focused drill' }),
    el('p', { class: 'muted small', text: 'Loop one measure or a phrase and work toward a faster clean tempo.' }),
    el('div', { class: 'row' }, focusExercise, settingField('Start measure', focusStart), settingField('End measure', focusEnd)),
    el('div', { class: 'row' },
      settingField('Start BPM', focusBpm),
      settingField('Target BPM', focusTargetBpm),
      settingField('Increase by (BPM)', focusStep),
      settingField('Clean loops per step', focusCleanPasses),
      startFocusButton,
    ),
    focusHint,
  );

  const rollPanel = el('div', { class: 'panel' },
    el('h3', { text: 'Roll library' }),
    el('p', { class: 'muted small', text: 'Edit built-in rolls or create your own. Changes are saved on this device and appear in the Tab and Record exercise lists.' }),
    el('div', { class: 'row' },
      el('button', { type: 'button', text: 'Add roll', onClick: () => openRollEditor(null) }),
    ),
    rollEditor,
    rollList,
    rollStatus,
  );

  const routinesPanel = el('div', { class: 'panel' },
    el('h3', { text: 'Practice routines' }),
    el('p', { class: 'muted small', text: 'Build a repeatable sequence from rolls or saved tabs. Each step loops its chosen measures until you move on.' }),
    settingField('Routine name', routineName),
    el('div', { class: 'row' }, routineExercise, settingField('Start measure', routineStart), settingField('End measure', routineEnd), addStepButton),
    builderList,
    el('div', { class: 'row' }, saveRoutineButton),
    routineList,
  );

  async function loadPage() {
    try {
      rollDefinitions = await loadRollDefinitions(app.settings);
      renderRollList();
      const db = await app.getDb();
      const imported = await db.getAll('tabs');
      exercises = [
        ...rollDefinitions.map((roll) => ({ tab: expandRoll(roll), origin: 'roll' })),
        ...imported.map((tab) => ({ tab, origin: 'import' })),
      ];
      const options = exerciseOptions();
      for (const control of [focusExercise, routineExercise]) {
        control.innerHTML = '';
        for (const [value, text] of options) control.append(el('option', { value, text }));
      }
      updateFocusHint();
      updateRoutineHint();
      routines = await app.settings.get(ROUTINES_KEY, []);
      if (!Array.isArray(routines) || routines.some((routine) =>
        !routine || typeof routine.id !== 'string' || typeof routine.name !== 'string'
        || !Array.isArray(routine.steps) || routine.steps.length === 0
        || routine.steps.some((step) => !step || typeof step.exerciseId !== 'string'
          || !Number.isInteger(step.startMeasure) || step.startMeasure < 0
          || !Number.isInteger(step.endMeasure) || step.endMeasure < step.startMeasure))) {
        throw new Error('Saved practice routines have an invalid format.');
      }
      renderBuilderSteps();
      renderRoutines();
      guide.hidden = await app.settings.get('quickStartDismissed', false);
    } catch (err) {
      status.textContent = `Could not load practice data: ${err.message}`;
      console.error('practice page load failed', err);
    }
  }

  container.append(
    el('h2', { text: 'Practice' }),
    guide,
    guideStatus,
    guideToggle,
    rollPanel,
    focusPanel,
    routinesPanel,
    status,
  );
  loadPage();

  return { unmount() {} };
}
