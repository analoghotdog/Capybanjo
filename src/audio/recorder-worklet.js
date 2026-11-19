// AudioWorklet processor: collects input PCM and posts chunks to the main
// thread. Silent passthrough so the graph keeps running.

class BanjoRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.recording = true; }
      else if (e.data === 'stop') { this.recording = false; }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (this.recording && input && input[0] && input[0].length) {
      // Copy: the underlying buffer is reused between callbacks.
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}

registerProcessor('banjo-recorder', BanjoRecorder);
