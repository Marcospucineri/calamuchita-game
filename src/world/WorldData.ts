/**
 * Datos del mundo generados por tools/build-world.mjs a partir de OpenStreetMap + DEM.
 * Coordenadas del pipeline: x = Este, n = Norte (metros, origen en el centro de VGB).
 * En Three.js: X = x, Z = -n.
 */

export interface GridInfo { x0: number; x1: number; n0: number; n1: number; step: number; W: number; H: number; scale: number; file: string }

export interface Landmark { type: 'arcoVGB' | 'arcoVCP' | 'botella' | 'barril' | 'totem' | 'plaza'; name: string; x: number; n: number; y: number; heading?: number; width?: number; r?: number; court?: boolean }

export interface Town { id: string; name: string; style: string; x: number; n: number; r: number }

export interface WorldMeta {
  origin: { lat: number; lon: number; mPerDegLat: number; mPerDegLon: number };
  terrain: GridInfo;
  far: GridInfo;
  playArea: { x0: number; x1: number; n0: number; n1: number };
  towns: Town[];
  portal: { x: number; n: number; y: number; heading: number; width: number } | null;
  start: { x: number; n: number; heading: number };
  landmarks?: Landmark[];
  source: { osm: string; osm_base: string; dem: string };
}

export type Surface = 'asphalt' | 'paving' | 'compacted' | 'gravel' | 'dirt';

export interface Road { id: number; name: string; ref: string; kind: string; surface: Surface; bridge: boolean; width: number; major: boolean; rb?: boolean; link?: boolean; p: number[] }
export interface River { id: number; name: string; kind: string; width: number; intermittent: boolean; p: number[] }
export interface Building { x: number; n: number; r: number; w: number; d: number; l: number; s: string; y: number; k: string; name?: string }
export interface POI { id: string; name: string; kind: string; x: number; n: number; y: number; town: string | null; ele?: number }

export const GROUND = { PASTURE: 0, FIELD: 1, FOREST: 2, URBAN: 3, SHOULDER: 4, BANK: 5, LAWN: 6 } as const;

export class WorldData {
  meta!: WorldMeta;
  heights!: Float32Array;
  ground!: Uint8Array;
  far!: Float32Array;
  trees!: Float32Array;
  roads!: Road[];
  rivers!: River[];
  buildings!: Building[];
  pois!: POI[];
  junctions: [number, number, number][] = [];

  private roadGrid = new Map<string, number[]>(); // celda -> [roadIndex, segIndex, ...]
  private static CELL = 40;

  static async load(base = './world/', onProgress?: (p: number, label: string) => void): Promise<WorldData> {
    const w = new WorldData();
    const steps = 9;
    let done = 0;
    const tick = (label: string) => onProgress?.(++done / steps, label);
    const json = async <T>(f: string): Promise<T> => { const r = await fetch(base + f); if (!r.ok) throw new Error(`No se pudo cargar ${f}`); return r.json(); };
    // algunos hostings no sirven .bin: la página puede pedir otra extensión (p. ej. .wasm)
    const binExt = (window as unknown as { CALAMUCHITA_BIN_EXT?: string }).CALAMUCHITA_BIN_EXT ?? '.bin';
    const bin = async (f: string): Promise<ArrayBuffer> => { const name = f.replace(/\.bin$/, binExt); const r = await fetch(base + name); if (!r.ok) throw new Error(`No se pudo cargar ${name}`); return r.arrayBuffer(); };

    w.meta = await json<WorldMeta>('meta.json'); tick('Leyendo el mapa');
    const [tb, gb, fb, trb] = await Promise.all([
      bin(w.meta.terrain.file).then((b) => { tick('Relieve del valle'); return b; }),
      bin('ground.bin').then((b) => { tick('Suelos'); return b; }),
      bin(w.meta.far.file).then((b) => { tick('Sierras lejanas'); return b; }),
      bin('trees.bin').then((b) => { tick('Pinares'); return b; }),
    ]);
    const tu = new Uint16Array(tb);
    w.heights = new Float32Array(tu.length);
    for (let i = 0; i < tu.length; i++) w.heights[i] = tu[i] / w.meta.terrain.scale;
    w.ground = new Uint8Array(gb);
    const fu = new Uint16Array(fb);
    w.far = new Float32Array(fu.length);
    for (let i = 0; i < fu.length; i++) w.far[i] = fu[i] / w.meta.far.scale;
    w.trees = new Float32Array(trb);
    const [roads, water, buildings, pois] = await Promise.all([
      json<Road[]>('roads.json').then((v) => { tick('Rutas'); return v; }),
      json<{ rivers: River[] }>('water.json').then((v) => { tick('Ríos'); return v; }),
      json<Building[]>('buildings.json').then((v) => { tick('Casas'); return v; }),
      json<POI[]>('pois.json'),
    ]);
    w.junctions = await json<[number, number, number][]>('junctions.json').catch(() => []);
    w.roads = roads;
    w.rivers = water.rivers;
    w.buildings = buildings;
    w.pois = pois;
    w.indexRoads();
    return w;
  }

  /** Altura del terreno (bilineal) en coordenadas del pipeline. */
  heightAt(x: number, n: number): number {
    const t = this.meta.terrain;
    let fi = (x - t.x0) / t.step, fj = (n - t.n0) / t.step;
    if (fi < 0 || fj < 0 || fi > t.W - 1 || fj > t.H - 1) return this.farHeightAt(x, n);
    fi = Math.min(fi, t.W - 1.0001); fj = Math.min(fj, t.H - 1.0001);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const W = t.W, hh = this.heights;
    const a = hh[j * W + i], b = hh[j * W + i + 1], c = hh[(j + 1) * W + i], d = hh[(j + 1) * W + i + 1];
    // misma triangulación que la malla (diagonal (i,j)-(i+1,j+1))
    if (u >= v) return a + (b - a) * u + (d - b) * v;
    return a + (d - c) * u + (c - a) * v;
  }

  /** Altura en coordenadas de Three (X, Z). */
  heightAtXZ(X: number, Z: number): number {
    return this.heightAt(X, -Z);
  }

  farHeightAt(x: number, n: number): number {
    const f = this.meta.far;
    const fi = Math.max(0, Math.min(f.W - 1.0001, (x - f.x0) / f.step)), fj = Math.max(0, Math.min(f.H - 1.0001, (n - f.n0) / f.step));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const W = f.W, hh = this.far;
    return (hh[j * W + i] * (1 - u) + hh[j * W + i + 1] * u) * (1 - v) + (hh[(j + 1) * W + i] * (1 - u) + hh[(j + 1) * W + i + 1] * u) * v;
  }

  groundAt(x: number, n: number): number {
    const t = this.meta.terrain;
    const i = Math.round((x - t.x0) / t.step), j = Math.round((n - t.n0) / t.step);
    if (i < 0 || j < 0 || i >= t.W || j >= t.H) return 0;
    return this.ground[j * t.W + i];
  }

  townAt(x: number, n: number): { town: Town; d: number } | null {
    let best: Town | null = null, bd = Infinity;
    for (const t of this.meta.towns) {
      const d = Math.hypot(x - t.x, n - t.n) / t.r;
      if (d < 1 && d < bd) { bd = d; best = t; }
    }
    return best ? { town: best, d: bd } : null;
  }

  private indexRoads(): void {
    const C = WorldData.CELL;
    this.roads.forEach((r, ri) => {
      const p = r.p;
      for (let k = 3; k < p.length; k += 3) {
        const ax = p[k - 3], an = p[k - 2], bx = p[k], bn = p[k + 1];
        const pad = r.width;
        for (let gx = Math.floor((Math.min(ax, bx) - pad) / C); gx <= Math.floor((Math.max(ax, bx) + pad) / C); gx++)
          for (let gn = Math.floor((Math.min(an, bn) - pad) / C); gn <= Math.floor((Math.max(an, bn) + pad) / C); gn++) {
            const key = `${gx},${gn}`;
            let list = this.roadGrid.get(key);
            if (!list) this.roadGrid.set(key, (list = []));
            list.push(ri, k);
          }
      }
    });
  }

  /** Calle más cercana: devuelve la ruta y la distancia al eje. */
  nearestRoad(x: number, n: number): { road: Road; dist: number; y: number; dirX: number; dirN: number; px: number; pn: number } | null {
    const C = WorldData.CELL;
    const list = this.roadGrid.get(`${Math.floor(x / C)},${Math.floor(n / C)}`);
    if (!list) return null;
    let best: Road | null = null, bd = Infinity, by = 0, bdx = 1, bdn = 0, bpx = x, bpn = n;
    for (let q = 0; q < list.length; q += 2) {
      const r = this.roads[list[q]], k = list[q + 1], p = r.p;
      const ax = p[k - 3], an = p[k - 2], ay = p[k - 1], bx = p[k], bn = p[k + 1], byy = p[k + 2];
      const dx = bx - ax, dn = bn - an, L2 = dx * dx + dn * dn || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (n - an) * dn) / L2));
      const d = Math.hypot(x - (ax + t * dx), n - (an + t * dn));
      // a igual distancia, gana la ruta de mayor jerarquía
      const score = d - (r.major ? 0.5 : 0);
      if (score < bd) { bd = score; best = r; by = ay + (byy - ay) * t; const L = Math.sqrt(L2); bdx = dx / L; bdn = dn / L; bpx = ax + t * dx; bpn = an + t * dn; }
    }
    if (!best) return null;
    return { road: best, dist: bd + (best.major ? 0.5 : 0), y: by, dirX: bdx, dirN: bdn, px: bpx, pn: bpn };
  }

  surfaceAt(x: number, n: number): { surface: Surface | 'grass' | 'water'; road: Road | null } {
    const nr = this.nearestRoad(x, n);
    if (nr && nr.dist <= nr.road.width / 2 + 0.3) return { surface: nr.road.surface, road: nr.road };
    const g = this.groundAt(x, n);
    if (g === GROUND.BANK) return { surface: 'dirt', road: null };
    if (g === GROUND.SHOULDER || g === GROUND.URBAN) return { surface: 'dirt', road: null };
    return { surface: 'grass', road: null };
  }

  /** lat/lon reales a partir de coordenadas del pipeline (para mostrar en el mapa). */
  toLatLon(x: number, n: number): [number, number] {
    const o = this.meta.origin;
    return [o.lat + n / o.mPerDegLat, o.lon + x / o.mPerDegLon];
  }
}
