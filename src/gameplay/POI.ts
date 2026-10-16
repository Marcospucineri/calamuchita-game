import * as THREE from 'three';
import { bus } from '../core/EventBus';
import { paintedMaterial } from '../render/PaintedMaterial';
import { POI, WorldData } from '../world/WorldData';

const KIND_LABEL: Record<string, string> = {
  attraction: 'Atractivo',
  viewpoint: 'Mirador',
  museum: 'Museo',
  place_of_worship: 'Capilla',
  ruins: 'Sitio histórico',
  monument: 'Monumento',
  memorial: 'Memorial',
  peak: 'Cerro',
  beach: 'Balneario',
  townhall: 'Municipalidad',
  castle: 'Castillo',
  artwork: 'Arte',
  fountain: 'Fuente',
};

export const kindLabel = (k: string) => KIND_LABEL[k] ?? 'Lugar';

/**
 * Puntos de interés reales (OSM): al acercarse se "descubren" y se suman a la colección de postales.
 * Los no descubiertos tienen un cartelito con una postal flotando.
 */
export class POIs {
  readonly discovered = new Set<string>();
  private markers = new Map<string, THREE.Object3D>();
  private t = 0;

  constructor(private w: WorldData, scene: THREE.Scene, saved: string[]) {
    saved.forEach((id) => this.discovered.add(id));
    const post = paintedMaterial({ color: 0x6b4428, brushScale: 2 });
    const card = paintedMaterial({ color: 0xf4e7c5, emissive: 0x3a2e10, brushScale: 3, brushAmount: 0.1 });
    const stamp = paintedMaterial({ color: 0xc8452c, emissive: 0x401008 });
    for (const p of w.pois) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 6), post);
      pole.position.y = 1.1;
      g.add(pole);
      const c = new THREE.Group();
      const cardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.05), card);
      c.add(cardMesh);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.06), stamp);
      st.position.set(0.28, 0.16, 0.01);
      c.add(st);
      c.position.y = 2.75;
      c.name = 'card';
      g.add(c);
      g.position.set(p.x, w.heightAt(p.x, p.n), -p.n);
      g.visible = !this.discovered.has(p.id);
      scene.add(g);
      this.markers.set(p.id, g);
    }
  }

  /** Cloud discoveries arrive silently: their rewards were already recorded. */
  restore(saved: string[]): void {
    for (const id of saved) {
      if (!this.markers.has(id)) continue;
      this.discovered.add(id);
      this.markers.get(id)!.visible = false;
    }
  }

  get total(): number {
    return this.w.pois.length;
  }

  update(dt: number, playerX: number, playerN: number, driving: boolean, playerY?: number): void {
    this.t += dt;
    for (const [id, m] of this.markers) {
      if (!m.visible) continue;
      const card = m.getObjectByName('card')!;
      card.rotation.y = this.t * 1.2;
      card.position.y = 2.75 + Math.sin(this.t * 2 + m.position.x) * 0.12;
      void id;
    }
    const radius = driving ? 30 : 18;
    for (const p of this.w.pois) {
      if (this.discovered.has(p.id)) continue;
      if (Math.hypot(p.x - playerX, p.n - playerN, playerY === undefined ? 0 : playerY - p.y) < radius) this.discover(p);
    }
  }

  private discover(p: POI): void {
    this.discovered.add(p.id);
    const m = this.markers.get(p.id);
    if (m) m.visible = false;
    bus.emit('poi:discovered', { id: p.id, name: p.name, total: this.total, found: this.discovered.size });
  }

  nearest(x: number, n: number): { poi: POI; dist: number } | null {
    let best: POI | null = null, bd = Infinity;
    for (const p of this.w.pois) {
      if (this.discovered.has(p.id)) continue;
      const d = Math.hypot(p.x - x, p.n - n);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { poi: best, dist: bd } : null;
  }
}
