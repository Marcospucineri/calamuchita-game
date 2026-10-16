import { bindAudioFocus } from './AudioFocus';

/**
 * Música de fondo: dos canciones en loop y silencio, se ciclan con N (o el botón "Música").
 * Cada tema se decodifica con WebAudio, se le recortan los silencios de los bordes y se
 * funde el final con el principio para que el loop no tenga corte. El volumen se iguala
 * entre temas para que todos suenen bajito, de fondo.
 */
const TRACKS = [
  { file: 'music/Vallecito.mp3', name: 'Vallecito' },
  { file: 'music/Camino de Verano.mp3', name: 'Camino de Verano' },
];
export const MUSIC_KEY = 'calamuchita.music.v2';
const KEY = MUSIC_KEY;
/** Nombres para el menú de opciones (el último es el silencio). */
export const MUSIC_OPTIONS = [...TRACKS.map((t) => t.name), 'Sin música'];
/** Música suave de fondo, unos 9 dB por debajo del nivel anterior. */
const TARGET_RMS = 0.025;

export function readMusicIndex(): number {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) {
      const index = Number(stored);
      return Number.isInteger(index) && index >= 0 && index <= TRACKS.length ? index : 0;
    }
    // La lista anterior tenía tres temas: su índice 3 era «Sin música».
    const index = localStorage.getItem('calamuchita.music') === '3' ? TRACKS.length : 0;
    localStorage.setItem(KEY, String(index));
    return index;
  } catch { return 0; }
}
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
    this.index = readMusicIndex();
  }

  get label(): string {
    return this.index < TRACKS.length ? TRACKS[this.index].name : 'silencio';
  }

  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    bindAudioFocus(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
    this.play(this.index, 2.5);
    // precargar el resto sin apuro
    setTimeout(() => TRACKS.forEach((_, i) => this.load(i)), 4000);
  }

  /** Pasa al siguiente tema (o al silencio) y devuelve su nombre. */
  next(): string {
    return this.set((this.index + 1) % (TRACKS.length + 1));
  }

  /** Elige un tema por número (TRACKS.length = silencio) y devuelve su nombre. */
  set(i: number): string {
    if (i === this.index && this.playing) return this.label;
    this.index = Math.max(0, Math.min(TRACKS.length, i));
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
      p = fetch(import.meta.env.BASE_URL + TRACKS[i].file.split('/').map(encodeURIComponent).join('/'))
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
