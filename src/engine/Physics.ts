import RAPIER from '@dimforge/rapier3d-compat';
import { WorldData } from '../world/WorldData';
import type { BoxCollider } from '../world/Buildings';
import type { Vegetation } from '../world/Vegetation';

export { RAPIER };

/** Mundo de Rapier: terreno (heightfield), edificios, puentes y troncos cercanos. */
export class Physics {
  readonly world: RAPIER.World;
  private treeColliders = new Map<number, RAPIER.Collider>();
  private lastTreeCenter = { x: 1e9, n: 1e9 };

  static async init(): Promise<void> {
    await RAPIER.init();
  }

  constructor(private w: WorldData) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.buildTerrain();
  }

  private buildTerrain(): void {
    const t = this.w.meta.terrain;
    const nrows = t.H - 1; // filas a lo largo de Z
    const ncols = t.W - 1; // columnas a lo largo de X
    const heights = new Float32Array((nrows + 1) * (ncols + 1));
    // Rapier: matriz en orden por columnas; fila i = Z creciente (desde el norte), columna j = X creciente
    for (let j = 0; j <= ncols; j++)
      for (let i = 0; i <= nrows; i++) {
        const gridRow = t.H - 1 - i; // Z = -n: la fila 0 es la del extremo norte
        heights[i + j * (nrows + 1)] = this.w.heights[gridRow * t.W + j];
      }
    const sx = ncols * t.step, sz = nrows * t.step;
    const desc = RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, { x: sx, y: 1, z: sz })
      .setTranslation(t.x0 + sx / 2, 0, -(t.n0 + sz / 2))
      .setFriction(1.0);
    this.world.createCollider(desc);
  }

  addBoxes(boxes: BoxCollider[]): void {
    for (const b of boxes) {
      const q = { x: 0, y: Math.sin(b.rotY / 2), z: 0, w: Math.cos(b.rotY / 2) };
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation(q));
    }
  }

  addTrimesh(vertices: Float32Array, indices: Uint32Array): void {
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(1.0));
  }

  /** Mantiene colisiones de troncos solo alrededor del jugador. */
  updateTrees(veg: Vegetation, x: number, n: number): void {
    if (Math.hypot(x - this.lastTreeCenter.x, n - this.lastTreeCenter.n) < 30) return;
    this.lastTreeCenter = { x, n };
    const wanted = new Set(veg.treesNear(x, n, 110));
    for (const [i, c] of this.treeColliders) if (!wanted.has(i)) { this.world.removeCollider(c, false); this.treeColliders.delete(i); }
    for (const i of wanted) {
      if (this.treeColliders.has(i)) continue;
      const t = veg.treeInfo(i);
      if (t.type === 2) continue; // arbustos: se atraviesan
      const r = (t.type === 3 ? 0.35 : 0.25) * t.scale + 0.05;
      const c = this.world.createCollider(RAPIER.ColliderDesc.cylinder(1.6, r).setTranslation(t.x, t.y + 1.6, -t.n));
      this.treeColliders.set(i, c);
    }
  }

  step(): void {
    this.world.step();
  }

  castDown(x: number, z: number, fromY: number, maxToi = 400): number | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxToi, true);
    return hit ? fromY - hit.timeOfImpact : null;
  }
}
