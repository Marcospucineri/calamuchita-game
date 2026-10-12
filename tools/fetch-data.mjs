// Descarga los datos reales del valle a tools/raw/ (requiere internet; Node 18+).
//   - OpenStreetMap vía Overpass API → calamuchita-osm.json (proyectado a metros locales)
//   - Relieve: tiles Terrarium (AWS Open Data) → calamuchita-dem.json
// Es la misma extracción que se hizo la primera vez desde el navegador.
// Uso: npm run data   (después: npm run world)

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'tools/raw');
fs.mkdirSync(RAW, { recursive: true });

const LAT0 = -31.9765, LON0 = -64.559, R = Math.PI / 180;
const MLAT = 111132.92 - 559.82 * Math.cos(2 * LAT0 * R) + 1.175 * Math.cos(4 * LAT0 * R);
const MLON = 111412.84 * Math.cos(LAT0 * R) - 93.5 * Math.cos(3 * LAT0 * R);
const P = (lat, lon) => [Math.round((lon - LON0) * MLON * 10) / 10, Math.round((lat - LAT0) * MLAT * 10) / 10];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ OSM
async function fetchOSM() {
  const bb = '(-32.004,-64.612,-31.868,-64.506)';
  const q = `[out:json][timeout:180];(
   way["highway"]${bb}; way["waterway"]${bb}; way["natural"="water"]${bb}; way["building"]${bb}; way["landuse"]${bb};
   way["natural"~"^(wood|scrub|grassland|heath|bare_rock|sand|beach)$"]${bb};
   way["leisure"~"^(park|pitch|golf_course|playground|garden)$"]${bb};
   node["tourism"]["name"]${bb}; node["historic"]["name"]${bb}; node["amenity"]["name"]${bb}; node["natural"~"^(peak|beach)$"]${bb}; node["place"]${bb}; node["shop"]["name"]${bb};
   way["tourism"]["name"]${bb}; way["historic"]["name"]${bb}; way["amenity"~"^(place_of_worship|townhall|school|parking|fuel)$"]${bb};
  );out geom;`;
  let j = null;
  for (let i = 0; i < 6 && !j; i++) {
    console.log(`Overpass, intento ${i + 1}…`);
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'calamuchita-game' }, body: new URLSearchParams({ data: q }) });
    const t = await r.text();
    if (r.ok && t.trim().startsWith('{')) j = JSON.parse(t);
    else await sleep(10000);
  }
  if (!j) throw new Error('Overpass no respondió');
  const keep = ['highway', 'name', 'ref', 'surface', 'bridge', 'tunnel', 'layer', 'lanes', 'width', 'oneway', 'tracktype', 'service', 'waterway', 'intermittent', 'natural', 'water', 'building', 'building:levels', 'roof:shape', 'height', 'landuse', 'leisure', 'tourism', 'historic', 'amenity', 'shop', 'place', 'ele', 'population', 'sport', 'junction', 'smoothness', 'barrier'];
  // Douglas-Peucker que también funciona con anillos cerrados (primer punto = último)
  const dp = (pts, eps) => {
    if (pts.length < 3) return pts;
    const k = new Uint8Array(pts.length);
    k[0] = k[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      if (b - a < 2) continue;
      let md = 0, mi = -1;
      const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      for (let i = a + 1; i < b; i++) {
        const d = L < 1e-6 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps) { k[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => k[i]);
  };
  const out = { meta: { origin: [LAT0, LON0], mPerDegLat: MLAT, mPerDegLon: MLON, axes: 'x=east m, y=north m', source: '© OpenStreetMap contributors (ODbL)', osm_base: j.osm3s?.timestamp_osm_base, bbox: bb, version: 2 }, ways: [], nodes: [] };
  for (const e of j.elements) {
    const tags = {};
    for (const k of keep) if (e.tags?.[k] != null) tags[k] = e.tags[k];
    if (e.type === 'node') out.nodes.push({ id: e.id, p: P(e.lat, e.lon), t: tags });
    else if (e.type === 'way' && e.geometry) {
      const pts = dp(e.geometry.map((g) => P(g.lat, g.lon)), tags.building ? 0.25 : 0.5);
      out.ways.push({ id: e.id, t: tags, g: pts.flat(), closed: e.nodes && e.nodes[0] === e.nodes[e.nodes.length - 1] });
    }
  }
  fs.writeFileSync(path.join(RAW, 'calamuchita-osm.json'), JSON.stringify(out));
  console.log(`OSM: ${out.ways.length} vías/áreas, ${out.nodes.length} puntos`);
}

// ------------------------------------------------------------------ Relieve
const cache = new Map();
async function tile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (cache.has(k)) return cache.get(k);
  const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`);
  if (!r.ok) throw new Error(`tile ${k}: ${r.status}`);
  const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
  const h = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) h[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  cache.set(k, h);
  return h;
}
const gpx = (lat, lon, z) => { const n = 256 * 2 ** z, lr = lat * R; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n]; };
const px = (z, gx, gy) => { const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256); return cache.get(`${z}/${tx}/${ty}`)[(gy - ty * 256) * 256 + (gx - tx * 256)]; };
function sample(z, lat, lon) {
  let [x, y] = gpx(lat, lon, z);
  x -= 0.5; y -= 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (j) => cr(px(z, ix - 1, iy + j), px(z, ix, iy + j), px(z, ix + 1, iy + j), px(z, ix + 2, iy + j), fx);
  return cr(row(-1), row(0), row(1), row(2), fy);
}
async function grid(z, x0, x1, n0, n1, step) {
  const W = Math.round((x1 - x0) / step) + 1, H = Math.round((n1 - n0) / step) + 1;
  const [ax, ay] = gpx(LAT0 + n1 / MLAT, LON0 + x0 / MLON, z), [bx, by] = gpx(LAT0 + n0 / MLAT, LON0 + x1 / MLON, z);
  const jobs = [];
  for (let tx = Math.floor(ax / 256) - 1; tx <= Math.floor(bx / 256) + 1; tx++) for (let ty = Math.floor(ay / 256) - 1; ty <= Math.floor(by / 256) + 1; ty++) jobs.push(tile(z, tx, ty));
  await Promise.all(jobs);
  const u = new Uint16Array(W * H);
  let mn = 1e9, mx = -1e9;
  for (let j = 0; j < H; j++) {
    const lat = LAT0 + (n0 + j * step) / MLAT;
    for (let i = 0; i < W; i++) {
      const h = sample(z, lat, LON0 + (x0 + i * step) / MLON);
      mn = Math.min(mn, h); mx = Math.max(mx, h);
      u[j * W + i] = Math.max(0, Math.min(65535, Math.round(h * 10)));
    }
  }
  return { x0, x1, n0, n1, step, W, H, zoom: z, min: mn, max: mx, encoding: 'uint16 LE, metros*10, fila por fila de sur (n0) a norte (n1), oeste a este', data: Buffer.from(u.buffer).toString('base64') };
}
async function fetchDEM() {
  console.log('Relieve: grilla de detalle (10 m)…');
  const detail = await grid(13, -5000, 5000, -3000, 12000, 10);
  console.log('Relieve: sierras lejanas (200 m)…');
  const far = await grid(11, -40000, 25000, -25000, 35000, 200);
  const out = { meta: { origin: [LAT0, LON0], mPerDegLat: MLAT, mPerDegLon: MLON, source: 'Terrarium elevation tiles (Mapzen/AWS Open Data: SRTM, GMTED y otros)' }, detail, far };
  fs.writeFileSync(path.join(RAW, 'calamuchita-dem.json'), JSON.stringify(out));
  console.log(`DEM: ${detail.min.toFixed(0)}–${detail.max.toFixed(0)} m`);
}

const which = process.argv[2];
if (!which || which === 'osm') await fetchOSM();
if (!which || which === 'dem') await fetchDEM();
console.log('Listo. Ahora corré: npm run world');
