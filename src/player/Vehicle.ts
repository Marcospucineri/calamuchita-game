import * as THREE from 'three';
import { Physics, RAPIER } from '../engine/Physics';
import { InputState } from '../engine/Input';
import { paintedMaterial } from '../render/PaintedMaterial';
import { WorldData } from '../world/WorldData';

/** Parámetros del auto (sedán clásico argentino genérico). */
export const SEDAN = {
  mass: 1150,
  halfExtents: { x: 2.25, y: 0.42, z: 0.86 }, // X = adelante
  wheelRadius: 0.36,
  suspensionRest: 0.32,
  suspensionStiffness: 32,
  suspensionCompression: 2.6,
  suspensionRelaxation: 3.2,
  maxSuspensionForce: 120000,
  maxSuspensionTravel: 0.28,
  engineForce: 5600,
  reverseForce: 1500,
  brakeForce: 32,
  topSpeed: 41, // m/s ≈ 148 km/h
  maxSteer: 0.6,
};

/** Agarre por superficie: el ripio y la tierra se sienten distintos al asfalto. */
const GRIP: Record<string, { slip: number; speed: number; rough: number }> = {
  asphalt: { slip: 2.6, speed: 1.0, rough: 0 },
  paving: { slip: 2.3, speed: 0.85, rough: 0.25 },
  compacted: { slip: 1.9, speed: 0.85, rough: 0.35 },
  gravel: { slip: 1.45, speed: 0.72, rough: 0.6 },
  dirt: { slip: 1.25, speed: 0.6, rough: 0.7 },
  grass: { slip: 1.05, speed: 0.5, rough: 0.8 },
  water: { slip: 0.8, speed: 0.3, rough: 0.5 },
};

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly mesh: THREE.Group;
  private wheels: THREE.Object3D[] = [];
  private steer = 0;
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private currRot = new THREE.Quaternion();
  surface = 'asphalt';
  speed = 0; // m/s con signo (adelante +)
  throttleOut = 0;
  rough = 0;
  occupied = false;
  private upsideTimer = 0;

  constructor(physics: Physics, private w: WorldData, scene: THREE.Scene, pos: THREE.Vector3, heading: number) {
    const c = SEDAN;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(0.08)
        .setAngularDamping(0.9)
        .setCanSleep(true),
    );
    const vol = 8 * c.halfExtents.x * c.halfExtents.y * c.halfExtents.z;
    // colisor algo más alto que el centro de masa → auto más estable
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z).setTranslation(0, 0.25, 0).setDensity(c.mass / vol).setFriction(0.6).setRestitution(0.05),
      this.body,
    );
    const cabin = RAPIER.ColliderDesc.cuboid(1.15, 0.32, 0.78).setTranslation(-0.2, 0.95, 0).setDensity(1);
    physics.world.createCollider(cabin, this.body);

    this.controller = physics.world.createVehicleController(this.body);
    const wx = 1.38, wz = 0.78, wy = -0.05;
    for (const [x, z] of [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]]) {
      this.controller.addWheel({ x, y: wy, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, c.suspensionRest, c.wheelRadius);
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, c.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, c.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, c.suspensionRelaxation);
      this.controller.setWheelMaxSuspensionForce(i, c.maxSuspensionForce);
      this.controller.setWheelMaxSuspensionTravel(i, c.maxSuspensionTravel);
      this.controller.setWheelFrictionSlip(i, GRIP.asphalt.slip);
      this.controller.setWheelSideFrictionStiffness(i, 1.0);
    }

    this.mesh = this.buildModel();
    scene.add(this.mesh);
    this.snapshot();
    this.snapshot();
  }

  private buildModel(): THREE.Group {
    const g = new THREE.Group();
    const paint = paintedMaterial({ color: 0xeee2bd, brushScale: 1.6, brushAmount: 0.12, rim: 0.35 });
    const chrome = paintedMaterial({ color: 0xd8d8d0, brushScale: 2, brushAmount: 0.1, rim: 0.4 });
    const glass = paintedMaterial({ color: 0x3a4f5c, brushScale: 2, brushAmount: 0.08, rim: 0.6 });
    const dark = paintedMaterial({ color: 0x2a2a2a, brushScale: 2, brushAmount: 0.1 });
    const tire = paintedMaterial({ color: 0x222020, brushScale: 3, brushAmount: 0.1 });
    const red = paintedMaterial({ color: 0xb02a20 });
    const yellow = paintedMaterial({ color: 0xffe9a8, emissive: 0x332a10 });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // carrocería de tres volúmenes
    box(4.5, 0.62, 1.74, paint, 0, 0.28, 0);
    box(4.42, 0.12, 1.66, paint, 0.02, 0.64, 0);
    // cabina
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 4, 1), paint);
    cab.rotation.y = Math.PI / 4;
    cab.scale.set(1.55, 0.58, 1.12);
    const cabGeo = new THREE.BoxGeometry(2.1, 0.62, 1.52);
    const cp = cabGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) cp.setX(i, cp.getX(i) * 0.78 - 0.08);
    cabGeo.computeVertexNormals();
    const cabin = new THREE.Mesh(cabGeo, paint);
    cabin.position.set(-0.25, 0.99, 0);
    cabin.castShadow = true;
    g.add(cabin);
    // vidrios
    const winGeo = cabGeo.clone();
    winGeo.scale(1.01, 0.72, 1.01);
    const win = new THREE.Mesh(winGeo, glass);
    win.position.set(-0.25, 0.99, 0);
    g.add(win);
    box(2.0, 0.06, 1.42, paint, -0.25, 1.31, 0); // techo
    // paragolpes, parrilla, faros
    box(0.16, 0.18, 1.8, chrome, 2.3, 0.15, 0);
    box(0.16, 0.18, 1.8, chrome, -2.3, 0.15, 0);
    box(0.06, 0.28, 1.1, dark, 2.27, 0.42, 0);
    for (const z of [0.66, -0.66]) {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12), yellow);
      head.rotation.z = Math.PI / 2;
      head.position.set(2.27, 0.42, z);
      g.add(head);
      box(0.06, 0.16, 0.34, red, -2.27, 0.44, z * 0.95);
    }
    box(0.03, 0.03, 1.76, chrome, 0, 0.42, 0); // moldura lateral (se ve como línea)
    // ruedas
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16);
    wheelGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10);
    hubGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const wg = new THREE.Group();
      const t = new THREE.Mesh(wheelGeo, tire);
      t.castShadow = true;
      wg.add(t);
      wg.add(new THREE.Mesh(hubGeo, chrome));
      g.add(wg);
      this.wheels.push(wg);
    }
    return g;
  }

  private snapshot(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    const t = this.body.translation(), r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.currRot);
  }

  get position(): THREE.Vector3 {
    return this.currPos;
  }

  get rotation(): THREE.Quaternion {
    return this.currRot;
  }

  fixedUpdate(dt: number, input: InputState | null): void {
    const c = SEDAN;
    const lv = this.body.linvel();
    const fwd = this.forward();
    this.speed = lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z;

    // superficie bajo el auto
    const p = this.currPos;
    const s = this.w.surfaceAt(p.x, -p.z);
    this.surface = s.surface;
    const grip = GRIP[s.surface] ?? GRIP.grass;
    this.rough = grip.rough;

    let engine = 0, brake = 0, steerTarget = 0;
    if (input && this.occupied) {
      this.body.wakeUp();
      const v = this.speed;
      const top = c.topSpeed * grip.speed;
      if (input.throttle > 0) {
        if (v < -0.5) brake = c.brakeForce * input.throttle;
        else engine = c.engineForce * input.throttle * Math.max(0, 1 - Math.max(0, v) / top);
      }
      if (input.brake > 0) {
        if (v > 0.8) brake = c.brakeForce * input.brake;
        else engine = -c.reverseForce * input.brake * Math.max(0, 1 - Math.max(0, -v) / 8);
      }
      if (input.handbrake) brake = Math.max(brake, c.brakeForce * 0.6);
      // menos dirección a alta velocidad
      const steerLimit = c.maxSteer * THREE.MathUtils.lerp(1, 0.28, Math.min(1, Math.abs(v) / 32));
      steerTarget = -input.steer * steerLimit;
      this.throttleOut = input.throttle;
    } else {
      brake = c.brakeForce * 0.3; // freno de mano puesto
      this.throttleOut = 0;
    }
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 7);

    for (let i = 0; i < 4; i++) {
      this.controller.setWheelFrictionSlip(i, grip.slip * (input?.handbrake && i >= 2 ? 0.55 : 1));
      this.controller.setWheelBrake(i, brake * (i < 2 ? 0.6 : 0.4));
      this.controller.setWheelEngineForce(i, i >= 2 ? engine * 0.5 : 0); // tracción trasera
      if (i < 2) this.controller.setWheelSteering(i, this.steer);
    }
    this.controller.updateVehicle(dt);

    // asistencia anti-vuelco y un poco de carga aerodinámica
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.currRot);
    if (up.y < 0.25) this.upsideTimer += dt; else this.upsideTimer = 0;
    const av = this.body.angvel();
    if (up.y > 0.25 && this.controller.wheelIsInContact(0)) {
      const corr = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0)).multiplyScalar(c.mass * 6 * dt);
      this.body.applyTorqueImpulse({ x: corr.x, y: 0, z: corr.z }, true);
    }
    if (Math.abs(av.x) + Math.abs(av.z) > 4) this.body.setAngvel({ x: av.x * 0.9, y: av.y, z: av.z * 0.9 }, true);
    if (this.upsideTimer > 2.5) this.reset();
  }

  postStep(): void {
    this.snapshot();
  }

  reset(): void {
    const p = this.currPos;
    const f = this.forward();
    let x = p.x, n = -p.z, heading = Math.atan2(-f.z, f.x);
    const nr = this.w.nearestRoad(x, n);
    if (nr && nr.dist < 60) {
      const dirH = Math.atan2(nr.dirN, nr.dirX);
      heading = Math.cos(dirH - heading) >= 0 ? dirH : dirH + Math.PI;
      x = nr.px; n = nr.pn;
    }
    this.place(x, n, heading);
  }

  /** Ubica el auto en coordenadas del pipeline mirando hacia `heading` (radianes, plano x/n). */
  place(x: number, n: number, heading: number): void {
    const y = this.w.heightAt(x, n) + 1.0;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setTranslation({ x, y, z: -n }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.upsideTimer = 0;
    this.snapshot();
    this.snapshot();
  }

  render(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    for (let i = 0; i < 4; i++) {
      const cp = this.controller.wheelChassisConnectionPointCs(i)!;
      const susp = this.controller.wheelSuspensionLength(i) ?? SEDAN.suspensionRest;
      const wg = this.wheels[i];
      wg.position.set(cp.x, cp.y - susp + 0.12, cp.z);
      const rotA = this.controller.wheelRotation(i) ?? 0;
      const st = this.controller.wheelSteering(i) ?? 0;
      wg.rotation.set(0, st, 0);
      wg.children.forEach((ch) => (ch.rotation.z = -rotA));
    }
  }

  /** Punto de la puerta del conductor (lado izquierdo), en Three. */
  doorPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-0.2, 0, -1.7).applyQuaternion(this.currRot).add(this.currPos);
  }
}
