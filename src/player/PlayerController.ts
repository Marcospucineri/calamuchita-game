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
    return this.flying ? 'plane' : 'car';
  }

  /** Cada salida en avioneta empieza en la pista; el auto conserva su posición. */
  selectVehicle(vehicle: VehicleChoice): void {
    this.timer = 0;
    this.person.despawn();
    this.car.occupied = vehicle === 'car';
    this.plane.active = vehicle === 'plane';
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
    return this.mode === 'driving' && Math.abs(this.car.speed) < 2.5;
  }

  canEnter(): boolean {
    if (this.mode !== 'onfoot') return false;
    return this.person.position.distanceTo(this.car.doorPoint()) < 3.2 || this.person.position.distanceTo(this.car.position) < 3.4;
  }

  /** Acciones de un solo disparo (se leen una vez por frame). */
  handleActions(input: InputState): void {
    if (input.interactPressed) {
      if (this.canExit()) this.exitCar();
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
