/** Sons minimalistes en WebAudio : moteur, anneau, choc. */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private master: GainNode | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("rcsim.muted") === "1";
    } catch { /* ignore */ }
  }

  /** À appeler après un geste utilisateur. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    this.engineGain.connect(filter).connect(this.master);
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 70;
    this.engineOsc.connect(this.engineGain);
    this.engineOsc.start();
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = "square";
    this.engineOsc2.frequency.value = 140;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.35;
    this.engineOsc2.connect(g2).connect(this.engineGain);
    this.engineOsc2.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem("rcsim.muted", this.muted ? "1" : "0"); } catch { /* ignore */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  setEngine(throttle: number, airspeed: number, running: boolean, type: "prop" | "jet" = "prop"): void {
    if (!this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain) return;
    const t = this.ctx.currentTime;
    const level = running ? 0.02 + throttle * (type === "jet" ? 0.07 : 0.11) : 0;
    this.engineGain.gain.setTargetAtTime(level, t, 0.08);
    const f = type === "jet" ? 90 + throttle * 420 + airspeed * 2 : 60 + throttle * 190 + airspeed * 1.5;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.1);
    this.engineOsc2.frequency.setTargetAtTime(f * (type === "jet" ? 3.02 : 2.01), t, 0.1);
  }

  ding(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    for (const [freq, delay] of [[880, 0], [1320, 0.12]] as const) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.25, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.5);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + 0.6);
    }
  }

  crash(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = 0.4;
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * len), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }
}
