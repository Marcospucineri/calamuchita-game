/**
 * Música de fondo: tres temas en loop y silencio, se ciclan con N (o el botón "Música").
 * Cada tema se decodifica con WebAudio, se le recortan los silencios de los bordes y se
 * funde el final con el principio para que el loop no tenga corte. El volumen se iguala
 * entre temas para que todos suenen bajito, de fondo.
 */
const TRACKS = [
  { file: 'music/sound-effect-29.mp3', name: 'Tema 1' },
  { file: 'music/sound-effect-641.mp3', name: 'Tema 2' },
  { file: 'music/sound-effect-1467.mp3', name: 'Tema 3' },
];
const KEY = 'calamuchita.music';
/** Nivel RMS al que se lleva cada tema (bajo: es música de fondo). */
const TARGET_RMS = 0.07;
/** Duración del fundido entre el final y el principio del loop (s). */
const SEAM = 0.6;
const FADE = 1.4;

type Playing = { src: AudioBufferSourceNode; gain: GainNode };

export class Music {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private loops = new Map<number, Promise<{ buffer: AudioBuffer; gain: number } | null>>();
  private playing: Playing | null = null;
  private token = 0;
  /** 0..TRACKS.length-1 = tema; TRACKS.length = silencio. */
  index = 0;

  constructor() {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (Number.isInteger(v) && v >= 0 && v <= TRACKS.length) this.index = v;
    } catch { /* sin almacenamiento */ }
  }

  get label(): string {
    return this.index < TRACKS.length ? TRACKS[this.index].name : 'silencio';
  }

  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state !== 'running') {
      const resume = () => {
        if (document.hidden) return;
        ctx.resume();
        if (ctx.state === 'running') ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.removeEventListener(ev, resume));
      };
      ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, resume));
    }
    // con la pestaña oculta no suena
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
    this.play(this.index, 2.5);
    // precargar el resto sin apuro
    setTimeout(() => TRACKS.forEach((_, i) => this.load(i)), 4000);
  }

  /** Pasa al siguiente tema (o al silencio) y devuelve su nombre. */
  next(): string {
    this.index = (this.index + 1) % (TRACKS.length + 1);
    try { localStorage.setItem(KEY, String(this.index)); } catch { /* sin almacenamiento */ }
    this.play(this.index, FADE);
    return this.label;
  }

  private play(i: number, fadeIn: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const token = ++this.token;
    // apagar el que está sonando
    if (this.playing) {
      const { src, gain } = this.playing;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + FADE);
      src.stop(t + FADE + 0.05);
      this.playing = null;
    }
    if (i >= TRACKS.length) return;
    this.load(i).then((loop) => {
      if (!loop || token !== this.token) return;
      const src = ctx.createBufferSource();
      src.buffer = loop.buffer;
      src.loop = true;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(loop.gain, t + fadeIn);
      src.connect(gain).connect(this.master);
      src.start(t);
      this.playing = { src, gain };
    });
  }

  private load(i: number): Promise<{ buffer: AudioBuffer; gain: number } | null> {
    let p = this.loops.get(i);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(import.meta.env.BASE_URL + TRACKS[i].file)
        .then((r) => {
          if (!r.ok) throw new Error(r.statusText);
          return r.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .then((raw) => makeLoop(ctx, raw))
        .catch((e) => {
          console.warn('No se pudo cargar la música', TRACKS[i].file, e);
          this.loops.delete(i);
          return null;
        });
      this.loops.set(i, p);
    }
    return p;
  }
}

/** Recorta los silencios y funde la cola con el principio: al repetirse no hay salto. */
function makeLoop(ctx: AudioContext, raw: AudioBuffer): { buffer: AudioBuffer; gain: number } {
  const sr = raw.sampleRate, nch = raw.numberOfChannels, n = raw.length;
  const chans = Array.from({ length: nch }, (_, c) => raw.getChannelData(c));
  const loud = (i: number) => chans.some((a) => Math.abs(a[i]) > 0.002);
  let s = 0, e = n;
  while (s < n - 1 && !loud(s)) s++;
  while (e > s + 1 && !loud(e - 1)) e--;
  const x = Math.min(Math.floor(sr * SEAM), Math.floor((e - s) / 4));
  const len = e - s - x;
  const out = ctx.createBuffer(nch, len, sr);
  let sum = 0;
  for (let c = 0; c < nch; c++) {
    const a = chans[c], o = out.getChannelData(c);
    for (let i = 0; i < len; i++) o[i] = a[s + x + i];
    // cola (a[e-x..e]) que se apaga + principio (a[s..s+x]) que entra, con potencia constante
    for (let j = 0; j < x; j++) {
      const t = (j / x) * Math.PI * 0.5;
      o[len - x + j] = a[e - x + j] * Math.cos(t) + a[s + j] * Math.sin(t);
    }
    for (let i = 0; i < len; i++) sum += o[i] * o[i];
  }
  const rms = Math.sqrt(sum / (len * nch)) || 1;
  return { buffer: out, gain: Math.min(1.2, TARGET_RMS / rms) };
}
