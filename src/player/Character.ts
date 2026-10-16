import * as THREE from 'three';
import { Physics, RAPIER } from '../engine/Physics';
import { InputState } from '../engine/Input';
import { DEFAULT_PROFILE, type Appearance } from '../gameplay/Progress';
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
    const avatar = createAvatar();
    this.mesh.add(avatar.mesh);
    this.legs = avatar.legs;
    this.arms = avatar.arms;
  }

  setAppearance(appearance: Appearance): void {
    const materials = new Set<THREE.Material>();
    this.mesh.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m)); } });
    materials.forEach((m) => m.dispose());
    this.mesh.clear();
    const avatar = createAvatar(appearance);
    this.mesh.add(avatar.mesh);
    this.legs = avatar.legs;
    this.arms = avatar.arms;
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

export function createAvatar(appearance: Appearance = DEFAULT_PROFILE.appearance): { mesh: THREE.Group; legs: THREE.Object3D[]; arms: THREE.Object3D[] } {
    const mesh = new THREE.Group();
    const legs: THREE.Object3D[] = [], arms: THREE.Object3D[] = [];
    const tee = paintedMaterial({ color: appearance.shirt, brushScale: 3, brushAmount: 0.12, rim: 0.24 });
    const rib = paintedMaterial({ color: new THREE.Color(appearance.shirt).multiplyScalar(0.7), brushScale: 3, brushAmount: 0.08 });
    const shorts = paintedMaterial({ color: 0xd7c597, brushScale: 2.5, brushAmount: 0.15 });
    const shortsShade = paintedMaterial({ color: 0xb9aa83, brushScale: 2.5, brushAmount: 0.12 });
    const skin = paintedMaterial({ color: appearance.skin, brushScale: 3.5, brushAmount: 0.13, rim: 0.25 });
    const skinShade = paintedMaterial({ color: new THREE.Color(appearance.skin).multiplyScalar(0.8), brushScale: 3.5, brushAmount: 0.1 });
    const beard = paintedMaterial({ color: appearance.hairColor, brushScale: 4, brushAmount: 0.12, side: THREE.DoubleSide });
    beard.name = 'Pelo y barba';
    const eyes = paintedMaterial({ color: 0x171b18, brushScale: 4, brushAmount: 0.05 });
    eyes.name = 'Ojos y cejas';
    const shoe = paintedMaterial({ color: 0x252927, brushScale: 3, brushAmount: 0.11 });
    const sole = paintedMaterial({ color: 0xb7b5a0, brushScale: 2, brushAmount: 0.05 });
    const lace = paintedMaterial({ color: 0xdfd8b9, brushScale: 2, brushAmount: 0.05 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = mesh) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = mesh) =>
      add(new THREE.BoxGeometry(w, h, d), m, x, y, z, parent);
    const shirtGeometry = () => {
      // Seis secciones ovaladas: cintura angosta, pecho suave y hombros redondeados.
      const rings = [
        [0.91, 0.17, 0.205], [0.97, 0.19, 0.225],
        [1.22, 0.218, 0.263], [1.39, 0.198, 0.257],
        [1.48, 0.145, 0.19], [1.52, 0.08, 0.11],
      ];
      const sides = 16, positions: number[] = [], indices: number[] = [];
      for (const [y, depth, halfWidth] of rings) {
        for (let i = 0; i < sides; i++) {
          const a = i * Math.PI * 2 / sides;
          positions.push(Math.cos(a) * depth, y, Math.sin(a) * halfWidth);
        }
      }
      for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < sides; i++) {
        const a = r * sides + i, b = r * sides + (i + 1) % sides;
        const c = (r + 1) * sides + (i + 1) % sides, d = (r + 1) * sides + i;
        indices.push(a, c, b, a, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    // Un cuerpo base; el pelo, la barba y los colores cambian por estilo. El frente
    // del modelo mira hacia +X, como el movimiento del personaje existente.
    box(0.30, 0.13, 0.33, shorts, 0, 0.83, 0);
    add(shirtGeometry(), tee, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.188, 0.185, 0.025, 12), rib, 0, 0.925, 0); // ruedo
    const collar = add(new THREE.TorusGeometry(0.108, 0.022, 6, 16), rib, 0, 1.512, 0);
    collar.rotation.x = Math.PI / 2;
    box(0.16, 0.13, 0.16, skin, 0, 1.56, 0); // cuello

    add(new THREE.SphereGeometry(0.205, 16, 12), skin, 0.025, 1.72, 0);
    if (appearance.beard) add(new THREE.SphereGeometry(0.14, 12, 8), beard, 0.126, 1.61, 0).scale.set(0.64, 0.86, 1.18);
    if (appearance.beard) box(0.052, 0.037, 0.19, beard, 0.231, 1.665, 0); // bigote
    add(new THREE.SphereGeometry(0.040, 8, 6), skinShade, 0.237, 1.714, 0).scale.set(1, 1.4, 0.80); // nariz
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.045, 8, 6), skin, 0.035, 1.704, s * 0.203); // orejas
      add(new THREE.SphereGeometry(0.013, 8, 6), eyes, 0.204, 1.748, s * 0.077); // ojos
      box(0.022, 0.018, 0.078, eyes, 0.202, 1.791, s * 0.078); // cejas
      if (appearance.beard) add(new THREE.SphereGeometry(0.07, 8, 6), beard, 0.101, 1.622, s * 0.137).scale.set(0.65, 0.85, 0.8);
    }

    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.81, s * 0.155);
      mesh.add(hip);
      add(new THREE.CylinderGeometry(0.14, 0.15, 0.30, 10), shorts, 0, -0.105, 0, hip);
      add(new THREE.CylinderGeometry(0.151, 0.151, 0.024, 10), shortsShade, 0, -0.25, 0, hip); // ruedo
      add(new THREE.CapsuleGeometry(0.082, 0.25, 4, 9), skin, -0.01, -0.43, 0, hip);
      add(new THREE.SphereGeometry(0.075, 8, 6), skinShade, 0.01, -0.35, 0, hip);
      box(0.31, 0.055, 0.19, sole, 0.08, -0.748, 0, hip);
      box(0.30, 0.11, 0.19, shoe, 0.065, -0.688, 0, hip);
      for (const dx of [-0.03, 0.025, 0.08]) box(0.014, 0.011, 0.14, lace, dx, -0.625, 0, hip);
      legs.push(hip);

      const sh = new THREE.Group();
      sh.position.set(0, 1.42, s * 0.292);
      mesh.add(sh);
      add(new THREE.CapsuleGeometry(0.090, 0.10, 4, 10), tee, 0, -0.115, 0, sh); // manga corta
      add(new THREE.CylinderGeometry(0.091, 0.088, 0.024, 10), rib, 0, -0.24, 0, sh);
      add(new THREE.CapsuleGeometry(0.073, 0.255, 4, 10), skin, 0, -0.405, 0, sh);
      add(new THREE.SphereGeometry(0.057, 8, 6), skin, 0.025, -0.575, 0, sh);
      arms.push(sh);
    }
    if (appearance.hair !== 'rapado') {
      const hair = add(new THREE.SphereGeometry(0.212, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), beard, 0.025, 1.75, 0);
      hair.scale.set(1, 0.9, 1);
      if (appearance.hair === 'rodete') add(new THREE.SphereGeometry(0.11, 10, 8), beard, -0.13, 1.91, 0);
      if (appearance.hair === 'rulos-largos') {
        const curl = new THREE.SphereGeometry(0.065, 7, 6);
        // Rulos sobre la coronilla y una caída por detrás de las orejas; la cara queda libre.
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI * 2 / 12;
          add(curl, beard, 0.025 + Math.cos(a) * 0.15, 1.91, Math.sin(a) * 0.15);
        }
        for (let row = 0; row < 8; row++) for (let i = 0; i < 8; i++) {
          const a = 1.25 + i * (Math.PI * 2 - 2.5) / 7 + Math.sin(row * 2) * 0.07;
          const x = 0.025 + Math.cos(a) * (0.2 + row * 0.005);
          const z = Math.sin(a) * (0.225 + row * 0.005);
          add(curl, beard, x, 1.84 - row * 0.083, z).scale.set(1, 1.1, 1);
        }
      }
      if (appearance.hair === 'media-melena' || appearance.hair === 'largo-lacio') {
        const bottom = appearance.hair === 'media-melena' ? 1.48 : 1.10;
        const rings = [1.86, 1.72, 1.57, bottom];
        const positions: number[] = [], indices: number[] = [], sides = 18;
        for (let row = 0; row < rings.length; row++) for (let i = 0; i <= sides; i++) {
          const a = 1.22 + i * (Math.PI * 2 - 2.44) / sides;
          const flare = row === rings.length - 1 ? 0.025 : 0;
          positions.push(0.025 + Math.cos(a) * (0.215 + flare), rings[row], Math.sin(a) * (0.23 + flare));
        }
        for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < sides; i++) {
          const a = row * (sides + 1) + i, b = a + sides + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
        const curtain = new THREE.BufferGeometry();
        curtain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        curtain.setIndex(indices); curtain.computeVertexNormals();
        const hair = add(curtain, beard, 0, 0, 0);
        hair.name = 'Caída del pelo';
      }
    }
    mesh.name = 'Visitante del valle';
    return { mesh, legs, arms };
  }
