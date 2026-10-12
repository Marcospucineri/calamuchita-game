// Construye el mundo del juego a partir de datos reales:
//   tools/raw/calamuchita-osm.json  (OpenStreetMap, ya proyectado a metros locales)
//   tools/raw/calamuchita-dem.json  (elevación, grillas de detalle y de fondo)
// Salida: public/world/*
//
// Convención de coordenadas del pipeline: x = Este (m), n = Norte (m), origen = centro de Villa General Belgrano.
// En el juego (Three.js): X = x, Z = -n, Y = altura.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'tools/raw');
const OUT = path.join(ROOT, 'public/world');
fs.mkdirSync(OUT, { recursive: true });

const osm = JSON.parse(fs.readFileSync(path.join(RAW, 'calamuchita-osm.json'), 'utf8'));
const dem = JSON.parse(fs.readFileSync(path.join(RAW, 'calamuchita-dem.json'), 'utf8'));
const overrides = fs.existsSync(path.join(ROOT, 'tools/overrides/world.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/overrides/world.json'), 'utf8'))
  : {};

// ---------------------------------------------------------------- utilidades
let seed = 1337;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function decodeGrid(g) {
  const buf = Buffer.from(g.data, 'base64');
  const u = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const f = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) f[i] = u[i] / 10;
  return { ...g, h: f };
}

const D = decodeGrid(dem.detail); // 10 m
const F = decodeGrid(dem.far); // 200 m
const W = D.W, H = D.H, STEP = D.step;
console.log(`Detalle ${W}x${H} @${STEP}m  rango ${D.min.toFixed(0)}–${D.max.toFixed(0)} m`);

const idx = (i, j) => j * W + i;
const toI = (x) => (x - D.x0) / STEP;
const toJ = (n) => (n - D.n0) / STEP;

function sampleH(h, x, n) {
  const fi = clamp(toI(x), 0, W - 1.001), fj = clamp(toJ(n), 0, H - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  return lerp(lerp(h[idx(i, j)], h[idx(i + 1, j)], u), lerp(h[idx(i, j + 1)], h[idx(i + 1, j + 1)], u), v);
}

function ptsOf(w) {
  const p = [];
  for (let k = 0; k < w.g.length; k += 2) p.push([w.g[k], w.g[k + 1]]);
  return p;
}

function resample(pts, spacing) {
  const out = [pts[0]];
  let carry = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, an] = pts[k - 1], [bx, bn] = pts[k];
    const L = Math.hypot(bx - ax, bn - an);
    let d = spacing - carry;
    while (d < L) {
      const t = d / L;
      out.push([lerp(ax, bx, t), lerp(an, bn, t)]);
      d += spacing;
    }
    carry = L - (d - spacing);
    if (k === pts.length - 1) {
      const last = out[out.length - 1];
      if (Math.hypot(last[0] - bx, last[1] - bn) > spacing * 0.3) out.push([bx, bn]);
      else out[out.length - 1] = [bx, bn];
    }
  }
  return out;
}

function polyArea(p) { let a = 0; for (let k = 0; k < p.length; k++) { const [x1, y1] = p[k], [x2, y2] = p[(k + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; }
function pointInPoly(x, n, p) {
  let inside = false;
  for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
    const [xa, na] = p[a], [xb, nb] = p[b];
    if ((na > n) !== (nb > n) && x < ((xb - xa) * (n - na)) / (nb - na) + xa) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- localidades
const TOWNS = [
  { id: 'vgb', name: 'Villa General Belgrano', style: 'alpino', x: 0, n: 0, r: 1700 },
  { id: 'lr', name: 'Los Reartes', style: 'criollo', x: -1900, n: 6800, r: 1700 },
  { id: 'vcp', name: 'Villa Ciudad Parque', style: 'serrano', x: 1500, n: 7600, r: 2300 },
];
function townAt(x, n) {
  let best = null, bd = Infinity;
  for (const t of TOWNS) { const d = Math.hypot(x - t.x, n - t.n) / t.r; if (d < 1 && d < bd) { bd = d; best = t; } }
  return best;
}

// ---------------------------------------------------------------- rutas
const ROAD_W = {
  motorway: 10, trunk: 9, primary: 8.5, secondary: 7.5, tertiary: 7, unclassified: 5.5, residential: 5.5,
  living_street: 5, service: 4, track: 3.6, primary_link: 6, secondary_link: 6, tertiary_link: 5.5,
};
const PATHS = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway']);

function surfaceOf(t) {
  const s = (t.surface || '').toLowerCase();
  if (/asphalt|paved|concrete/.test(s)) return 'asphalt';
  if (/paving_stones|sett|cobblestone|unhewn/.test(s)) return 'paving';
  if (/compacted|fine_gravel/.test(s)) return 'compacted';
  if (/gravel|pebblestone|rock/.test(s)) return 'gravel';
  if (/unpaved|dirt|earth|ground|mud|sand|grass/.test(s)) return 'dirt';
  // sin dato: deducir por jerarquía (en la zona casi todo lo menor es ripio/tierra)
  if (['motorway', 'trunk', 'primary', 'secondary', 'primary_link', 'secondary_link'].includes(t.highway)) return 'asphalt';
  if (t.highway === 'tertiary') return t.ref ? 'asphalt' : 'gravel';
  if (t.highway === 'track') return 'dirt';
  return 'gravel';
}

const roads = [];
const paths = [];
for (const w of osm.ways) {
  const t = w.t;
  if (!t.highway || w.g.length < 4) continue;
  if (t.tunnel === 'yes') continue;
  if (PATHS.has(t.highway)) { paths.push({ id: w.id, t, pts: ptsOf(w) }); continue; }
  let width = ROAD_W[t.highway];
  if (!width) continue;
  const surface = surfaceOf(t);
  // calles comunes asfaltadas/adoquinadas: más anchas (doble mano urbana)
  if ((surface === 'asphalt' || surface === 'paving') && ['residential', 'unclassified', 'living_street'].includes(t.highway)) width = t.highway === 'living_street' ? 6.5 : 7.5;
  roads.push({
    rb: t.junction === 'roundabout' || t.junction === 'circular',
    link: /_link$/.test(t.highway),
    id: w.id,
    name: t.name || '',
    ref: t.ref || '',
    kind: t.highway,
    surface,
    bridge: t.bridge === 'yes' || t.bridge === 'viaduct',
    width: t.width ? clamp(parseFloat(t.width) || width, 3, 14) : width,
    major: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link'].includes(t.highway),
    pts: ptsOf(w),
  });
}
console.log(`Rutas/calles: ${roads.length}  senderos: ${paths.length}`);

// ---------------------------------------------------------------- agua
const rivers = [];
for (const w of osm.ways) {
  const t = w.t;
  if (!t.waterway || w.g.length < 4) continue;
  if (!['river', 'stream', 'canal', 'ditch', 'drain'].includes(t.waterway)) continue;
  const isRiver = t.waterway === 'river';
  rivers.push({
    id: w.id, name: t.name || '', kind: t.waterway,
    width: isRiver ? 14 : t.waterway === 'stream' ? 3.5 : 2,
    depth: isRiver ? 2.2 : 1.0,
    intermittent: t.intermittent === 'yes',
    pts: ptsOf(w),
  });
}
const waterAreas = osm.ways.filter((w) => w.t.natural === 'water' && w.g.length >= 6).map((w) => ({ id: w.id, name: w.t.name || '', pts: ptsOf(w) }));
console.log(`Cursos de agua: ${rivers.length}  espejos de agua: ${waterAreas.length}`);

// ---------------------------------------------------------------- terreno de trabajo
const h0 = Float32Array.from(D.h); // original
const h = Float32Array.from(D.h);  // tallado

// grilla de influencias (para combinar tallados sin pisarse)
const inflW = new Float32Array(W * H); // peso
const inflT = new Float32Array(W * H); // altura objetivo
const inflD = new Float32Array(W * H).fill(1e9); // distancia de la influencia ganadora

function segDist(px, pn, ax, an, bx, bn) {
  const dx = bx - ax, dn = bn - an;
  const L2 = dx * dx + dn * dn || 1e-9;
  const t = clamp(((px - ax) * dx + (pn - an) * dn) / L2, 0, 1);
  return [Math.hypot(px - (ax + t * dx), pn - (an + t * dn)), t];
}

// Aplica una influencia a lo largo de una polilínea con alturas por vértice.
function stampLine(pts, hs, halfFlat, falloff, mode) {
  for (let k = 1; k < pts.length; k++) {
    const [ax, an] = pts[k - 1], [bx, bn] = pts[k];
    const R = halfFlat + falloff;
    const i0 = Math.max(0, Math.floor(toI(Math.min(ax, bx) - R))), i1 = Math.min(W - 1, Math.ceil(toI(Math.max(ax, bx) + R)));
    const j0 = Math.max(0, Math.floor(toJ(Math.min(an, bn) - R))), j1 = Math.min(H - 1, Math.ceil(toJ(Math.max(an, bn) + R)));
    for (let j = j0; j <= j1; j++) {
      const n = D.n0 + j * STEP;
      for (let i = i0; i <= i1; i++) {
        const x = D.x0 + i * STEP;
        const [d, t] = segDist(x, n, ax, an, bx, bn);
        if (d > R) continue;
        const target = lerp(hs[k - 1], hs[k], t);
        const w = d <= halfFlat ? 1 : 1 - smooth((d - halfFlat) / falloff);
        const id = idx(i, j);
        if (mode === 'river') {
          // los ríos solo bajan el terreno
          const cand = lerp(h[id], Math.min(h[id], target), w);
          if (cand < h[id]) h[id] = cand;
        } else if (d < inflD[id]) {
          inflD[id] = d; inflW[id] = w; inflT[id] = target;
        }
      }
    }
  }
}

function smoothProfile(hs, radius, passes = 2) {
  let a = hs.slice();
  for (let p = 0; p < passes; p++) {
    const b = a.slice();
    for (let k = 0; k < a.length; k++) {
      let s = 0, c = 0;
      for (let q = -radius; q <= radius; q++) { const kk = k + q; if (kk >= 0 && kk < a.length) { s += a[kk]; c++; } }
      b[k] = s / c;
    }
    b[0] = a[0]; b[b.length - 1] = a[a.length - 1];
    a = b;
  }
  return a;
}

// 1) ríos: cauce con perfil monótono aguas abajo (OSM dibuja en el sentido del flujo)
for (const r of rivers) {
  const pts = resample(r.pts, 5);
  let hs = pts.map(([x, n]) => sampleH(h0, x, n));
  // perfil: mínimo corrido para que no "suba" aguas abajo
  for (let k = 1; k < hs.length; k++) hs[k] = Math.min(hs[k], hs[k - 1] + 0.05);
  hs = smoothProfile(hs, 4, 2);
  const bed = hs.map((v) => v - r.depth);
  stampLine(pts, bed, r.width * 0.5, r.width * 0.9 + 4, 'river');
  r.rpts = pts;
  r.surface = hs.map((v) => v - r.depth * 0.35);
}

// 2) rutas: perfil suavizado; puentes en línea recta entre extremos
for (const r of roads) {
  const spacing = r.major ? 6 : 5;
  const pts = resample(r.pts, spacing);
  let hs = pts.map(([x, n]) => sampleH(h0, x, n));
  hs = smoothProfile(hs, r.major ? 6 : 3, 3);
  if (r.bridge) {
    const a = hs[0], b = hs[hs.length - 1];
    let L = 0; const acc = [0];
    for (let k = 1; k < pts.length; k++) { L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); acc.push(L); }
    hs = acc.map((d) => lerp(a, b, d / (L || 1)));
  }
  r.rpts = pts;
  r.hs = hs;
}
// las calles que se tocan comparten altura en los extremos (evita escalones en cruces)
{
  const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const ends = new Map();
  for (const r of roads) for (const e of [0, r.rpts.length - 1]) {
    const k = key(r.rpts[e]);
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push([r, e]);
  }
  for (const list of ends.values()) {
    if (list.length < 2) continue;
    // la ruta de mayor jerarquía manda
    list.sort((a, b) => b[0].width - a[0].width);
    const hv = list[0][0].hs[list[0][1]];
    for (const [r, e] of list) {
      const delta = hv - r.hs[e];
      const N = Math.min(r.hs.length, 8);
      for (let q = 0; q < N; q++) {
        const kk = e === 0 ? q : r.hs.length - 1 - q;
        r.hs[kk] += delta * (1 - q / N);
      }
    }
  }
}
for (const r of roads) {
  if (r.bridge) continue;
  stampLine(r.rpts, r.hs, r.width * 0.5 + 1.2, r.major ? 14 : 8, 'road');
}
for (let id = 0; id < W * H; id++) if (inflW[id] > 0) h[id] = lerp(h[id], inflT[id], inflW[id]);

// Las rutas ahora siguen exactamente al terreno tallado (la cinta visual se apoya sobre él)
for (const r of roads) {
  if (!r.bridge) r.hs = r.rpts.map(([x, n]) => sampleH(h, x, n));
}

// ---------------------------------------------------------------- índice espacial de rutas
const CELL = 50;
const roadGrid = new Map();
function gridKey(x, n) { return `${Math.floor(x / CELL)},${Math.floor(n / CELL)}`; }
roads.forEach((r, ri) => {
  for (let k = 1; k < r.rpts.length; k++) {
    const [ax, an] = r.rpts[k - 1], [bx, bn] = r.rpts[k];
    const pad = r.width;
    for (let gx = Math.floor((Math.min(ax, bx) - pad) / CELL); gx <= Math.floor((Math.max(ax, bx) + pad) / CELL); gx++)
      for (let gn = Math.floor((Math.min(an, bn) - pad) / CELL); gn <= Math.floor((Math.max(an, bn) + pad) / CELL); gn++) {
        const kk = `${gx},${gn}`;
        if (!roadGrid.has(kk)) roadGrid.set(kk, []);
        roadGrid.get(kk).push([ri, k]);
      }
  }
});
function roadClearance(x, n) {
  // distancia al borde de la calzada más cercana (negativa si está sobre la calzada)
  const list = roadGrid.get(gridKey(x, n));
  let best = Infinity;
  if (!list) return best;
  for (const [ri, k] of list) {
    const r = roads[ri];
    const [d] = segDist(x, n, r.rpts[k - 1][0], r.rpts[k - 1][1], r.rpts[k][0], r.rpts[k][1]);
    best = Math.min(best, d - r.width / 2);
  }
  return best;
}
const riverGrid = new Map();
rivers.forEach((r, ri) => {
  for (let k = 1; k < r.rpts.length; k++) {
    const [ax, an] = r.rpts[k - 1];
    const kk = gridKey(ax, an);
    if (!riverGrid.has(kk)) riverGrid.set(kk, []);
    riverGrid.get(kk).push([ri, k]);
  }
});
function waterClearance(x, n) {
  let best = Infinity;
  const gx = Math.floor(x / CELL), gn = Math.floor(n / CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const list = riverGrid.get(`${gx + a},${gn + b}`);
    if (!list) continue;
    for (const [ri, k] of list) {
      const r = rivers[ri];
      const [d] = segDist(x, n, r.rpts[k - 1][0], r.rpts[k - 1][1], r.rpts[k][0], r.rpts[k][1]);
      best = Math.min(best, d - r.width / 2);
    }
  }
  return best;
}

// ---------------------------------------------------------------- tipo de suelo (1 byte por celda)
// 0 pastizal, 1 campo/seco, 2 bosque, 3 urbano/tierra, 4 banquina/tierra, 5 orilla/arena, 6 césped/parque
const ground = new Uint8Array(W * H);
const landPolys = [];
for (const w of osm.ways) {
  const t = w.t;
  let type = -1;
  if (t.landuse === 'forest' || t.natural === 'wood') type = 2;
  else if (t.landuse === 'farmland' || t.landuse === 'farmyard' || t.landuse === 'orchard' || t.landuse === 'vineyard') type = 1;
  else if (t.landuse === 'residential' || t.landuse === 'commercial' || t.landuse === 'retail' || t.landuse === 'industrial') type = 3;
  else if (t.landuse === 'grass' || t.landuse === 'meadow' || t.leisure === 'park' || t.leisure === 'golf_course' || t.leisure === 'pitch' || t.leisure === 'garden') type = 6;
  else if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'grassland') type = 0;
  else if (t.natural === 'sand' || t.natural === 'beach') type = 5;
  if (type < 0 || w.g.length < 6) continue;
  const p = ptsOf(w);
  if (Math.abs(polyArea(p)) < 50) continue;
  landPolys.push({ type, p, t });
}
// orden: polígonos grandes primero, los chicos pisan
landPolys.sort((a, b) => Math.abs(polyArea(b.p)) - Math.abs(polyArea(a.p)));
for (const lp of landPolys) {
  let minx = Infinity, maxx = -Infinity, minn = Infinity, maxn = -Infinity;
  for (const [x, n] of lp.p) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minn = Math.min(minn, n); maxn = Math.max(maxn, n); }
  for (let j = Math.max(0, Math.floor(toJ(minn))); j <= Math.min(H - 1, Math.ceil(toJ(maxn))); j++)
    for (let i = Math.max(0, Math.floor(toI(minx))); i <= Math.min(W - 1, Math.ceil(toI(maxx))); i++)
      if (pointInPoly(D.x0 + i * STEP, D.n0 + j * STEP, lp.p)) ground[idx(i, j)] = lp.type;
}
// ruido de campos secos fuera de polígonos, para variedad
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const id = idx(i, j);
  if (ground[id] !== 0) continue;
  const x = D.x0 + i * STEP, n = D.n0 + j * STEP;
  const v = Math.sin(x * 0.0021 + Math.sin(n * 0.0013) * 2) + Math.sin(n * 0.0027 + Math.cos(x * 0.0017) * 2);
  if (v > 1.1) ground[id] = 1;
  const tw = townAt(x, n);
  if (tw && Math.hypot(x - tw.x, n - tw.n) < tw.r * 0.45 && ground[id] === 0) ground[id] = 6;
}
// banquinas y orillas
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = D.x0 + i * STEP, n = D.n0 + j * STEP;
  const wc = waterClearance(x, n);
  if (wc < 5) { ground[idx(i, j)] = 5; continue; }
  const rc = roadClearance(x, n);
  if (rc < 3) ground[idx(i, j)] = 4;
}

// ---------------------------------------------------------------- hitos reales (relevados con Street View)
function nearestOnRoads(list, x, n) {
  let best = null, bd = Infinity;
  for (const r of list) for (let k = 0; k < r.rpts.length; k++) {
    const d = Math.hypot(r.rpts[k][0] - x, r.rpts[k][1] - n);
    if (d < bd) { bd = d; best = { r, k }; }
  }
  return best;
}
/** Camina `dist` metros por la calle desde (x, n), alejándose de (fromX, fromN). */
function gateOnRoad(list, x, n, dist, fromX, fromN) {
  const s0 = nearestOnRoads(list, x, n);
  if (!s0) return null;
  const { r } = s0;
  let k = s0.k;
  const ahead = r.rpts[Math.min(r.rpts.length - 1, k + 1)], behind = r.rpts[Math.max(0, k - 1)];
  const dir = Math.hypot(ahead[0] - fromX, ahead[1] - fromN) >= Math.hypot(behind[0] - fromX, behind[1] - fromN) ? 1 : -1;
  let acc = 0;
  while (acc < dist && k + dir >= 0 && k + dir < r.rpts.length) { const nk = k + dir; acc += Math.hypot(r.rpts[nk][0] - r.rpts[k][0], r.rpts[nk][1] - r.rpts[k][1]); k = nk; }
  const a = r.rpts[Math.max(0, Math.min(r.rpts.length - 1, k - dir))], b = r.rpts[k];
  const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return { x: b[0], n: b[1], y: sampleH(h, b[0], b[1]), heading, width: r.width, road: r.name };
}
const landmarks = [];
const rp5 = roads.filter((r) => r.ref === 'RP5');
// Arco de VGB: Ruta 5 y Av. Ojo de Agua (torre de ladrillo + hastial "En octubre Fiesta Nacional de la Cerveza")
{
  const oda = roads.filter((r) => /Ojo de Agua/.test(r.name));
  const j = nearestOnRoads(oda, 728.6, -439.3);
  const g = j && gateOnRoad(oda, j.r.rpts[j.k][0], j.r.rpts[j.k][1], 42, 741, -441);
  if (g) landmarks.push({ type: 'arcoVGB', name: 'Arco de Villa General Belgrano', ...g });
}
// Arco de Villa Ciudad Parque: Ruta 5 y Bv. Los Reartes (arco blanco colonial)
{
  const bv = roads.filter((r) => /Los Reartes/.test(r.name));
  const g = gateOnRoad(bv, 3343.5, 7000.7, 26, 3380, 7000);
  if (g) landmarks.push({ type: 'arcoVCP', name: 'Arco de Villa Ciudad Parque', ...g });
}
/** Corre un punto fuera de la calzada si hace falta. */
function offRoad(x, n, margin) {
  for (let it = 0; it < 12; it++) {
    const rc = roadClearance(x, n);
    if (rc >= margin) break;
    let best = null, bd = Infinity;
    for (const [ri, k] of roadGrid.get(gridKey(x, n)) || []) {
      const r = roads[ri];
      const [ax, an] = r.rpts[k - 1], [bx, bn] = r.rpts[k];
      const [d, t] = segDist(x, n, ax, an, bx, bn);
      if (d < bd) { bd = d; best = [ax + (bx - ax) * t, an + (bn - an) * t]; }
    }
    if (!best) break;
    const dx = x - best[0], dn = n - best[1], L = Math.hypot(dx, dn) || 1;
    x += (dx / L) * (margin - rc + 0.5); n += (dn / L) * (margin - rc + 0.5);
  }
  return [x, n];
}
// Botella gigante: Av. Las Magnolias y Ruta 5 (esquina sur)
{
  const [x, n] = offRoad(1580, 634, 3.5);
  landmarks.push({ type: 'botella', name: 'La botella de Las Magnolias', x, n, y: sampleH(h, x, n), heading: -1.4 });
}
// Barril cervecero bajo la glorieta (Av. San Martín, plaza José Hernández) y el tótem tallado "Oktoberfest"
for (const nd of osm.nodes) {
  const nm = nd.t.name || '';
  if (/Barril Cerve/i.test(nm)) { const [x, n] = offRoad(nd.p[0], nd.p[1], 3.5); landmarks.push({ type: 'barril', name: 'Barril Cervecero', x, n, y: sampleH(h, x, n), heading: 0 }); }
  if (nm === 'Oktoberfest' && nd.t.tourism === 'artwork') { const [x, n] = offRoad(nd.p[0], nd.p[1], 2.5); landmarks.push({ type: 'totem', name: 'Tótem Oktoberfest', x, n, y: sampleH(h, x, n), heading: 0 }); }
}
// Plazas circulares de Villa Ciudad Parque (dentro de las rotondas del Bv. Los Reartes)
const plazas = [];
for (const w of osm.ways) {
  if (!w.t.name || !/^(Plaza Joven|Paseo del Bosque)$/.test(w.t.name)) continue;
  const p = ptsOf(w);
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cn = p.reduce((a, q) => a + q[1], 0) / p.length;
  // radio libre: hasta el borde de la calle de la rotonda
  let r = 80;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) for (let d = 10; d < 90; d += 2) { if (roadClearance(cx + Math.cos(a) * d, cn + Math.sin(a) * d) < 1.5) { r = Math.min(r, d - 1); break; } }
  plazas.push({ name: w.t.name, x: cx, n: cn, r, y: sampleH(h, cx, cn), court: w.t.name === 'Paseo del Bosque' });
}
for (const pz of plazas) landmarks.push({ type: 'plaza', ...pz, heading: 0 });
console.log('Hitos:', landmarks.map((l) => `${l.type} (${l.x.toFixed(0)}, ${l.n.toFixed(0)})`).join(' · '));
const inPlaza = (x, n, pad = 0) => plazas.some((p) => Math.hypot(x - p.x, n - p.n) < p.r + pad);
for (const p of plazas) {
  for (let j = Math.floor(toJ(p.n - p.r)); j <= Math.ceil(toJ(p.n + p.r)); j++) for (let i = Math.floor(toI(p.x - p.r)); i <= Math.ceil(toI(p.x + p.r)); i++) {
    if (Math.hypot(D.x0 + i * STEP - p.x, D.n0 + j * STEP - p.n) < p.r - 2) ground[idx(i, j)] = 6;
  }
}

// ---------------------------------------------------------------- edificios
const buildings = []; // {x,n,rot,w,d,levels,style,roof,base,kind,name}
const occupied = new Map(); // grilla 10 m ocupada
const occKey = (x, n) => `${Math.floor(x / 10)},${Math.floor(n / 10)}`;
function occupy(x, n, w, d, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let a = -w / 2; a <= w / 2; a += 4) for (let b = -d / 2; b <= d / 2; b += 4) occupied.set(occKey(x + a * c - b * s, n + a * s + b * c), 1);
}
function isFree(x, n, w, d, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let a = -w / 2; a <= w / 2; a += 4) for (let b = -d / 2; b <= d / 2; b += 4) if (occupied.has(occKey(x + a * c - b * s, n + a * s + b * c))) return false;
  return true;
}
function footprintClear(x, n, w, d, rot, margin) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const [a, b] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
    const px = x + a * c - b * s, pn = n + a * s + b * c;
    if (roadClearance(px, pn) < margin) return false;
    if (waterClearance(px, pn) < 6) return false;
    if (toI(px) < 2 || toI(px) > W - 3 || toJ(pn) < 2 || toJ(pn) > H - 3) return false;
  }
  return true;
}
function baseHeight(x, n, w, d, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  let mn = Infinity;
  for (const [a, b] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) mn = Math.min(mn, sampleH(h, x + a * c - b * s, n + a * s + b * c));
  return mn;
}

for (const l of landmarks) {
  const R = l.type === 'plaza' ? l.r + 2 : l.type.startsWith('arco') ? 16 : 9;
  for (let a = -R; a <= R; a += 4) for (let b = -R; b <= R; b += 4) if (a * a + b * b <= R * R) occupied.set(occKey(l.x + a, l.n + b), 1);
}
function nearLandmark(x, n) { return landmarks.some((l) => Math.hypot(x - l.x, n - l.n) < (l.type === 'plaza' ? l.r + 2 : l.type.startsWith('arco') ? 14 : 7)); }
/** Mezcla de estilos en Villa General Belgrano: no todo es alpino. */
function mixStyle(tw, x, n) {
  if (!tw || tw.style !== 'alpino') return tw ? tw.style : 'rural';
  const d = Math.hypot(x - tw.x, n - tw.n) / tw.r;
  const pA = d < 0.3 ? 0.7 : d < 0.6 ? 0.45 : 0.3;
  const v = rand();
  return v < pA ? 'alpino' : v < pA + (1 - pA) * 0.45 ? 'serrano' : 'comun';
}

// a) huellas de OSM → rectángulo orientado (mínimo rectángulo por eje principal)
for (const w of osm.ways) {
  if (!w.t.building || w.g.length < 6) continue;
  const p = ptsOf(w);
  if (p.length > 2 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  const area = Math.abs(polyArea(p));
  if (area < 12) continue;
  // eje principal: arista más larga
  let best = 0, rot = 0;
  for (let k = 0; k < p.length; k++) { const [ax, an] = p[k], [bx, bn] = p[(k + 1) % p.length]; const L = Math.hypot(bx - ax, bn - an); if (L > best) { best = L; rot = Math.atan2(bn - an, bx - ax); } }
  const c = Math.cos(-rot), s = Math.sin(-rot);
  let mina = Infinity, maxa = -Infinity, minb = Infinity, maxb = -Infinity, cx = 0, cn = 0;
  for (const [x, n] of p) { cx += x; cn += n; }
  cx /= p.length; cn /= p.length;
  for (const [x, n] of p) { const a = (x - cx) * c - (n - cn) * s, b = (x - cx) * s + (n - cn) * c; mina = Math.min(mina, a); maxa = Math.max(maxa, a); minb = Math.min(minb, b); maxb = Math.max(maxb, b); }
  const ox = (mina + maxa) / 2, ob = (minb + maxb) / 2;
  const x = cx + ox * Math.cos(rot) - ob * Math.sin(rot), n = cn + ox * Math.sin(rot) + ob * Math.cos(rot);
  const bw = clamp(maxa - mina, 4, 60), bd = clamp(maxb - minb, 4, 60);
  const tw = townAt(x, n);
  if (nearLandmark(x, n)) continue;
  const levels = w.t['building:levels'] ? clamp(parseInt(w.t['building:levels']) || 1, 1, 4) : (bw * bd > 300 ? 2 : 1);
  const kind = w.t.building === 'church' || w.t.amenity === 'place_of_worship' ? 'church' : w.t.building;
  buildings.push({ x, n, rot, w: bw, d: bd, levels, style: mixStyle(tw, x, n), base: baseHeight(x, n, bw, bd, rot), kind, name: w.t.name || '', src: 'osm' });
  occupy(x, n, bw + 2, bd + 2, rot);
}
console.log(`Edificios OSM: ${buildings.length}`);

// b) casas procedurales a lo largo de las calles de cada pueblo (OSM tiene pocas huellas en la zona)
const LOT = { alpino: 22, criollo: 26, serrano: 34, rural: 120 };
let procCount = 0;
for (const r of roads) {
  if (r.bridge || ['track', 'service'].includes(r.kind)) continue;
  for (let k = 1; k < r.rpts.length; k++) {
    const [ax, an] = r.rpts[k - 1], [bx, bn] = r.rpts[k];
    const tw = townAt(ax, an);
    if (!tw) continue;
    const distC = Math.hypot(ax - tw.x, an - tw.n) / tw.r;
    const dens = tw.style === 'alpino' ? 1 - distC * 0.6 : tw.style === 'criollo' ? 0.85 - distC * 0.5 : 0.7 - distC * 0.4;
    const L = Math.hypot(bx - ax, bn - an);
    const lot = LOT[tw.style];
    // muestreo por longitud acumulada aproximada
    if (rand() > L / lot) continue;
    const dirx = (bx - ax) / L, dirn = (bn - an) / L;
    for (const side of [-1, 1]) {
      if (rand() > dens) continue;
      const t = rand();
      const st = mixStyle(tw, lerp(ax, bx, t), lerp(an, bn, t));
      const bw = st === 'alpino' ? 9 + rand() * 6 : st === 'criollo' ? 8 + rand() * 7 : st === 'comun' ? 8 + rand() * 6 : 7 + rand() * 5;
      const bd = st === 'alpino' ? 8 + rand() * 5 : 7 + rand() * 4;
      const setback = r.width / 2 + (st === 'alpino' ? 4 : st === 'criollo' ? 2.5 : st === 'comun' ? 3 + rand() * 4 : 7 + rand() * 6) + bd / 2;
      const cx = lerp(ax, bx, t) + -dirn * side * setback, cn = lerp(an, bn, t) + dirx * side * setback;
      const rot = Math.atan2(dirn, dirx);
      if (!footprintClear(cx, cn, bw, bd, rot, 2.5)) continue;
      if (!isFree(cx, cn, bw + 3, bd + 3, rot)) continue;
      const levels = st === 'alpino' ? (rand() < 0.45 ? 2 : 1) : st === 'comun' && rand() < 0.15 ? 2 : 1;
      buildings.push({ x: cx, n: cn, rot, w: bw, d: bd, levels, style: st, base: baseHeight(cx, cn, bw, bd, rot), kind: 'house', name: '', src: 'proc' });
      occupy(cx, cn, bw + 4, bd + 4, rot);
      procCount++;
    }
  }
}
// algunas casas rurales sueltas
for (let q = 0; q < 400; q++) {
  const x = D.x0 + 300 + rand() * (D.x1 - D.x0 - 600), n = D.n0 + 300 + rand() * (D.n1 - D.n0 - 600);
  if (townAt(x, n)) continue;
  const rc = roadClearance(x, n);
  if (rc < 10 || rc > 60) continue;
  const rot = rand() * Math.PI;
  const bw = 9 + rand() * 6, bd = 7 + rand() * 3;
  if (!footprintClear(x, n, bw, bd, rot, 6) || !isFree(x, n, bw + 6, bd + 6, rot)) continue;
  buildings.push({ x, n, rot, w: bw, d: bd, levels: 1, style: 'rural', base: baseHeight(x, n, bw, bd, rot), kind: 'house', name: '', src: 'proc' });
  occupy(x, n, bw + 8, bd + 8, rot);
  procCount++;
}
console.log(`Casas procedurales: ${procCount}`);

// ---------------------------------------------------------------- puntos de interés
const POI_KEYS = ['tourism', 'historic', 'amenity', 'natural', 'leisure'];
const POI_OK = new Set(['attraction', 'viewpoint', 'museum', 'place_of_worship', 'ruins', 'monument', 'memorial', 'peak', 'beach', 'townhall', 'castle', 'artwork', 'fountain']);
const pois = [];
for (const nd of osm.nodes) {
  const t = nd.t;
  if (!t.name) continue;
  const kind = POI_KEYS.map((k) => t[k]).find((v) => v && POI_OK.has(v));
  if (!kind) continue;
  if (t.historic === 'tomb') continue;
  const [x, n] = nd.p;
  if (toI(x) < 1 || toI(x) > W - 2 || toJ(n) < 1 || toJ(n) > H - 2) continue;
  const tw = townAt(x, n);
  pois.push({ id: `osm-${nd.id}`, name: t.name, kind, x, n, y: sampleH(h, x, n), town: tw ? tw.id : null, ele: t.ele ? parseFloat(t.ele) : undefined });
}
// hitos dibujados a mano (no están como nodo en OSM)
for (const p of overrides.pois || []) pois.push({ ...p, y: sampleH(h, p.x, p.n) });
console.log(`POIs: ${pois.length}`);

// ---------------------------------------------------------------- portal de entrada (cruce E-83 / RP5)
function findPortal() {
  const e83 = roads.filter((r) => r.ref === 'RPE83');
  const rp5 = roads.filter((r) => r.ref === 'RP5');
  let best = null, bd = Infinity;
  for (const a of e83) for (const p of a.rpts) for (const b of rp5) for (let k = 0; k < b.rpts.length; k += 2) {
    const d = Math.hypot(p[0] - b.rpts[k][0], p[1] - b.rpts[k][1]);
    if (d < bd) { bd = d; best = { road: a, p }; }
  }
  if (!best) return null;
  // ubicar el portal ~120 m hacia el pueblo sobre la E-83
  const r = best.road;
  const k0 = r.rpts.indexOf(best.p);
  const dirToTown = Math.hypot(r.rpts[0][0], r.rpts[0][1]) < Math.hypot(r.rpts[r.rpts.length - 1][0], r.rpts[r.rpts.length - 1][1]) ? -1 : 1;
  let k = k0, acc = 0;
  while (acc < 120 && k + dirToTown >= 0 && k + dirToTown < r.rpts.length) { const nk = k + dirToTown; acc += Math.hypot(r.rpts[nk][0] - r.rpts[k][0], r.rpts[nk][1] - r.rpts[k][1]); k = nk; }
  const a = r.rpts[Math.max(0, k - 1)], b = r.rpts[Math.min(r.rpts.length - 1, k + 1)];
  const heading = Math.atan2(b[1] - a[1], b[0] - a[0]) * (dirToTown > 0 ? 1 : -1) + (dirToTown > 0 ? 0 : 0);
  const towardTown = dirToTown > 0 ? Math.atan2(b[1] - a[1], b[0] - a[0]) : Math.atan2(a[1] - b[1], a[0] - b[0]);
  return { x: r.rpts[k][0], n: r.rpts[k][1], y: sampleH(h, r.rpts[k][0], r.rpts[k][1]), heading: towardTown, width: r.width, junction: best.p, _h: heading };
}
const arco = landmarks.find((l) => l.type === 'arcoVGB');
const portal = overrides.portal || (arco ? { x: arco.x, n: arco.n, y: arco.y, heading: arco.heading, width: arco.width } : findPortal());
console.log('Portal:', portal && `${portal.x.toFixed(0)}, ${portal.n.toFixed(0)}`);

// ---------------------------------------------------------------- árboles
// x, n, escala, tipo (0 pino, 1 latifoliada, 2 arbusto/espinillo, 3 sauce)
const trees = [];
const TSTEP = 10;
for (let n = D.n0 + 20; n < D.n1 - 20; n += TSTEP) {
  for (let x = D.x0 + 20; x < D.x1 - 20; x += TSTEP) {
    const px = x + (rand() - 0.5) * TSTEP * 0.9, pn = n + (rand() - 0.5) * TSTEP * 0.9;
    if (inPlaza(px, pn, 3) || nearLandmark(px, pn)) continue;
    const g = ground[idx(Math.round(toI(px)), Math.round(toJ(pn)))];
    const tw = townAt(px, pn);
    let p;
    switch (g) {
      case 2: p = 0.62; break; // bosque
      case 1: p = 0.01; break;
      case 3: p = 0.14; break;
      case 4: p = 0; break;
      case 5: p = 0.25; break;
      case 6: p = 0.1; break;
      default: p = 0.045;
    }
    // manchones de pinar típicos de la zona (más densos en Villa Ciudad Parque y alrededores de VGB)
    const patch = Math.sin(px * 0.004 + Math.sin(pn * 0.003) * 3) * Math.sin(pn * 0.0035 + Math.cos(px * 0.0025) * 2);
    if (patch > 0.35) p += 0.35;
    if (tw && tw.style === 'serrano') p += 0.22;
    if (tw && tw.style === 'alpino') p += 0.08;
    // laderas altas: más monte, menos pinos
    const hh = sampleH(h, px, pn);
    if (rand() > p) continue;
    if (roadClearance(px, pn) < 2.5) continue;
    if (waterClearance(px, pn) < 1.5) continue;
    if (occupied.has(occKey(px, pn))) continue;
    let type;
    const wc = waterClearance(px, pn);
    if (wc < 14) type = rand() < 0.7 ? 3 : 1;
    else if (g === 2 || patch > 0.35 || (tw && tw.style !== 'criollo')) type = rand() < 0.85 ? 0 : 1;
    else type = rand() < 0.55 ? 2 : rand() < 0.5 ? 1 : 0;
    if (hh > 1000 && type === 0 && rand() < 0.6) type = 2;
    const scale = type === 0 ? 0.75 + rand() * 0.65 : type === 2 ? 0.6 + rand() * 0.6 : 0.8 + rand() * 0.5;
    trees.push(px, pn, scale, type);
  }
}
// arboleda densa de las plazas circulares, dejando libres los senderos radiales y el centro
for (const p of plazas) {
  for (let a = -p.r; a <= p.r; a += 6.5) for (let b = -p.r; b <= p.r; b += 6.5) {
    const x = p.x + a + (rand() - 0.5) * 4, n = p.n + b + (rand() - 0.5) * 4;
    const d = Math.hypot(x - p.x, n - p.n);
    if (d > p.r - 3 || d < 9) continue;
    const ang = Math.atan2(n - p.n, x - p.x);
    const toPath = Math.abs(Math.sin((ang * 8) / 2)) * d; // 8 senderos radiales
    if (toPath < 3.2) continue;
    if (p.court && Math.abs(x - p.x - p.r * 0.45) < 14 && Math.abs(n - p.n) < 20) continue; // canchas
    trees.push(x, n, 0.9 + rand() * 0.45, rand() < 0.85 ? 1 : 0);
  }
}
console.log(`Árboles: ${trees.length / 4}`);

// ---------------------------------------------------------------- cruces (para cortar la demarcación)
const junctions = [];
{
  const addJ = (x, n, r) => {
    for (const j of junctions) if (Math.hypot(j[0] - x, j[1] - n) < 4) { j[2] = Math.max(j[2], r); return; }
    junctions.push([x, n, r]);
  };
  roads.forEach((r, ri) => {
    for (const e of [0, r.rpts.length - 1]) {
      const [x, n] = r.rpts[e];
      let wmax = 0, hits = 0;
      for (const [rj, k] of roadGrid.get(gridKey(x, n)) || []) {
        if (rj === ri) continue;
        const o = roads[rj];
        const [d] = segDist(x, n, o.rpts[k - 1][0], o.rpts[k - 1][1], o.rpts[k][0], o.rpts[k][1]);
        if (d < o.width / 2 + 1.5) { hits++; wmax = Math.max(wmax, o.width); }
      }
      if (hits) addJ(x, n, Math.max(wmax, r.width) / 2 + 3);
    }
  });
}
console.log(`Cruces: ${junctions.length}`);

// ---------------------------------------------------------------- escritura
function writeU16(name, arr, scale = 10) {
  const u = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) u[i] = clamp(Math.round(arr[i] * scale), 0, 65535);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(u.buffer));
}
writeU16('terrain.bin', h, 20); // metros * 20 (5 cm)
fs.writeFileSync(path.join(OUT, 'ground.bin'), Buffer.from(ground.buffer));
// fondo: dentro del área de detalle se hunde para no competir con el terreno jugable
const far = Float32Array.from(F.h);
for (let j = 0; j < F.H; j++) for (let i = 0; i < F.W; i++) {
  const x = F.x0 + i * F.step, n = F.n0 + j * F.step;
  const inside = x > D.x0 + 200 && x < D.x1 - 200 && n > D.n0 + 200 && n < D.n1 - 200;
  if (inside) far[j * F.W + i] = sampleH(h, x, n) - 40;
}
writeU16('far.bin', far, 10);
fs.writeFileSync(path.join(OUT, 'trees.bin'), Buffer.from(new Float32Array(trees).buffer));

const round1 = (v) => Math.round(v * 10) / 10;
const roadsOut = roads.map((r) => ({
  id: r.id, name: r.name, ref: r.ref, kind: r.kind, surface: r.surface, bridge: r.bridge, width: r.width, major: r.major, rb: r.rb || undefined, link: r.link || undefined,
  p: r.rpts.flatMap(([x, n], k) => [round1(x), round1(n), round1(r.hs[k])]),
}));
const pathsOut = paths.map((p) => ({ id: p.id, kind: p.t.highway, name: p.t.name || '', p: resample(p.pts, 4).flatMap(([x, n]) => [round1(x), round1(n), round1(sampleH(h, x, n))]) }));
const riversOut = rivers.map((r) => ({ id: r.id, name: r.name, kind: r.kind, width: r.width, intermittent: r.intermittent, p: r.rpts.flatMap(([x, n], k) => [round1(x), round1(n), round1(r.surface[k])]) }));
const bOut = buildings.map((b) => ({ x: round1(b.x), n: round1(b.n), r: Math.round(b.rot * 1000) / 1000, w: round1(b.w), d: round1(b.d), l: b.levels, s: b.style, y: round1(b.base), k: b.kind, name: b.name || undefined }));

const meta = {
  version: 1,
  generated: new Date().toISOString(),
  source: { osm: osm.meta.source, osm_base: osm.meta.osm_base, dem: dem.meta.source },
  origin: { lat: osm.meta.origin[0], lon: osm.meta.origin[1], mPerDegLat: osm.meta.mPerDegLat, mPerDegLon: osm.meta.mPerDegLon },
  terrain: { file: 'terrain.bin', scale: 20, x0: D.x0, x1: D.x1, n0: D.n0, n1: D.n1, step: STEP, W, H },
  ground: { file: 'ground.bin' },
  far: { file: 'far.bin', scale: 10, x0: F.x0, x1: F.x1, n0: F.n0, n1: F.n1, step: F.step, W: F.W, H: F.H },
  playArea: { x0: -4350, x1: 4160, n0: -2050, n1: 11250 },
  towns: TOWNS,
  portal,
  start: (() => {
    // sobre la Ruta 5, viniendo del sur hacia la rotonda de Ojo de Agua: el arco queda a la izquierda
    let best = null, bd = Infinity;
    for (const r of rp5) for (let k = 1; k < r.rpts.length; k++) {
      const [x, n] = r.rpts[k];
      const d = Math.hypot(x - 741, n + 441);
      if (n < -441 && Math.abs(d - 75) < bd) { bd = Math.abs(d - 75); best = { x, n, heading: Math.atan2(-441 - n, 741 - x) }; }
    }
    return best ?? (portal ? { x: portal.x, n: portal.n, heading: portal.heading } : { x: 0, n: 0, heading: 0 });
  })(),
  landmarks: landmarks.map((l) => ({ type: l.type, name: l.name, x: l.x, n: l.n, y: l.y, heading: l.heading, width: l.width, r: l.r, court: l.court })),
  counts: { roads: roads.length, rivers: rivers.length, buildings: buildings.length, trees: trees.length / 4, pois: pois.length },
};
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
fs.writeFileSync(path.join(OUT, 'roads.json'), JSON.stringify(roadsOut));
fs.writeFileSync(path.join(OUT, 'junctions.json'), JSON.stringify(junctions.map((j) => j.map(round1))));
fs.writeFileSync(path.join(OUT, 'paths.json'), JSON.stringify(pathsOut));
fs.writeFileSync(path.join(OUT, 'water.json'), JSON.stringify({ rivers: riversOut, areas: waterAreas.map((a) => ({ name: a.name, p: a.pts.flat().map(round1) })) }));
fs.writeFileSync(path.join(OUT, 'buildings.json'), JSON.stringify(bOut));
fs.writeFileSync(path.join(OUT, 'pois.json'), JSON.stringify(pois.map((p) => ({ ...p, x: round1(p.x), n: round1(p.n), y: round1(p.y) }))));

for (const f of fs.readdirSync(OUT)) console.log(`  ${f.padEnd(16)} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`);
console.log('Mundo construido ✔');
