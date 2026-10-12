import * as THREE from 'three';
import { RAPIER, type Physics } from '../engine/Physics';
import type { InputState } from '../engine/Input';
import type { WorldData } from '../world/WorldData';
import { paintedMaterial } from '../render/PaintedMaterial';
import { bus } from '../core/EventBus';

/** Vuelo asistido: acelera, gira y gana altura, sin exigir un simulador de aviación. */
export class Aircraft {
  readonly mesh: THREE.Group;
  active = false;
  speed = 0;
  throttleOut = 0;
  altitude = 0;
  grounded = true;

  private static readonly CLEARANCE = 1.08;
  private static readonly TAKEOFF_SPEED = 22;
  private static readonly TOP_SPEED = 64;
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();
  private readonly attitude = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly propeller = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private readonly hull = new RAPIER.Cuboid(3.15, 0.55, 0.62);
  private readonly wing = new RAPIER.Cuboid(0.72, 0.12, 5.2);
  private readonly queryStart = new THREE.Vector3();
  private readonly queryEnd = new THREE.Vector3();
  private readonly movement = new THREE.Vector3();
  private heading = 0;
  private pitch = 0;
  private bank = 0;
  private verticalSpeed = 0;
  private assistedClimb = false;
  private propellerAngle = 0;
  private wheelAngle = 0;

  constructor(
    private readonly world: WorldData,
    scene: THREE.Scene,
    private readonly physics: Physics,
    private readonly spawn: { x: number; n: number; heading: number },
  ) {
    this.mesh = this.buildModel();
    scene.add(this.mesh);
    this.reset();
  }

  /** Ojos del piloto en coordenadas de la avioneta (X hacia la hélice). */
  readonly pilotEye = new THREE.Vector3(0.5, 1.05, 0);

  /** Primera persona: solo la vista del piloto, sin dibujar la avioneta. */
  setCockpit(on: boolean): void {
    this.mesh.visible = !on;
  }

  get position(): THREE.Vector3 { return this.currPos; }
  get rotation(): THREE.Quaternion { return this.currRot; }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.currRot);
  }

  /** Cada salida y cada recuperación comienza en la cabecera del aeroclub de VGB. */
  reset(): void {
    this.currPos.set(this.spawn.x, this.world.heightAt(this.spawn.x, this.spawn.n) + Aircraft.CLEARANCE, -this.spawn.n);
    this.heading = this.spawn.heading;
    this.speed = this.throttleOut = this.altitude = this.verticalSpeed = 0;
    this.pitch = this.groundPitch(this.currPos.x, -this.currPos.z);
    this.bank = 0;
    this.assistedClimb = false;
    this.grounded = true;
    this.updateRotation();
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.mesh.position.copy(this.currPos);
    this.mesh.quaternion.copy(this.currRot);
  }

  fixedUpdate(dt: number, input: InputState | null): void {
    // El avión estacionado no avanza ni modifica el último estado del vuelo.
    if (!this.active || !input || dt <= 0) return;
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);

    const throttle = THREE.MathUtils.clamp(input.planeThrottle, 0, 1);
    const brake = THREE.MathUtils.clamp(input.planeBrake, 0, 1);
    const steer = THREE.MathUtils.clamp(input.steer, -1, 1);
    const pitchInput = THREE.MathUtils.clamp(input.pitch, -1, 1);
    // La potencia se conserva al soltar el acelerador para poder recorrer el valle cómodamente.
    this.throttleOut = THREE.MathUtils.clamp(this.throttleOut + (throttle * 0.65 - brake * 0.9) * dt, 0, 1);
    const drag = this.grounded ? 0.6 + this.speed * 0.045 : 0.6 + this.speed * 0.065;
    const acceleration = this.throttleOut * (this.grounded ? 7 : 5.8) - drag - brake * (this.grounded ? 11 : 6);
    this.speed = THREE.MathUtils.clamp(this.speed + acceleration * dt, 0, Aircraft.TOP_SPEED);

    const turnRate = this.grounded
      ? 0.65 * Math.min(1, this.speed / 8)
      : 0.42 * THREE.MathUtils.clamp(this.speed / 38, 0.25, 1.2);
    // +steer gira a la derecha; heading usa el mismo convenio x/n que el auto.
    this.heading -= steer * turnRate * dt;
    this.bank += ((this.grounded ? 0 : steer * 0.43) - this.bank) * Math.min(1, dt * 3.5);

    if (this.grounded && this.speed >= Aircraft.TAKEOFF_SPEED && brake === 0 && pitchInput >= 0
      && (pitchInput > 0 || (this.speed >= 25 && this.throttleOut > 0.55))) {
      this.grounded = false;
      this.verticalSpeed = 2.5;
      this.assistedClimb = pitchInput === 0;
      bus.emit('toast', { text: '¡Buen vuelo!', sub: '↓ sube la trompa · ↑ la baja · A/D o ←/→ para girar' });
    }

    const previousGround = this.world.heightAt(this.currPos.x, -this.currPos.z);
    this.currPos.x += Math.cos(this.heading) * this.speed * dt;
    this.currPos.z -= Math.sin(this.heading) * this.speed * dt;
    const ground = this.world.heightAt(this.currPos.x, -this.currPos.z);
    if (!this.grounded) {
      if (pitchInput !== 0 || this.altitude >= 35 || brake > 0) this.assistedClimb = false;
      const lift = THREE.MathUtils.clamp((this.speed - 14) / 14, 0, 1);
      let climb = pitchInput > 0 ? pitchInput * 10 * lift : pitchInput * 5;
      if (this.assistedClimb) climb = 4;
      // La falta de velocidad produce un descenso suave, recuperable al acelerar.
      if (this.speed < 18) climb -= (18 - this.speed) * 0.4;
      if (this.altitude > 700) climb = Math.min(0, climb);
      this.verticalSpeed += (climb - this.verticalSpeed) * Math.min(1, dt * 2.2);
      this.currPos.y += this.verticalSpeed * dt;
      const targetPitch = Math.atan2(this.verticalSpeed, Math.max(12, this.speed));
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 3);

      if (this.currPos.y <= ground + Aircraft.CLEARANCE) {
        const slope = Math.abs(ground - previousGround) / Math.max(0.01, this.speed * dt);
        const touchdownSpeed = this.verticalSpeed - (ground - previousGround) / dt;
        if (this.speed > 43 || touchdownSpeed < -6.5 || Math.abs(this.bank) > 0.32 || slope > 0.2) {
          this.recover('Aterrizaje brusco');
          return;
        }
        this.grounded = true;
        this.assistedClimb = false;
        this.verticalSpeed = 0;
      }
    }

    if (this.grounded) {
      this.currPos.y = ground + Aircraft.CLEARANCE;
      const groundPitch = this.groundPitch(this.currPos.x, -this.currPos.z);
      this.pitch += (groundPitch - this.pitch) * Math.min(1, dt * 7);
    }
    this.altitude = Math.max(0, this.currPos.y - ground - Aircraft.CLEARANCE);
    this.updateRotation();

    const bounds = this.world.meta.playArea;
    if (this.currPos.x < bounds.x0 + 8 || this.currPos.x > bounds.x1 - 8
      || -this.currPos.z < bounds.n0 + 8 || -this.currPos.z > bounds.n1 - 8) {
      this.recover('Llegaste al límite del recorrido');
      return;
    }
    // El relieve se resuelve arriba para permitir aterrizajes. Estas barridas detectan
    // casas, puentes y árboles sin chocar contra el auto o el personaje estacionados.
    if (this.hitsObstacle(this.hull, 0, 0.4) || this.hitsObstacle(this.wing, 0.25, 1.45)) {
      this.recover('La avioneta tocó un obstáculo');
    }
  }

  private groundPitch(x: number, n: number): number {
    const dx = Math.cos(this.heading) * 2.5, dn = Math.sin(this.heading) * 2.5;
    return Math.atan2(this.world.heightAt(x + dx, n + dn) - this.world.heightAt(x - dx, n - dn), 5);
  }

  private updateRotation(): void {
    this.attitude.set(this.bank, this.heading, this.pitch, 'YZX');
    this.currRot.setFromEuler(this.attitude);
  }

  private hitsObstacle(shape: RAPIER.Shape, localX: number, localY: number): boolean {
    this.queryStart.set(localX, localY, 0).applyQuaternion(this.prevRot).add(this.prevPos);
    this.queryEnd.set(localX, localY, 0).applyQuaternion(this.currRot).add(this.currPos);
    this.movement.subVectors(this.queryEnd, this.queryStart);
    return !!this.physics.world.castShape(
      this.queryStart, this.currRot, this.movement, shape, 0.02, 1, true,
      RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, undefined, undefined,
      (collider) => collider.shapeType() !== RAPIER.ShapeType.HeightField,
    );
  }

  private recover(reason: string): void {
    this.reset();
    bus.emit('toast', { text: reason, sub: 'Volvimos a la pista del Aeroclub de Villa General Belgrano.' });
  }

  render(alpha: number, dt: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    const spinning = this.active ? 12 + this.throttleOut * 95 : 0;
    this.propellerAngle = (this.propellerAngle + spinning * dt) % (Math.PI * 2);
    this.propeller.rotation.x = this.propellerAngle;
    if (this.grounded && this.active) this.wheelAngle -= this.speed / 0.31 * dt;
    for (const wheel of this.wheels) wheel.rotation.z = this.wheelAngle;
  }

  private buildModel(): THREE.Group {
    const group = new THREE.Group();
    const ivory = paintedMaterial({ color: 0xf3ebd2, brushScale: 1.5, brushAmount: 0.12, rim: 0.3 });
    const red = paintedMaterial({ color: 0xb94431, brushScale: 1.8, brushAmount: 0.13, rim: 0.25 });
    const glass = paintedMaterial({ color: 0x426776, brushAmount: 0.07, rim: 0.5 });
    const metal = paintedMaterial({ color: 0x92978f, brushAmount: 0.08 });
    const rubber = paintedMaterial({ color: 0x282a28, brushAmount: 0.1 });
    const box = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const strut = (from: THREE.Vector3, to: THREE.Vector3, radius: number) => {
      const delta = to.clone().sub(from);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), metal);
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      mesh.castShadow = true;
      group.add(mesh);
    };

    // Fuselaje afinado hacia la cola, con el eje X apuntando a la hélice.
    const fuselageGeometry = new THREE.CylinderGeometry(0.6, 0.2, 5.5, 8);
    fuselageGeometry.rotateZ(-Math.PI / 2);
    const fuselage = new THREE.Mesh(fuselageGeometry, ivory);
    fuselage.scale.y = 0.86;
    fuselage.position.set(-0.35, 0.35, 0);
    fuselage.castShadow = fuselage.receiveShadow = true;
    group.add(fuselage);
    box(2.0, 0.72, 1.05, ivory, 0.45, 0.78, 0);
    box(1.58, 0.5, 1.07, glass, 0.47, 0.95, 0);
    box(0.12, 0.6, 1.11, ivory, 0.22, 0.93, 0);
    box(2.1, 0.12, 1.16, ivory, 0.45, 1.3, 0);
    box(4.8, 0.13, 0.04, red, -0.14, 0.36, 0.53);
    box(4.8, 0.13, 0.04, red, -0.14, 0.36, -0.53);

    // Ala alta, puntas rojas y montantes: silueta reconocible desde la cámara trasera.
    box(1.75, 0.16, 10.8, ivory, 0.2, 1.45, 0);
    box(0.35, 0.18, 10.7, red, 0.92, 1.45, 0);
    for (const side of [-1, 1]) {
      box(1.76, 0.18, 0.8, red, 0.2, 1.45, side * 5.05);
      strut(new THREE.Vector3(0.3, -0.12, side * 0.45), new THREE.Vector3(0.1, 1.36, side * 3.6), 0.035);
      strut(new THREE.Vector3(-0.65, -0.05, side * 0.4), new THREE.Vector3(-0.2, -0.71, side * 1.05), 0.045);
    }
    box(1.22, 0.12, 3.45, ivory, -2.95, 0.68, 0);
    box(0.33, 0.14, 3.5, red, -3.4, 0.68, 0);
    const tail = box(1.05, 1.38, 0.13, red, -2.95, 1.05, 0);
    tail.rotation.z = -0.18;
    box(0.64, 0.26, 0.15, ivory, -2.87, 1.65, 0);

    // Tren triciclo: las ruedas quedan a cuatro centímetros de la superficie de pista.
    const wheelGeometry = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 12);
    wheelGeometry.rotateX(Math.PI / 2);
    for (const [x, z] of [[-0.2, 1.05], [-0.2, -1.05], [1.96, 0]]) {
      const wheel = new THREE.Mesh(wheelGeometry, rubber);
      wheel.position.set(x, -0.73, z);
      wheel.castShadow = true;
      group.add(wheel);
      this.wheels.push(wheel);
    }
    strut(new THREE.Vector3(1.96, 0.17, 0), new THREE.Vector3(1.96, -0.71, 0), 0.055);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 12), red);
    spinner.rotation.z = -Math.PI / 2;
    spinner.position.set(2.7, 0.35, 0);
    group.add(spinner);
    this.propeller.position.set(2.48, 0.35, 0);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.65, 0.16), rubber);
    this.propeller.add(blade);
    group.add(this.propeller);
    group.name = 'Avioneta del Aeroclub de Villa General Belgrano';
    return group;
  }
}
