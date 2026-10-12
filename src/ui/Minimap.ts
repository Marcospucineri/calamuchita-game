import { WorldData } from '../world/WorldData';
import { getAirfield } from '../world/Airfield';

const MPP = 6; // metros por píxel del mapa pre-renderizado

/** Mapa pintado a partir de los mismos datos del mundo (rutas, ríos, pueblos). */
export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly x0: number;
  readonly n1: number;

  constructor(w: WorldData) {
    const pa = w.meta.playArea;
    const pad = 400;
    this.x0 = pa.x0 - pad;
    const x1 = pa.x1 + pad;
    const n0 = pa.n0 - pad;
    this.n1 = pa.n1 + pad;
    const W = Math.ceil((x1 - this.x0) / MPP), H = Math.ceil((this.n1 - n0) / MPP);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    const g = this.canvas.getContext('2d')!;

    // fondo: relieve sombreado + suelo
    const img = g.createImageData(W, H);
    const t = w.meta.terrain;
    for (let py = 0; py < H; py++)
      for (let px = 0; px < W; px++) {
        const x = this.x0 + px * MPP, n = this.n1 - py * MPP;
        const hgt = w.heightAt(x, n);
        const hx = (w.heightAt(x + MPP, n) - hgt) * 2;
        const hn = (w.heightAt(x, n + MPP) - hgt) * 2;
        const shade = Math.max(0.55, Math.min(1.25, 1 + (-hx * 0.7 + hn * 0.7) / 24));
        const gr = w.groundAt(x, n);
        let r = 196, gg = 196, b = 150;
        if (gr === 2) { r = 150; gg = 170; b = 110; }
        else if (gr === 1) { r = 214; gg = 200; b = 150; }
        else if (gr === 3 || gr === 6) { r = 222; gg = 208; b = 170; }
        const e = (hgt - 650) / 600;
        r = (r - e * 20) * shade; gg = (gg - e * 10) * shade; b = (b + e * 10) * shade;
        const inPlay = x >= w.meta.playArea.x0 && x <= w.meta.playArea.x1 && n >= w.meta.playArea.n0 && n <= w.meta.playArea.n1;
        const k = (py * W + px) * 4;
        const fade = inPlay ? 1 : 0.78;
        img.data[k] = r * fade + 255 * (1 - fade) * 0.9;
        img.data[k + 1] = gg * fade + 245 * (1 - fade) * 0.9;
        img.data[k + 2] = b * fade + 225 * (1 - fade) * 0.9;
        img.data[k + 3] = 255;
      }
    void t;
    g.putImageData(img, 0, 0);

    const P = (x: number, n: number): [number, number] => [(x - this.x0) / MPP, (this.n1 - n) / MPP];
    // pueblos
    for (const town of w.meta.towns) {
      const [cx, cy] = P(town.x, town.n);
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, town.r / MPP);
      grd.addColorStop(0, 'rgba(214,150,110,0.32)');
      grd.addColorStop(1, 'rgba(214,150,110,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(cx, cy, town.r / MPP, 0, Math.PI * 2); g.fill();
    }
    // ríos
    g.lineCap = g.lineJoin = 'round';
    for (const r of w.rivers) {
      g.strokeStyle = r.kind === 'river' ? '#4f8fb0' : 'rgba(79,143,176,0.7)';
      g.lineWidth = r.kind === 'river' ? 3 : 1.2;
      g.beginPath();
      for (let k = 0; k < r.p.length; k += 3) { const [px, py] = P(r.p[k], r.p[k + 1]); k ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    }
    // calles: primero bordes, luego relleno, de menor a mayor jerarquía
    const sorted = [...w.roads].sort((a, b) => a.width - b.width);
    for (const pass of [0, 1])
      for (const r of sorted) {
        const wpx = Math.max(1.4, r.width / MPP * (r.major ? 1.6 : 1.1));
        g.lineWidth = pass === 0 ? wpx + 2 : wpx;
        g.strokeStyle = pass === 0 ? 'rgba(90,60,40,0.55)' : r.major ? (r.surface === 'asphalt' ? '#f2c14e' : '#f4e3b0') : r.surface === 'asphalt' || r.surface === 'paving' ? '#fbf6ea' : '#e7d3aa';
        g.beginPath();
        for (let k = 0; k < r.p.length; k += 3) { const [px, py] = P(r.p[k], r.p[k + 1]); k ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.stroke();
      }
    const airfield = getAirfield(w);
    const dx = Math.cos(airfield.heading) * airfield.length / 2;
    const dn = Math.sin(airfield.heading) * airfield.length / 2;
    const [ax, ay] = P(airfield.x - dx, airfield.n - dn);
    const [bx, by] = P(airfield.x + dx, airfield.n + dn);
    g.strokeStyle = '#486c75';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    g.strokeStyle = '#f4efe0';
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.stroke();
    g.setLineDash([]);
  }

  toWorld(px: number, py: number): [number, number] {
    return [this.x0 + px * MPP, this.n1 - py * MPP];
  }

  toPx(x: number, n: number): [number, number] {
    return [(x - this.x0) / MPP, (this.n1 - n) / MPP];
  }
}

/** Minimapa circular que gira con el rumbo. */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;

  constructor(private map: MapRenderer, private w: WorldData) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el.width = this.el.height = 190 * dpr;
    this.g = this.el.getContext('2d')!;
    this.g.scale(dpr, dpr);
  }

  draw(x: number, n: number, heading: number, carX: number | null, carN: number | null, discovered: Set<string>, zoom: number): void {
    const g = this.g, S = 190, R = S / 2;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(R, R, R - 3, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#e9dfc4'; g.fillRect(0, 0, S, S);
    const [px, py] = this.map.toPx(x, n);
    g.translate(R, R);
    g.rotate(heading - Math.PI / 2);
    g.scale(zoom, zoom);
    g.drawImage(this.map.canvas, -px, -py);
    // postales pendientes
    for (const p of this.w.pois) {
      if (discovered.has(p.id)) continue;
      const [qx, qy] = this.map.toPx(p.x, p.n);
      g.fillStyle = '#c8452c';
      g.strokeStyle = '#fff6e0';
      g.lineWidth = 1.5 / zoom;
      g.beginPath(); g.arc(qx - px, qy - py, 4 / zoom, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (carX !== null && carN !== null) {
      const [cx, cy] = this.map.toPx(carX, carN);
      g.fillStyle = '#3b6fa8';
      g.fillRect(cx - px - 4 / zoom, cy - py - 3 / zoom, 8 / zoom, 6 / zoom);
    }
    g.restore();
    // jugador (siempre hacia arriba)
    g.save();
    g.translate(R, R);
    g.fillStyle = '#2d2016';
    g.strokeStyle = '#fff6e0';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // norte
    g.save();
    g.translate(R, R);
    g.rotate(heading - Math.PI / 2);
    g.fillStyle = '#7a2f1c';
    g.font = '800 13px Nunito, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', 0, -(R - 14));
    g.restore();
  }
}
