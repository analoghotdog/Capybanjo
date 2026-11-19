// Shared AudioContext. Created on first user gesture and resumed on demand.
// See build plan Step 2.

let ctx = null;

export function getAudioContext() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not supported in this browser');
    ctx = new AC();
  }
  return ctx;
}

/** Resume if suspended (browsers require a user gesture). */
export async function ensureAudio() {
  const c = getAudioContext();
  if (c.state === 'suspended') await c.resume();
  return c;
}

/**
 * Attach one-shot listeners so the context is created and resumed on the first
 * user gesture. Returns a detach function.
 */
export function initAudioOnGesture() {
  const handler = () => {
    ensureAudio().catch(() => {});
    detach();
  };
  const detach = () => {
    globalThis.removeEventListener?.('pointerdown', handler);
    globalThis.removeEventListener?.('keydown', handler);
  };
  globalThis.addEventListener?.('pointerdown', handler, { once: true });
  globalThis.addEventListener?.('keydown', handler, { once: true });
  return detach;
}
