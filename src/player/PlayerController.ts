import * as THREE from 'three';
import { bus } from '../core/EventBus';
import { InputState } from '../engine/Input';
import { Physics } from '../engine/Physics';
import { WorldData } from '../world/WorldData';
import { Character } from './Character';
import { Vehicle } from './Vehicle';
import { Aircraft } from './Aircraft';

export type Mode = 'driving' | 'onfoot' | 'entering' | 'exiting' | 'flying';
export type VehicleChoice = 'car' | 'plane';

/** Máquina de estados: a pie ↔ manejando, con una transición corta. */
export class PlayerController {
  mode: Mode = 'driving';
  private timer = 0;
  private selected: VehicleChoice = 'car';

  constructor(readonly car: Vehicle, readonly person: Character, private physics: Physics, private w: WorldData, readonly plane: Aircraft) {
    car.occupied = true;
  }

  get driving(): boolean {
    return this.mode === 'driving' || this.mode === 'entering';
  }

  get flying(): boolean {
    return this.mode === 'flying';
  }

  get vehicle(): VehicleChoice {
    return this.selected;
  }

  /** Cada salida en avioneta empieza en la pista; el auto conserva su posición. */
  selectVehicle(vehicle: VehicleChoice): void {
    this.timer = 0; this.selected = vehicle;
    this.person.despawn();
    this.car.occupied = vehicle === 'car';
    this.plane.active = vehicle === 'plane';
    this.plane.occupied = vehicle === 'plane';
    this.plane.reset();
    if (vehicle === 'car') {
      const f = this.car.forward();
      const pos = this.car.position;
      this.car.place(pos.x, -pos.z, Math.atan2(-f.z, f.x));
    }
    this.mode = vehicle === 'plane' ? 'flying' : 'driving';
    bus.emit('player:mode', { mode: this.mode });
  }

  /** Posición "del jugador" (auto o persona) en Three. */
  get position(): THREE.Vector3 {
    if (this.flying) return this.plane.position;
    return this.mode === 'onfoot' || this.mode === 'exiting' ? this.person.position : this.car.position;
  }

  canExit(): boolean {
    return this.flying || this.mode === 'driving' && Math.abs(this.car.speed) < 2.5;
  }

  private nearbyVehicle(): VehicleChoice | null {
    if (this.mode !== 'onfoot' || this.person.airborne) return null;
    const carDistance = Math.min(this.person.position.distanceTo(this.car.doorPoint()), this.person.position.distanceTo(this.car.position));
    const planeDistance = this.person.position.distanceTo(this.plane.position);
    if (this.plane.grounded && planeDistance < 8 && (carDistance >= 3.4 || planeDistance / 2 < carDistance)) return 'plane';
    return carDistance < 3.4 ? 'car' : null;
  }

  canEnter(): boolean { return this.nearbyVehicle() !== null; }

  get action(): { label: string; short: string } | null {
    if (this.person.airState === 'freefall') return { label: 'Abrir paracaídas', short: 'Abrir paracaídas' };
    if (this.flying) return this.plane.grounded ? { label: 'Bajarse de la avioneta', short: 'Bajar' } : { label: 'Saltar de la avioneta', short: 'Saltar' };
    if (this.canExit()) return { label: 'Bajarse del auto', short: 'Bajar' };
    const nearby = this.nearbyVehicle();
    return nearby ? { label: nearby === 'plane' ? 'Subir a la avioneta' : 'Subir al auto', short: nearby === 'plane' ? 'Subir a avioneta' : 'Subir' } : null;
  }

  restoreOnFoot(position: THREE.Vector3, vehicle: VehicleChoice): void {
    this.selected = vehicle; this.mode = 'onfoot'; this.timer = 0;
    this.car.occupied = false; this.plane.occupied = false; this.plane.active = false;
    this.person.spawn(position, 0);
  }

  private exitPlane(): void {
    const plane = this.plane;
    const inAir = !plane.grounded;
    const forward = plane.forward();
    const spot = new THREE.Vector3(inAir ? -4 : .2, 0, -6.4).applyQuaternion(plane.rotation).add(plane.position);
    if (inAir) spot.y = Math.max(spot.y, this.w.heightAtXZ(spot.x, spot.z) + .25);
    if (!inAir) spot.y = this.physics.castDown(spot.x, spot.z, plane.position.y + 4, 20) ?? this.w.heightAtXZ(spot.x, spot.z);
    this.car.occupied = false;
    this.person.spawn(spot, Math.atan2(forward.x, forward.z));
    if (inAir) this.person.startFalling({ x: forward.x * plane.speed, y: Math.min(-2, forward.y * plane.speed), z: forward.z * plane.speed });
    plane.release();
    this.mode = 'onfoot'; this.timer = 0;
    bus.emit('player:mode', { mode: 'onfoot' });
  }

  private enterPlane(): void {
    this.person.despawn(); this.car.occupied = false;
    this.plane.active = this.plane.occupied = true;
    this.selected = 'plane'; this.mode = 'flying';
    bus.emit('player:mode', { mode: 'flying' });
  }

  /** Acciones de un solo disparo (se leen una vez por frame). */
  handleActions(input: InputState): void {
    if (input.interactPressed) {
      if (this.person.airState === 'freefall') this.person.openParachute();
      else if (this.flying) this.exitPlane();
      else if (this.canExit()) this.exitCar();
      else if (this.nearbyVehicle() === 'plane') this.enterPlane();
      else if (this.canEnter()) this.enterCar();
    }
    if (input.resetPressed && this.mode === 'driving') this.car.reset();
    if (input.resetPressed && this.flying) this.plane.reset();
  }

  private exitCar(): void {
    // buscar un lugar libre al costado del conductor; si no, del otro lado o atrás
    const q = this.car.rotation;
    const candidates = [new THREE.Vector3(-0.2, 0, -2.0), new THREE.Vector3(-0.2, 0, 2.0), new THREE.Vector3(-3.4, 0, 0), new THREE.Vector3(3.4, 0, 0)];
    let spot = candidates[0].clone().applyQuaternion(q).add(this.car.position);
    for (const c of candidates) {
      const p = c.clone().applyQuaternion(q).add(this.car.position);
      const ground = this.physics.castDown(p.x, p.z, p.y + 3, 8);
      const g = ground ?? this.w.heightAtXZ(p.x, p.z);
      if (Math.abs(g - this.car.position.y) < 2.5) { spot = p.setY(g); break; }
    }
    const f = this.car.forward();
    this.car.occupied = false;
    this.person.spawn(spot, Math.atan2(f.x, f.z));
    this.mode = 'exiting';
    this.timer = 0.35;
    bus.emit('player:mode', { mode: 'onfoot' });
  }

  private enterCar(): void {
    this.selected = 'car';
    this.person.despawn();
    this.car.occupied = true;
    this.mode = 'entering';
    this.timer = 0.3;
    bus.emit('player:mode', { mode: 'driving' });
  }

  fixedUpdate(dt: number, input: InputState, camYaw: number): void {
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.mode = this.mode === 'entering' ? 'driving' : this.mode === 'exiting' ? 'onfoot' : this.mode;
    }
    this.car.fixedUpdate(dt, this.mode === 'driving' ? input : null);
    this.plane.fixedUpdate(dt, this.flying ? input : null);
    if (this.mode === 'onfoot' || this.mode === 'exiting') this.person.fixedUpdate(dt, this.mode === 'onfoot' ? input : { ...input, moveX: 0, moveY: 0, jump: false }, camYaw);
  }

  postStep(): void {
    this.car.postStep();
    this.person.postStep();
  }
}
