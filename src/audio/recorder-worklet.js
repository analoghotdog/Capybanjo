// AudioWorklet processor: collects input PCM and reports the exact audio-clock
// frame at which recording began, plus the frame of every chunk so dropped
// chunks can be detected. Silent passthrough keeps the graph running.
// Message protocol (see src/audio/recorder-core.js):
//   main -> worklet: { type: 'start' } | { type: 'stop' }
//   worklet -> main: { type: 'started', frame, sampleRate }
//                   { type: 'chunk', frame, samples: Float32Array }
//                   { type: 'stopped' }

class BanjoRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => {
      const data = e.data;
      const type = typeof data === 'string' ? data : data && data.type;
      if (type === 'start') {
        this.recording = true;
        // currentFrame/sampleRate are AudioWorkletGlobalScope globals: this is
        // the measured origin of the recording on the audio clock.
        this.port.postMessage({ type: 'started', frame: currentFrame, sampleRate });
      } else if (type === 'stop') {
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (this.recording && input && input[0] && input[0].length) {
      this.port.postMessage({
        type: 'chunk',
        frame: currentFrame,
        samples: new Float32Array(input[0]),
      });
    }
    return true;
  }
}

registerProcessor('banjo-recorder', BanjoRecorder);
