// Genera docs/preview-mundo.png: vista superior del mundo procesado para comparar con el mapa real.
import fs from 'node:fs';
import { PNG } from 'pngjs';

const W0 = JSON.parse(fs.readFileSync('public/world/meta.json', 'utf8'));
const t = W0.terrain;
const raw = fs.readFileSync('public/world/terrain.bin');
const H = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const G = fs.readFileSync('public/world/ground.bin');
const roads = JSON.parse(fs.readFileSync('public/world/roads.json', 'utf8'));
const water = JSON.parse(fs.readFileSync('public/world/water.json', 'utf8'));
const bld = JSON.parse(fs.readFileSync('public/world/buildings.json', 'utf8'));
const tr = fs.readFileSync('public/world/trees.bin');
const trees = new Float32Array(tr.buffer, tr.byteOffset, tr.length / 4);
const pois = JSON.parse(fs.readFileSync('public/world/pois.json', 'utf8'));

const S = 2; // px por celda de 10 m → 5 m/px
const PW = (t.W - 1) * S, PH = (t.H - 1) * S;
const png = new PNG({ width: PW, height: PH });
const set = (x, y, r, g, b, a = 1) => {
  if (x < 0 || y < 0 || x >= PW || y >= PH) return;
  const k = (y * PW + x) * 4;
  png.data[k] = png.data[k] * (1 - a) + r * a; png.data[k + 1] = png.data[k + 1] * (1 - a) + g * a; png.data[k + 2] = png.data[k + 2] * (1 - a) + b * a; png.data[k + 3] = 255;
};
const GC = [[125, 143, 58], [167, 154, 85], [85, 101, 46], [143, 138, 98], [168, 131, 88], [201, 181, 138], [111, 143, 53]];
for (let py = 0; py < PH; py++) for (let px = 0; px < PW; px++) {
  const i = Math.floor(px / S), j = t.H - 2 - Math.floor(py / S);
  const id = j * t.W + i;
  const h = H[id] / t.scale;
  const dx = (H[id + 1] - H[Math.max(0, id - 1)]) / t.scale, dn = (H[Math.min(H.length - 1, id + t.W)] - H[Math.max(0, id - t.W)]) / t.scale;
  const sh = Math.max(0.5, Math.min(1.3, 1 + (-dx + dn) * 0.06));
  const c = GC[G[id]] || GC[0];
  const e = (h - 700) / 500;
  set(px, py, c[0] * sh + e * 30, c[1] * sh + e * 20, c[2] * sh + e * 20);
}
const P = (x, n) => [Math.round(((x - t.x0) / t.step) * S), Math.round(((t.n1 - n) / t.step) * S)];
const line = (p, w, col) => {
  for (let k = 3; k < p.length; k += 3) {
    const [ax, ay] = P(p[k - 3], p[k - 2]), [bx, by] = P(p[k], p[k + 1]);
    const L = Math.max(1, Math.hypot(bx - ax, by - ay));
    for (let s = 0; s <= L; s++) {
      const x = ax + ((bx - ax) * s) / L, y = ay + ((by - ay) * s) / L;
      for (let ox = -w; ox <= w; ox++) for (let oy = -w; oy <= w; oy++) set(Math.round(x + ox), Math.round(y + oy), ...col);
    }
  }
};
for (let i = 0; i < trees.length; i += 4) { const [x, y] = P(trees[i], trees[i + 1]); set(x, y, 40, 70, 30, 0.6); }
for (const r of water.rivers) line(r.p, r.kind === 'river' ? 2 : 1, [70, 130, 170]);
for (const r of [...roads].sort((a, b) => a.width - b.width)) {
  const col = r.bridge ? [200, 60, 60] : r.surface === 'asphalt' ? (r.major ? [235, 190, 70] : [250, 245, 230]) : r.surface === 'paving' ? [210, 200, 190] : [225, 205, 160];
  line(r.p, r.major ? 2 : 1, col);
}
for (const b of bld) {
  const [x, y] = P(b.x, b.n);
  const c = b.s === 'alpino' ? [160, 70, 40] : b.s === 'criollo' ? [240, 235, 220] : b.s === 'serrano' ? [100, 70, 50] : [120, 120, 120];
  for (let ox = -2; ox <= 2; ox++) for (let oy = -2; oy <= 2; oy++) set(x + ox, y + oy, ...c);
}
for (const p of pois) { const [x, y] = P(p.x, p.n); for (let ox = -5; ox <= 5; ox++) for (let oy = -5; oy <= 5; oy++) if (ox * ox + oy * oy < 26) set(x + ox, y + oy, 200, 40, 40); }
if (W0.portal) { const [x, y] = P(W0.portal.x, W0.portal.n); for (let o = -9; o <= 9; o++) { set(x + o, y, 0, 0, 0); set(x, y + o, 0, 0, 0); } }
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/preview-mundo.png', PNG.sync.write(png));
console.log('docs/preview-mundo.png', PW, 'x', PH);
