export class ToyAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.lastSoundAt = 0;
  }

  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) {
        this.enabled = false;
        return false;
      }
      this.context ??= new AudioContextClass();
      if (this.context.state === "suspended") await this.context.resume();
      this.ping(520, 0.045, 0.025);
    } else if (this.context?.state === "running") {
      await this.context.suspend();
    }
    return this.enabled;
  }

  handle(events) {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    for (const event of events) {
      if (event.type === "poke") this.ping(340, 0.055, 0.032);
      if (event.type === "landed") this.plop(event.intensity);
      if (event.type === "merged") {
        this.ping(260 + event.tier * 70, 0.14, 0.04);
        this.ping(420 + event.tier * 90, 0.11, 0.026);
      }
      if (event.type === "split") this.ping(610, 0.12, 0.036);
      if (event.type === "burst") {
        this.ping(760, 0.16, 0.04);
        this.ping(1120, 0.1, 0.026);
      }
      if (event.type === "goal-collected") this.ping(540 + Math.min(5, event.combo) * 72, 0.12, 0.034);
      if (event.type === "time-ended") this.ping(280, 0.22, 0.04);
    }
  }

  ping(frequency, duration, volume) {
    if (!this.context || this.context.currentTime - this.lastSoundAt < 0.025) return;
    this.lastSoundAt = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.76, this.context.currentTime + duration);
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
  }

  plop(intensity = 0.5) {
    const strength = Math.max(0.2, Math.min(1, intensity));
    this.ping(150 + strength * 45, 0.085 + strength * 0.04, 0.018 + strength * 0.025);
  }
}
