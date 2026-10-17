import * as THREE from 'three';
import type { Road, WorldData } from './WorldData';
import { paintedMaterial } from '../render/PaintedMaterial';
import { daylightAt, daylightForHour } from './DayNight';
import type { Renderer } from '../engine/Renderer';
import type { Sky } from './Sky';

export interface StreetLamp { x: number; n: number; y: number; dx: number; dn: number; road: string; town: string; block: string; side: number }
const VGB_MAIN = new Set(['Avenida Ojo de Agua', 'Avenida San Martín', 'Avenida Julio Argentino Roca', 'Avenida Las Magnolias', 'Avenida Comechingones', 'Avenida Champaquí']);
function townFor(w: WorldData, road: Road, x: number, n: number): string | null {
  const town = w.meta.towns.find((t) => Math.hypot(x - t.x, n - t.n) <= t.r && (
    t.id === 'vgb' ? VGB_MAIN.has(road.name) : t.id === 'vcp' ? road.name === 'Boulevard Los Reartes' : t.id === 'lr' && road.name === 'Avenida San Martín'));
  return town?.id ?? null;
}
/** Split named avenues at mapped junctions, placing lamps at 1/4 and 3/4 of each block, on both sides. */
export function planStreetLamps(w: WorldData): StreetLamp[] {
  const result: StreetLamp[] = [];
  const occupied = new Set<string>();
  for (const road of w.roads) {
    if (road.bridge || (!VGB_MAIN.has(road.name) && road.name !== 'Boulevard Los Reartes')) continue;
    const segments: { x: number; n: number; dx: number; dn: number; length: number; station: number }[] = [];
    let length = 0;
    for (let i = 3; i < road.p.length; i += 3) {
      const dx = road.p[i] - road.p[i - 3], dn = road.p[i + 1] - road.p[i - 2], len = Math.hypot(dx, dn);
      if (len < .01) continue;
      segments.push({ x: road.p[i - 3], n: road.p[i - 2], dx: dx / len, dn: dn / len, length: len, station: length }); length += len;
    }
    if (length < 18) continue;
    const cuts = [0, length];
    for (const [x, n] of w.junctions) {
      let best = Infinity, station = 0;
      for (const s of segments) {
        const along = Math.max(0, Math.min(s.length, (x - s.x) * s.dx + (n - s.n) * s.dn));
        const distance = Math.hypot(x - s.x - s.dx * along, n - s.n - s.dn * along);
        if (distance < best) { best = distance; station = s.station + along; }
      }
      if (best < road.width / 2 + 1 && station > 12 && station < length - 12) cuts.push(station);
    }
    cuts.sort((a, b) => a - b);
    const unique = cuts.filter((s, i) => !i || s - cuts[i - 1] > 12);
    for (let b = 1; b < unique.length; b++) {
      const start = unique[b - 1], span = unique[b] - start;
      if (span < 18) continue;
      for (const fraction of [.25, .75]) {
        const station = start + span * fraction;
        const s = segments.find((s) => station <= s.station + s.length)!;
        const x = s.x + s.dx * (station - s.station), n = s.n + s.dn * (station - s.station);
        const town = townFor(w, road, x, n);
        if (!town) continue;
        for (const side of [-1, 1]) {
          const offset = road.width / 2 + 1.3;
          const px = x - s.dn * side * offset, pn = n + s.dx * side * offset;
          const key = `${Math.round(px / 3)},${Math.round(pn / 3)}`;
          if (occupied.has(key)) continue;
          occupied.add(key);
          result.push({ x: px, n: pn, y: w.heightAt(px, pn) + .17, dx: s.dn * side, dn: -s.dx * side, town, road: road.name, block: `${road.id}:${b}`, side });
        }
      }
    }
  }
  return result;
}

/** Instanced fixtures across the map; a small fixed pool lights nearby streets/facades on mobile. */
export class StreetLighting {
  readonly lamps: StreetLamp[];
  private bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xe8d7a6 });
  private lights: THREE.PointLight[] = [];
  private seconds = -1;
  private nextSelection = 0;
  private night = 0;
  private positions: THREE.Vector3[];
  private selected: { index: number; distance: number }[] = [];
  private forcedHour: number | null = null;

  constructor(private w: WorldData, scene: THREE.Scene, private renderer: Renderer, private sky: Sky, lowQuality: boolean) {
    this.lamps = planStreetLamps(w);
    this.positions = this.lamps.map((p) => new THREE.Vector3(p.x + p.dx * 1.35, p.y + 5.9, -(p.n + p.dn * 1.35)));
    // QA override exists only in local development; production always uses GMT−3.
    if (import.meta.env.DEV) {
      const override = new URLSearchParams(location.search).get('hora');
      if (override !== null && Number.isFinite(Number(override))) this.forcedHour = Number(override);
    }
    const metal = paintedMaterial({ color: 0x38433d, brushAmount: .06 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(.075, .12, 5.9, 6), metal, this.lamps.length);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, .09, .09), metal, this.lamps.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(.65, .15, .38), metal, this.lamps.length);
    const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(.5, .06, .3), this.bulbMaterial, this.lamps.length);
    pole.name = 'Luminarias de avenidas'; bulbs.name = 'Luces de calle';
    const dummy = new THREE.Object3D();
    this.lamps.forEach((p, i) => {
      dummy.position.set(p.x, p.y + 2.95, -p.n); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pole.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + p.dx * .75, p.y + 5.9, -(p.n + p.dn * .75)); dummy.rotation.y = Math.atan2(p.dn, p.dx); dummy.updateMatrix(); arm.setMatrixAt(i, dummy.matrix);
      dummy.position.copy(this.positions[i]); dummy.updateMatrix(); head.setMatrixAt(i, dummy.matrix);
      dummy.position.y -= .11; dummy.updateMatrix(); bulbs.setMatrixAt(i, dummy.matrix);
    });
    scene.add(pole, arm, head, bulbs);
    for (let i = 0; i < (lowQuality ? 4 : 8); i++) {
      const light = new THREE.PointLight(0xffc678, 0, 38, 2);
      light.castShadow = false;
      this.lights.push(light); scene.add(light);
    }
    this.update(new THREE.Vector3());
  }

  update(camera: THREE.Vector3): void {
    const now = Date.now(), second = Math.floor(now / 1000);
    if (second !== this.seconds) {
      this.seconds = second;
      const time = this.forcedHour === null ? daylightAt(new Date(now), this.w.meta.origin.lat, this.w.meta.origin.lon) : daylightForHour(this.forcedHour, new Date(now), this.w.meta.origin.lat, this.w.meta.origin.lon);
      this.night = time.night;
      this.renderer.setDaylight(time);
      this.sky.setDaylight(time);
      this.bulbMaterial.color.set(time.night > .05 ? 0xffe1a0 : 0xb8b4a1);
    }
    if (now > this.nextSelection) {
      this.nextSelection = now + 250;
      this.selected = this.positions.map((p, index) => ({ index, distance: p.distanceToSquared(camera) })).sort((a, b) => a.distance - b.distance).slice(0, this.lights.length);
    }
    this.lights.forEach((light, i) => {
      const p = this.selected[i];
      if (p) light.position.copy(this.positions[p.index]);
      // Fade the finite pool in/out at range, avoiding hard light pops.
      const fade = p ? Math.max(0, Math.min(1, (100 - Math.sqrt(p.distance)) / 35)) : 0;
      light.intensity = 170 * this.night * fade;
    });
  }
}
