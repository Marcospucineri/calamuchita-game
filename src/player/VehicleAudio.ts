import { bindAudioFocus } from '../engine/AudioFocus';

/**
 * Sonido de motor sintetizado con WebAudio (sin archivos):
 * dos osciladores filtrados + ruido para el ripio y viento ambiente.
 */
export class VehicleAudio {
  private ctx: AudioContext | null = null;
  private engGain!: GainNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private gravelGain!: GainNode;
  private windGain!: GainNode;
  private master!: GainNode;
  muted = false;

  /** Campanita de aviso (dos notas con decaimiento), respeta el silencio. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [[880, 0], [1318.5, 0.14]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const h = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      h.type = 'sine';
      o.frequency.value = f;
      h.frequency.value = f * 2.76;
      const hg = ctx.createGain();
      hg.gain.value = 0.18;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.1);
      o.connect(g);
      h.connect(hg).connect(g);
      g.connect(ctx.destination);
      o.start(t + d);
      h.start(t + d);
      o.stop(t + d + 1.2);
      h.stop(t + d + 1.2);
    });
  }

  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    bindAudioFocus(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = 0.22; // Motor y ambiente suaves, unos 8 dB menos.
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.filter.Q.value = 2;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.filter.connect(this.engGain).connect(this.master);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.osc1.start();
    this.osc2.start();

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type: BiquadFilterType, f: number) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const fl = ctx.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(fl).connect(g).connect(this.master);
      src.start();
      return g;
    };
    this.gravelGain = mk('bandpass', 1800);
    this.windGain = mk('lowpass', 400);
  }

  update(driving: boolean, speed: number, throttle: number, rough: number, flying = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.abs(speed);
    // cambios simulados: 4 marchas
    const gears = [0, 9, 17, 26, 50];
    let g = 1;
    while (g < 4 && v > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g];
    const rpm = 0.25 + 0.75 * Math.min(1, (v - lo) / (hi - lo + 1e-3));
    const base = flying ? 55 + throttle * 75 : driving ? 38 + rpm * 70 + throttle * 12 : 30;
    this.osc1.frequency.setTargetAtTime(base, t, 0.05);
    this.osc2.frequency.setTargetAtTime(base * (flying ? 1.01 : 0.5), t, 0.05);
    this.filter.frequency.setTargetAtTime(flying ? 600 + throttle * 1000 : 350 + rpm * 900 + throttle * 600, t, 0.08);
    const vol = this.muted ? 0 : driving ? 0.12 + throttle * 0.12 : 0;
    this.engGain.gain.setTargetAtTime(vol, t, 0.1);
    this.gravelGain.gain.setTargetAtTime(this.muted || !driving ? 0 : Math.min(1, v / 20) * rough * 0.12, t, 0.1);
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : 0.03 + Math.min(1, v / 40) * 0.08, t, 0.3);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}
