import * as THREE from 'three';
import { InputState } from '../engine/Input';
import { WorldData } from '../world/WorldData';

/**
 * Cámara elevada de persecución (como la referencia) para manejar
 * y cámara en tercera persona orbitable para caminar.
 */
export class CameraRig {
  yaw = 0; // en Three: la cámara mira hacia (-sin yaw, -cos yaw)
  pitch = 0.42;
  private dist = 13;
  private height = 0;
  private orbitOffset = 0;
  private orbitTimer = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private first = true;
  private mode: 'driving' | 'onfoot' | 'flying' = 'driving';
  private zoomDrive = 1;
  private zoomFoot = 1;
  private viewDrive = 0; // 0: elevada, 1: baja/cercana
  /** Devuelve la distancia libre desde `from` hacia `to` (o null si no hay obstáculo). */
  occluder: ((from: THREE.Vector3, to: THREE.Vector3) => number | null) | null = null;
  private pivot = new THREE.Vector3();

  constructor(private cam: THREE.PerspectiveCamera, private w: WorldData) {}

  setMode(m: 'driving' | 'onfoot' | 'flying'): void {
    this.mode = m;
    if (m === 'onfoot') this.pitch = 0.32;
  }

  cycleView(): void {
    this.viewDrive = (this.viewDrive + 1) % 2;
  }

  update(dt: number, target: THREE.Vector3, targetForward: THREE.Vector3, speed: number, input: InputState): void {
    const k = 1 - Math.exp(-dt * 6);
    if (this.mode === 'driving' || this.mode === 'flying') {
      const flying = this.mode === 'flying';
      this.zoomDrive = THREE.MathUtils.clamp(this.zoomDrive + input.zoom * 0.08, 0.6, 1.8);
      // el usuario puede mirar alrededor; vuelve solo al rato
      if (input.lookX !== 0) { this.orbitOffset -= input.lookX * 0.005; this.orbitTimer = 1.5; }
      this.orbitTimer -= dt;
      if (this.orbitTimer < 0) this.orbitOffset *= Math.exp(-dt * 2.5);
      const carYaw = Math.atan2(-targetForward.x, -targetForward.z);
      // con marcha atrás no damos vuelta la cámara
      let d = carYaw + this.orbitOffset - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * (2.2 + Math.min(Math.abs(speed), 25) * 0.08)));
      const high = this.viewDrive === 0;
      this.dist = (flying ? (high ? 27 : 17) : (high ? 13.5 : 8.5)) * this.zoomDrive + Math.min(Math.abs(speed), 60) * 0.06;
      this.height = (flying ? (high ? 10 : 4) : (high ? 7.2 : 3.0)) * this.zoomDrive;
      const lookAhead = flying ? 14 : Math.min(Math.abs(speed), 30) * 0.12 + 2.5;
      const desired = new THREE.Vector3(Math.sin(this.yaw) * this.dist, this.height, Math.cos(this.yaw) * this.dist).add(target);
      const lookAt = new THREE.Vector3(-Math.sin(this.yaw) * lookAhead, 1.2, -Math.cos(this.yaw) * lookAhead).add(target);
      this.pivot.copy(target).add(new THREE.Vector3(0, 2.2, 0));
      this.apply(desired, lookAt, k);
    } else {
      this.zoomFoot = THREE.MathUtils.clamp(this.zoomFoot + input.zoom * 0.1, 0.5, 2.2);
      this.yaw -= input.lookX * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY * 0.004, -0.15, 1.2);
      this.dist = 5.5 * this.zoomFoot;
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const head = target.clone().add(new THREE.Vector3(0, 1.6, 0));
      const desired = new THREE.Vector3(Math.sin(this.yaw) * cp * this.dist, sp * this.dist, Math.cos(this.yaw) * cp * this.dist).add(head);
      this.pivot.copy(head);
      this.apply(desired, head, 1 - Math.exp(-dt * 12));
    }
  }

  private apply(desired: THREE.Vector3, lookAt: THREE.Vector3, k: number): void {
    // si una casa o un árbol tapa la vista, acercar la cámara
    if (this.occluder) {
      const free = this.occluder(this.pivot, desired);
      if (free !== null) {
        const dir = desired.clone().sub(this.pivot);
        const len = dir.length();
        desired.copy(this.pivot).addScaledVector(dir.normalize(), Math.max(1.5, free - 0.6));
        if (len - free > 2) k = Math.max(k, 0.5);
      }
    }
    // nunca debajo del terreno
    const g = this.w.heightAtXZ(desired.x, desired.z) + 1.2;
    if (desired.y < g) desired.y = g;
    if (this.first || this.pos.distanceToSquared(desired) > 150 * 150) { this.pos.copy(desired); this.look.copy(lookAt); this.first = false; }
    this.pos.lerp(desired, k);
    this.look.lerp(lookAt, Math.min(1, k * 1.6));
    const g2 = this.w.heightAtXZ(this.pos.x, this.pos.z) + 1.0;
    if (this.pos.y < g2) this.pos.y = g2;
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
  }

  snap(): void {
    this.first = true;
  }
}
