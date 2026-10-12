import * as THREE from 'three';
import { InputState } from '../engine/Input';
import { WorldData } from '../world/WorldData';

/** Vistas que se recorren con C (o el botón "Cámara"). */
export const VIEWS = [
  { id: 'alta', label: 'Persecución alta' },
  { id: 'baja', label: 'Persecución baja' },
  { id: 'primera', label: 'Primera persona' },
  { id: 'aereaCerca', label: 'Aérea cerca' },
  { id: 'aereaLejos', label: 'Aérea lejos' },
] as const;
export type ViewId = (typeof VIEWS)[number]['id'];

type Mode = 'driving' | 'onfoot' | 'flying';

/** Altura de las vistas aéreas sobre el jugador (estilo GTA 1: mirando derecho hacia abajo, norte arriba). */
const AERIAL = { aereaCerca: 48, aereaLejos: 130 };

/** Para la primera persona dentro de un vehículo: dónde están los ojos (coordenadas locales, X adelante). */
export interface CockpitView {
  quat: THREE.Quaternion;
  eye: THREE.Vector3;
  /** La avioneta inclina la cámara con el alabeo; el auto mantiene el horizonte. */
  roll: boolean;
}

/**
 * Cámaras: persecución alta (como la referencia), persecución baja,
 * primera persona (asiento del auto, cabina de la avioneta o a la altura de los ojos)
 * y dos vistas aéreas cenitales.
 */
export class CameraRig {
  yaw = 0; // en Three: la cámara mira hacia (-sin yaw, -cos yaw)
  pitch = 0.42;
  private fpPitch = 0.05;
  private dist = 13;
  private height = 0;
  private orbitOffset = 0;
  private orbitTimer = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private first = true;
  private mode: Mode = 'driving';
  private zoomDrive = 1;
  private zoomFoot = 1;
  private zoomAerial = 1;
  private aerialSpeed = 0;
  private viewIndex = 0;
  /** Devuelve la distancia libre desde `from` hacia `to` (o null si no hay obstáculo). */
  occluder: ((from: THREE.Vector3, to: THREE.Vector3) => number | null) | null = null;
  private pivot = new THREE.Vector3();

  constructor(private cam: THREE.PerspectiveCamera, private w: WorldData) {}

  get view(): ViewId {
    return VIEWS[this.viewIndex].id;
  }

  get viewLabel(): string {
    return VIEWS[this.viewIndex].label;
  }

  get isFirstPerson(): boolean {
    return this.view === 'primera';
  }

  get isAerial(): boolean {
    return this.view === 'aereaCerca' || this.view === 'aereaLejos';
  }

  setMode(m: Mode): void {
    this.mode = m;
    if (m === 'onfoot') this.pitch = 0.32;
    this.fpPitch = 0.05;
    this.orbitOffset = 0;
    this.first = true;
  }

  cycleView(): string {
    this.viewIndex = (this.viewIndex + 1) % VIEWS.length;
    // a pie, la persecución baja no aporta: se salta
    if (this.mode === 'onfoot' && this.view === 'baja') this.viewIndex++;
    this.orbitOffset = 0;
    this.fpPitch = 0.05;
    this.first = true;
    return this.viewLabel;
  }

  setView(id: string): void {
    const i = VIEWS.findIndex((v) => v.id === id);
    if (i >= 0) { this.viewIndex = i; this.first = true; }
  }

  update(dt: number, target: THREE.Vector3, targetForward: THREE.Vector3, speed: number, input: InputState, cockpit?: CockpitView): void {
    this.setLens(this.isFirstPerson ? 0.05 : 0.5, this.isFirstPerson ? 68 : 55);
    if (this.isAerial) { this.updateAerial(dt, target, targetForward, speed, input); return; }
    if (this.isFirstPerson) { this.updateFirstPerson(dt, target, targetForward, input, cockpit); return; }
    this.cam.up.set(0, 1, 0);

    const k = 1 - Math.exp(-dt * 6);
    if (this.mode === 'driving' || this.mode === 'flying') {
      const flying = this.mode === 'flying';
      this.zoomDrive = THREE.MathUtils.clamp(this.zoomDrive + input.zoom * 0.08, 0.6, 1.8);
      // el usuario puede mirar alrededor; vuelve solo al rato
      if (input.lookX !== 0) { this.orbitOffset -= input.lookX * 0.005; this.orbitTimer = 1.5; }
      this.orbitTimer -= dt;
      if (this.orbitTimer < 0) this.orbitOffset *= Math.exp(-dt * 2.5);
      const carYaw = Math.atan2(-targetForward.x, -targetForward.z);
      let d = carYaw + this.orbitOffset - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * (2.2 + Math.min(Math.abs(speed), 25) * 0.08)));
      const high = this.view === 'alta';
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

  /** Primera persona: asiento del conductor, cabina del piloto o altura de los ojos a pie. */
  private updateFirstPerson(dt: number, target: THREE.Vector3, forward: THREE.Vector3, input: InputState, cockpit?: CockpitView): void {
    if (this.mode !== 'onfoot' && cockpit) {
      // mirar alrededor con el mouse/dedo; vuelve al frente solo
      if (input.lookX !== 0 || input.lookY !== 0) {
        this.orbitOffset = THREE.MathUtils.clamp(this.orbitOffset - input.lookX * 0.005, -2.4, 2.4);
        this.fpPitch = THREE.MathUtils.clamp(this.fpPitch + input.lookY * 0.003, -0.7, 0.8);
        this.orbitTimer = 1.5;
      }
      this.orbitTimer -= dt;
      if (this.orbitTimer < 0) {
        this.orbitOffset *= Math.exp(-dt * 3);
        this.fpPitch += (0.05 - this.fpPitch) * (1 - Math.exp(-dt * 3));
      }
      const eye = cockpit.eye.clone().applyQuaternion(cockpit.quat).add(target);
      let dir: THREE.Vector3;
      if (cockpit.roll) {
        // la avioneta: la vista sigue la actitud completa (cabeceo y alabeo)
        const local = new THREE.Vector3(1, 0, 0)
          .applyAxisAngle(new THREE.Vector3(0, 0, 1), -this.fpPitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitOffset);
        dir = local.applyQuaternion(cockpit.quat);
        this.cam.up.set(0, 1, 0).applyQuaternion(cockpit.quat);
      } else {
        // el auto: horizonte estable, acompañando la pendiente
        dir = forward.clone().setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitOffset);
        const slope = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
        const p = this.fpPitch - slope;
        dir.multiplyScalar(Math.cos(p)).setY(-Math.sin(p));
        this.cam.up.set(0, 1, 0);
      }
      this.cam.position.copy(eye);
      this.cam.lookAt(eye.clone().add(dir));
      const flat = dir.clone().setY(0);
      if (flat.lengthSq() > 1e-6) this.yaw = Math.atan2(-flat.x, -flat.z);
    } else {
      this.cam.up.set(0, 1, 0);
      this.yaw -= input.lookX * 0.005;
      this.fpPitch = THREE.MathUtils.clamp(this.fpPitch + input.lookY * 0.004, -1.3, 1.3);
      const eye = target.clone().add(new THREE.Vector3(0, 1.62, 0));
      const cp = Math.cos(this.fpPitch);
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * cp, -Math.sin(this.fpPitch), -Math.cos(this.yaw) * cp);
      this.cam.position.copy(eye);
      this.cam.lookAt(eye.clone().add(dir));
    }
    this.pos.copy(this.cam.position);
    this.first = true;
  }

  /** Vista cenital estilo GTA 1: norte arriba, se aleja un poco con la velocidad. */
  private updateAerial(dt: number, target: THREE.Vector3, forward: THREE.Vector3, speed: number, input: InputState): void {
    this.zoomAerial = THREE.MathUtils.clamp(this.zoomAerial + input.zoom * 0.08, 0.5, 2);
    const base = AERIAL[this.view as 'aereaCerca' | 'aereaLejos'] * this.zoomAerial;
    this.aerialSpeed += (Math.abs(speed) - this.aerialSpeed) * (1 - Math.exp(-dt * 1.5));
    const h = base + this.aerialSpeed * (this.view === 'aereaCerca' ? 0.9 : 1.4);
    // mirar un poco hacia donde se va
    const flat = new THREE.Vector3(forward.x, 0, forward.z);
    const ahead = Math.min(Math.abs(speed), 35) * 0.45 * Math.sign(speed || 1);
    const focus = target.clone();
    if (flat.lengthSq() > 1e-6) focus.add(flat.normalize().multiplyScalar(ahead));
    const desired = focus.clone().add(new THREE.Vector3(0, h, 0));
    if (this.first) { this.pos.copy(desired); this.first = false; }
    const k = 1 - Math.exp(-dt * 5);
    this.pos.x += (desired.x - this.pos.x) * k;
    this.pos.z += (desired.z - this.pos.z) * k;
    this.pos.y += (desired.y - this.pos.y) * (1 - Math.exp(-dt * 2));
    this.look.set(this.pos.x, focus.y, this.pos.z);
    this.cam.up.set(0, 0, -1); // norte (−Z) hacia arriba de la pantalla
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    // a pie, W mueve hacia el norte del mapa (como en el GTA original)
    if (this.mode === 'onfoot') this.yaw = 0;
  }

  private setLens(near: number, fov: number): void {
    if (this.cam.near !== near || this.cam.fov !== fov) {
      this.cam.near = near;
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
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
