import { getAirfield } from '../world/Airfield';
import { WorldData } from '../world/WorldData';
import { MapRenderer } from './Minimap';

const MPP = 6; // igual que MapRenderer: metros por píxel de la imagen base
const MAX_SCALE = 4; // píxeles de pantalla por píxel de la imagen base (≈1,5 m por píxel)

/** fromZoom: a partir de cuánto zoom (respecto del mapa entero) se dibuja la capa en vectores. */
interface Layer { path: Path2D; color: string; meters: number; minPx: number; fromZoom: number; edge: boolean }

/**
 * Mapa grande con cámara propia: se arrastra para mover, se acerca con la rueda, el pellizco del
 * trackpad, dos dedos o los botones. Las calles, ríos y textos se dibujan en vectores encima del
 * relieve, así se leen nítidos con cualquier zoom. Tocar (sin arrastrar) elige un punto.
 */
export class BigMapView {
  /** Se llama al tocar un punto (sin arrastrar). */
  onPick: ((x: number, n: number) => void) | null = null;
  pin: { x: number; n: number } | null = null;
  private s = 1;
  private cx = 0;
  private cy = 0;
  private vw = 1;
  private vh = 1;
  private dpr = 1;
  private fitted = false;
  private open = false;
  private player = { x: 0, n: 0 };
  private discovered = new Set<string>();
  private layers: Layer[] = [];
  private ptrs = new Map<number, { x: number; y: number }>();
  private tap: { x: number; y: number; t: number; ok: boolean } | null = null;
  private pinch: { d: number; s: number; bx: number; by: number } | null = null;
  private raf = 0;

  constructor(private w: WorldData, private map: MapRenderer, private canvas: HTMLCanvasElement) {
    this.buildLayers();
    const c = canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e, true));
    c.addEventListener('pointercancel', (e) => this.up(e, false));
    c.addEventListener('lostpointercapture', (e) => { if (this.ptrs.has(e.pointerId)) this.up(e, false); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      // ctrlKey = pellizco del trackpad: deltas chicos
      const [sx, sy] = this.local(e.clientX, e.clientY);
      this.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016)), sx, sy);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => { e.preventDefault(); const [sx, sy] = this.local(e.clientX, e.clientY); this.zoomAt(2, sx, sy); });
    new ResizeObserver(() => { if (this.open) this.resize(); }).observe(c.parentElement ?? c);
  }

  show(x: number, n: number, discovered: Set<string>): void {
    this.open = true;
    this.player = { x, n };
    this.discovered = discovered;
    this.pin = null;
    this.resize();
    if (!this.fitted) { this.fit(); this.fitted = true; }
    this.request();
  }

  hide(): void {
    this.open = false;
    this.ptrs.clear();
    this.pinch = null;
    this.tap = null;
  }

  /** Acerca (f > 1) o aleja alrededor del centro de la vista. */
  zoom(f: number): void { this.zoomAt(f, this.vw / 2, this.vh / 2); }

  centerOnPlayer(): void {
    const [bx, by] = this.map.toPx(this.player.x, this.player.n);
    this.s = Math.max(this.s, Math.min(MAX_SCALE, this.fitScale() * 4));
    this.cx = bx; this.cy = by;
    this.clamp(); this.request();
  }

  clearPin(): void { this.pin = null; this.request(); }

  // ---------------------------------------------------------------- vista

  private fitScale(): number {
    const img = this.map.canvas;
    return Math.min(this.vw / img.width, this.vh / img.height);
  }

  private fit(): void {
    const img = this.map.canvas;
    this.s = this.fitScale();
    this.cx = img.width / 2; this.cy = img.height / 2;
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = r.width; this.vh = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.fitted) this.fit();
    this.clamp();
    this.draw();
  }

  private clamp(): void {
    const img = this.map.canvas;
    const min = this.fitScale();
    this.s = Math.min(Math.max(this.s, min), Math.max(MAX_SCALE, min));
    const hw = this.vw / 2 / this.s, hh = this.vh / 2 / this.s;
    this.cx = img.width <= 2 * hw ? img.width / 2 : Math.min(Math.max(this.cx, hw), img.width - hw);
    this.cy = img.height <= 2 * hh ? img.height / 2 : Math.min(Math.max(this.cy, hh), img.height - hh);
  }

  private zoomAt(f: number, sx: number, sy: number): void {
    const bx = this.cx + (sx - this.vw / 2) / this.s, by = this.cy + (sy - this.vh / 2) / this.s;
    this.s *= f;
    this.clamp();
    this.cx = bx - (sx - this.vw / 2) / this.s;
    this.cy = by - (sy - this.vh / 2) / this.s;
    this.clamp();
    this.request();
  }

  private local(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  }

  // ---------------------------------------------------------------- gestos

  private down(e: PointerEvent): void {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.local(e.clientX, e.clientY);
    this.ptrs.set(e.pointerId, { x, y });
    if (this.ptrs.size === 1) this.tap = { x, y, t: performance.now(), ok: true };
    else {
      if (this.tap) this.tap.ok = false;
      this.startPinch();
    }
    this.canvas.classList.add('dragging');
  }

  private startPinch(): void {
    const [a, b] = [...this.ptrs.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.pinch = {
      d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s: this.s,
      bx: this.cx + (mx - this.vw / 2) / this.s, by: this.cy + (my - this.vh / 2) / this.s,
    };
  }

  private move(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.local(e.clientX, e.clientY);
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (this.tap && Math.hypot(x - this.tap.x, y - this.tap.y) > 7) this.tap.ok = false;
    if (this.ptrs.size >= 2 && this.pinch) {
      const [a, b] = [...this.ptrs.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.s = this.pinch.s * Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)) / this.pinch.d;
      this.clamp();
      this.cx = this.pinch.bx - (mx - this.vw / 2) / this.s;
      this.cy = this.pinch.by - (my - this.vh / 2) / this.s;
    } else {
      this.cx -= dx / this.s;
      this.cy -= dy / this.s;
    }
    this.clamp();
    this.request();
  }

  private up(e: PointerEvent, real: boolean): void {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size === 1) this.pinch = null; // sigue arrastrando con el dedo que queda
    if (this.ptrs.size === 0) {
      this.canvas.classList.remove('dragging');
      const t = this.tap;
      this.tap = null;
      this.pinch = null;
      if (real && t?.ok && performance.now() - t.t < 650) {
        const [x, y] = this.local(e.clientX, e.clientY);
        const [wx, wn] = this.map.toWorld(this.cx + (x - this.vw / 2) / this.s, this.cy + (y - this.vh / 2) / this.s);
        this.onPick?.(wx, wn);
      }
    }
  }

  // ---------------------------------------------------------------- dibujo

  private buildLayers(): void {
    const mk = (color: string, meters: number, minPx: number, fromZoom: number, edge: boolean): Layer => ({ path: new Path2D(), color, meters, minPx, fromZoom, edge });
    const streams = mk('rgba(79,143,176,0.75)', 4, 0.9, 1.5, false);
    const rivers = mk('#4f8fb0', 14, 2.2, 0, false);
    const dirt = mk('#e7d3aa', 6.5, 0.9, 1.6, true);
    const paved = mk('#fbf6ea', 8, 1.1, 0, true);
    const majorOther = mk('#f4e3b0', 10, 1.9, 0, true);
    const major = mk('#f2c14e', 11, 2.4, 0, true);
    const line = (path: Path2D, p: number[]) => {
      for (let k = 0; k < p.length; k += 3) {
        const [px, py] = this.map.toPx(p[k], p[k + 1]);
        if (k) path.lineTo(px, py); else path.moveTo(px, py);
      }
    };
    for (const r of this.w.rivers) line(r.kind === 'river' ? rivers.path : streams.path, r.p);
    for (const r of this.w.roads) {
      const paved_ = r.surface === 'asphalt' || r.surface === 'paving';
      line((r.major ? (paved_ ? major : majorOther) : paved_ ? paved : dirt).path, r.p);
    }
    this.layers = [streams, rivers, dirt, paved, majorOther, major];
  }

  private request(): void {
    if (this.raf || !this.open) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  private draw(): void {
    if (!this.open) return;
    const g = this.canvas.getContext('2d')!;
    const { dpr, s, vw, vh } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#ece2cc';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // relieve (imagen base) y vectores en coordenadas de la imagen
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (vw / 2 - this.cx * s), dpr * (vh / 2 - this.cy * s));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.map.canvas, 0, 0);
    // los vectores no salen del borde del relieve
    g.save();
    g.beginPath();
    g.rect(0, 0, this.map.canvas.width, this.map.canvas.height);
    g.clip();
    g.lineCap = g.lineJoin = 'round';
    const width = (L: Layer) => Math.max(L.minPx, (L.meters / MPP) * s);
    const zoomed = s / this.fitScale();
    const visible = this.layers.filter((L) => zoomed >= L.fromZoom);
    for (const L of visible) {
      if (!L.edge) continue;
      g.strokeStyle = 'rgba(90,60,40,0.5)';
      g.lineWidth = (width(L) + 1.6) / s;
      g.stroke(L.path);
    }
    for (const L of visible) {
      g.strokeStyle = L.color;
      g.lineWidth = width(L) / s;
      g.stroke(L.path);
    }

    g.restore();

    // marcas y textos en coordenadas de pantalla (tamaño fijo)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = (x: number, n: number): [number, number] => {
      const [bx, by] = this.map.toPx(x, n);
      return [vw / 2 + (bx - this.cx) * s, vh / 2 + (by - this.cy) * s];
    };
    const label = (text: string, x: number, y: number, font: string, fill: string, stroke = 'rgba(255,248,230,0.92)', lw = 4) => {
      g.font = font;
      g.lineWidth = lw;
      g.strokeStyle = stroke;
      g.strokeText(text, x, y);
      g.fillStyle = fill;
      g.fillText(text, x, y);
    };
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (const t of this.w.meta.towns) {
      const [x, y] = S(t.x, t.n);
      label(t.name, x, y - (zoomed > 3 ? 0 : 18), `800 ${zoomed > 3 ? 17 : 20}px Bitter, Georgia, serif`, zoomed > 3 ? 'rgba(90,44,24,0.55)' : '#5a2c18', 'rgba(255,248,230,0.85)', 5);
    }
    for (const p of this.w.pois) {
      const [x, y] = S(p.x, p.n);
      if (x < -40 || y < -40 || x > vw + 40 || y > vh + 40) continue;
      const got = this.discovered.has(p.id);
      g.fillStyle = got ? '#3d7a46' : '#c8452c';
      g.strokeStyle = '#fff6e0';
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
      if (got) label(p.name, x, y - 9, '700 12px Nunito, sans-serif', '#2d2016', 'rgba(255,248,230,0.92)', 3.5);
    }
    const af = getAirfield(this.w);
    {
      const [x, y] = S(af.x, af.n);
      g.fillStyle = '#355a2a'; g.strokeStyle = '#fff6e0'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
      label('Aeroclub de VGB', x, y - 11, '800 12px Nunito, sans-serif', '#2d2016', 'rgba(255,248,230,0.92)', 3.5);
    }
    // vos
    {
      const [x, y] = S(this.player.x, this.player.n);
      g.fillStyle = 'rgba(45,32,22,0.18)';
      g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2d2016'; g.strokeStyle = '#fff6e0'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); g.stroke();
      label('Vos', x, y - 14, '800 12px Nunito, sans-serif', '#2d2016', 'rgba(255,248,230,0.92)', 3.5);
    }
    // destino elegido
    if (this.pin) {
      const [x, y] = S(this.pin.x, this.pin.n);
      g.fillStyle = 'rgba(200,69,44,0.22)';
      g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c8452c'; g.strokeStyle = '#fff6e0'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // escala gráfica
    {
      const metersPerPx = MPP / s;
      const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((m) => m / metersPerPx >= 60) ?? 5000;
      const len = nice / metersPerPx;
      const x0 = 12, y0 = vh - 14;
      g.strokeStyle = 'rgba(255,248,230,0.9)'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + len, y0); g.stroke();
      g.strokeStyle = '#2d2016'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0, y0 - 4); g.lineTo(x0, y0); g.lineTo(x0 + len, y0); g.lineTo(x0 + len, y0 - 4); g.stroke();
      g.textAlign = 'left';
      label(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x0, y0 - 7, '700 11px Nunito, sans-serif', '#2d2016', 'rgba(255,248,230,0.92)', 3);
    }
  }
}
