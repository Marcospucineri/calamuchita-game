// Verifica que el heightfield de Rapier coincida con los datos de relieve (orientación de filas/columnas).
import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';

await RAPIER.init();
const meta = JSON.parse(fs.readFileSync('public/world/meta.json', 'utf8'));
const t = meta.terrain;
const raw = fs.readFileSync('public/world/terrain.bin');
const u = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const H = new Float32Array(u.length);
for (let i = 0; i < u.length; i++) H[i] = u[i] / t.scale;

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const nrows = t.H - 1, ncols = t.W - 1;
const hs = new Float32Array((nrows + 1) * (ncols + 1));
for (let j = 0; j <= ncols; j++) for (let i = 0; i <= nrows; i++) hs[i + j * (nrows + 1)] = H[(t.H - 1 - i) * t.W + j];
const sx = ncols * t.step, sz = nrows * t.step;
world.createCollider(RAPIER.ColliderDesc.heightfield(nrows, ncols, hs, { x: sx, y: 1, z: sz }).setTranslation(t.x0 + sx / 2, 0, -(t.n0 + sz / 2)));
world.step();

const hAt = (x, n) => {
  const fi = (x - t.x0) / t.step, fj = (n - t.n0) / t.step;
  const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, W = t.W;
  return (H[j * W + i] * (1 - a) + H[j * W + i + 1] * a) * (1 - b) + (H[(j + 1) * W + i] * (1 - a) + H[(j + 1) * W + i + 1] * a) * b;
};
let maxErr = 0;
for (const [x, n] of [[0, 0], [-1690, 6190], [1500, 7600], [-4000, -2500], [4500, 11500], [3000.3, 2000.7], [-2000.2, 9000.4], [1234, 5678], [3000, 2000]]) {
  const hit = world.castRay(new RAPIER.Ray({ x, y: 3000, z: -n }, { x: 0, y: -1, z: 0 }), 5000, true);
  if (!hit) { console.log(`(${x}, ${n}) SIN IMPACTO`); continue; }
  const y = 3000 - hit.timeOfImpact;
  maxErr = Math.max(maxErr, Math.abs(y - hAt(x, n)));
  console.log(`(${x}, ${n})  rayo ${y.toFixed(2)}  datos ${hAt(x, n).toFixed(2)}`);
}
console.log('error máximo', maxErr.toFixed(3), maxErr < 0.5 ? 'OK' : 'ORIENTACIÓN INCORRECTA');
