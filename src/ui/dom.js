// Tiny DOM helpers shared by the view modules (no framework).
// NOTE: addition to the C1 layout — a shared helper for the view files.

/** Create an element with attributes, classes and children. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Number input with clamping. */
export function numberInput(value, { min, max, step = 1, onInput, label }) {
  const input = el('input', {
    type: 'number', value, min, max, step,
    'aria-label': label || '',
    onInput: (e) => {
      let v = parseFloat(e.target.value);
      if (Number.isNaN(v)) return;
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      onInput && onInput(v);
    },
  });
  return input;
}

/** Labeled select; options: [[value, labelText], ...] */
export function select(options, value, onChange, label) {
  const s = el('select', { 'aria-label': label || '', onChange: (e) => onChange(e.target.value) });
  for (const [v, text] of options) {
    s.append(el('option', { value: v, text, selected: v === String(value) }));
  }
  return s;
}

/** Labeled range slider returning { root, input }. */
export function slider({ min, max, step = 1, value, label, onInput }) {
  const input = el('input', {
    type: 'range', min, max, step, value,
    'aria-label': label || '',
    onInput: (e) => onInput(parseFloat(e.target.value)),
  });
  const root = el('label', { class: 'field' }, el('span', { text: label }), input);
  return { root, input };
}
