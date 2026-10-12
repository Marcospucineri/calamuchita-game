import * as THREE from 'three';
import { Physics, RAPIER } from '../engine/Physics';
import { InputState } from '../engine/Input';
import { paintedMaterial } from '../render/PaintedMaterial';

const HALF_H = 0.55, RADIUS = 0.32;
const WALK = 2.6, RUN = 6.2, JUMP = 5.2, GRAVITY = 20;

/** Personaje a pie con controlador cinemático de Rapier y animación procedural simple. */
export class Character {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  readonly mesh = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private vy = 0;
  private grounded = false;
  private phase = 0;
  private prev = new THREE.Vector3();
  private curr = new THREE.Vector3();
  facing = 0; // yaw en Three
  speed = 0;
  active = false;

  constructor(physics: Physics, scene: THREE.Scene) {
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000, 0));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF_H, RADIUS), this.body);
    this.cc = w.createCharacterController(0.03);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.cc.enableAutostep(0.45, 0.2, false);
    this.cc.enableSnapToGround(0.5);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.buildModel();
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  private buildModel(): void {
    const shirt = paintedMaterial({ color: 0xc7643a, brushScale: 3, rim: 0.3 });
    const pants = paintedMaterial({ color: 0x3d4f6b, brushScale: 3 });
    const skin = paintedMaterial({ color: 0xe0b48e, brushScale: 3 });
    const hair = paintedMaterial({ color: 0x3a2618, brushScale: 3 });
    const shoe = paintedMaterial({ color: 0x3a2a20, brushScale: 3 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.mesh) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.CapsuleGeometry(0.27, 0.45, 4, 10), shirt, 0, 1.12, 0);
    add(new THREE.SphereGeometry(0.21, 12, 10), skin, 0, 1.67, 0);
    const h = add(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 1.7, -0.01);
    h.rotation.x = -0.15;
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.82, s * 0.12);
      this.mesh.add(hip);
      add(new THREE.CapsuleGeometry(0.1, 0.5, 3, 8), pants, 0, -0.38, 0, hip);
      add(new THREE.BoxGeometry(0.26, 0.1, 0.13), shoe, 0.06, -0.74, 0, hip);
      this.legs.push(hip);
      const sh = new THREE.Group();
      sh.position.set(0, 1.38, s * 0.33);
      this.mesh.add(sh);
      add(new THREE.CapsuleGeometry(0.075, 0.45, 3, 8), shirt, 0, -0.28, 0, sh);
      add(new THREE.SphereGeometry(0.075, 8, 6), skin, 0, -0.58, 0, sh);
      this.arms.push(sh);
    }
  }

  get position(): THREE.Vector3 {
    return this.curr;
  }

  spawn(pos: THREE.Vector3, facing: number): void {
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + HALF_H + RADIUS + 0.05, z: pos.z });
    this.body.setTranslation({ x: pos.x, y: pos.y + HALF_H + RADIUS + 0.05, z: pos.z }, true);
    this.curr.copy(pos);
    this.prev.copy(pos);
    this.facing = facing;
    this.vy = 0;
    this.active = true;
    this.collider.setEnabled(true);
    this.mesh.visible = true;
  }

  despawn(): void {
    this.active = false;
    this.collider.setEnabled(false);
    this.mesh.visible = false;
    this.body.setTranslation({ x: 0, y: -1000, z: 0 }, false);
  }

  fixedUpdate(dt: number, input: InputState, camYaw: number): void {
    if (!this.active) return;
    // movimiento relativo a la cámara
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let mx = fx * input.moveY + rx * input.moveX;
    let mz = fz * input.moveY + rz * input.moveX;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sp = input.run ? RUN : WALK;
    if (len > 0.05) {
      const target = Math.atan2(mx, mz);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    if (this.grounded && input.jump) { this.vy = JUMP; this.grounded = false; }
    this.vy -= GRAVITY * dt;
    if (this.vy < -40) this.vy = -40;
    const desired = { x: mx * sp * dt, y: this.vy * dt, z: mz * sp * dt };
    this.cc.computeColliderMovement(this.collider, desired);
    const m = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = -1;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.speed = Math.hypot(m.x, m.z) / dt;
  }

  postStep(): void {
    if (!this.active) return;
    this.prev.copy(this.curr);
    const t = this.body.translation();
    this.curr.set(t.x, t.y - HALF_H - RADIUS, t.z);
  }

  render(alpha: number, dt: number): void {
    if (!this.active) return;
    this.mesh.position.lerpVectors(this.prev, this.curr, alpha);
    this.mesh.rotation.y = this.facing - Math.PI / 2;
    // animación de caminata
    const s = Math.min(this.speed, RUN);
    this.phase += dt * (3 + s * 1.6) * (s > 0.2 ? 1 : 0);
    const amp = Math.min(1, s / WALK) * (s > RUN * 0.7 ? 0.85 : 0.55);
    this.legs[0].rotation.z = Math.sin(this.phase) * amp;
    this.legs[1].rotation.z = -Math.sin(this.phase) * amp;
    this.arms[0].rotation.z = -Math.sin(this.phase) * amp * 0.8;
    this.arms[1].rotation.z = Math.sin(this.phase) * amp * 0.8;
    this.mesh.position.y += Math.abs(Math.sin(this.phase)) * 0.05 * amp;
  }
}
