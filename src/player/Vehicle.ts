import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Physics, RAPIER } from '../engine/Physics';
import { InputState } from '../engine/Input';
import { paintedMaterial } from '../render/PaintedMaterial';
import { WorldData } from '../world/WorldData';

/** Colores del Fiat que se eligen en la pantalla de inicio. `paint` es el color final de la chapa. */
export const CAR_PAINTS = [
  { id: 'gris', label: 'Gris claro', paint: null, swatch: '#b9bab6' },
  { id: 'negro', label: 'Negro', paint: '#2c2e33', swatch: '#24252a' },
  { id: 'rojo', label: 'Rojo', paint: '#c9301f', swatch: '#b3231b' },
  { id: 'azul', label: 'Azul', paint: '#2a62bf', swatch: '#1f4f9e' },
  { id: 'blanco', label: 'Blanco', paint: '#efede6', swatch: '#f4f2ec' },
] as const;
export type CarPaint = (typeof CAR_PAINTS)[number]['id'];

const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
/** Gris de la chapa en la textura original y aclarado que le aplica el material. */
const BODY_GRAY = 92, BODY_GAIN = 1.85;

/**
 * Repinta la chapa en la textura del Fiat: la pintura es un gris medio, igual que el degradé de
 * los vidrios, así que se toma por regiones conectadas (sin cruzar los bordes de ventanas y burletes)
 * y se conserva el sombreado de cada píxel.
 */
function repaint(src: THREE.Texture, hex: string): THREE.Texture {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, W, H);
  const px = data.data;
  const gray = (i: number) => px[i * 4];
  const mask = new Uint8Array(W * H);
  const okv = (i: number) => { const v = gray(i); return v >= 58 && v <= 120; };
  // semillas (x, y en una textura de 256): lateral, capot, techo/portón y zona media
  for (const [sx, sy] of [[50, 160], [50, 210], [225, 60], [120, 170]]) {
    const x0 = Math.floor((sx / 256) * W), y0 = Math.floor((sy / 256) * H), i0 = y0 * W + x0;
    if (!okv(i0) || mask[i0]) continue;
    const stack = [i0];
    mask[i0] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i - x) / W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !mask[j] && okv(j)) { mask[j] = 1; stack.push(j); }
      }
    }
  }
  const col = new THREE.Color(hex);
  const target = [col.r, col.g, col.b].map((v) => toLin(v * 255) / BODY_GAIN);
  const base = toLin(BODY_GRAY);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const shade = toLin(gray(i)) / base;
    for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.max(0, Math.min(255, Math.round(toSrgb(Math.min(1, target[k] * shade)))));
  }
  g.putImageData(data, 0, 0);
  // clone() comparte la imagen (Source) con el original: hay que darle una propia
  const t = src.clone();
  t.source = new THREE.Source(c);
  t.needsUpdate = true;
  return t;
}

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
  private readonly fallbackModel: THREE.Group;
  private readonly contactShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private wheels: THREE.Object3D[] = [];
  private importedWheels: { pivot: THREE.Group; index: number; original: THREE.Quaternion }[] = [];
  private importedWheelAxis = new THREE.Vector3(0, 0, 1);
  private importedUpAxis = new THREE.Vector3(0, 1, 0);
  private importedModel: THREE.Group | null = null;
  private bodyMaterial: THREE.MeshLambertMaterial | null = null;
  private bodyTexture: THREE.Texture | null = null;
  private paint: CarPaint = 'gris';
  private paintCache = new Map<CarPaint, THREE.Texture>();
  private interior: THREE.Group | null = null;
  /** Ojos del conductor en coordenadas del auto (X adelante, Z a la derecha; volante a la izquierda). */
  readonly driverEye = new THREE.Vector3(-0.3, 1.1, -0.36);
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

  constructor(private physics: Physics, private w: WorldData, scene: THREE.Scene, pos: THREE.Vector3, heading: number) {
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

    this.mesh = new THREE.Group();
    this.fallbackModel = this.buildModel();
    this.mesh.add(this.fallbackModel);
    this.fitCabin(new THREE.Box3().setFromObject(this.fallbackModel));
    const shadowGeometry = new THREE.PlaneGeometry(5.25, 2.55);
    shadowGeometry.rotateX(-Math.PI / 2);
    this.contactShadow = new THREE.Mesh(shadowGeometry, new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0.34 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float opacity; void main() { vec2 p = (vUv - 0.5) * 2.0; float fade = 1.0 - smoothstep(0.25, 1.0, length(p)); gl_FragColor = vec4(0.09, 0.08, 0.07, opacity * fade); }',
      transparent: true,
      depthWrite: false,
    }));
    this.contactShadow.renderOrder = 1;
    scene.add(this.contactShadow);
    scene.add(this.mesh);
    this.snapshot();
    this.snapshot();
  }

  /** Instala el Fiat Uno descargado, conservando el auto procedural si falla la carga. */
  async loadModel(url: string): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const wheelMeshes = new Map<string, THREE.Mesh>();
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material instanceof THREE.MeshStandardMaterial && object.material.name === 'Body') {
          // La textura contiene los detalles de la carrocería y los vidrios.
          // Lambert conserva ese dibujo sin reflejos especulares en la pintura.
          object.material = new THREE.MeshLambertMaterial({
            name: 'Body mate',
            map: object.material.map,
            color: new THREE.Color().setRGB(BODY_GAIN, BODY_GAIN, BODY_GAIN),
          });
          this.bodyMaterial = object.material;
          this.bodyTexture = object.material.map;
        }
        let parent: THREE.Object3D | null = object.parent;
        while (parent) {
          const key = /Wheel_(FL|FR|RL|RR)/.exec(parent.name)?.[1];
          if (key) { wheelMeshes.set(key, object); break; }
          parent = parent.parent;
        }
      });

      // El archivo de Sketchfab llega inclinado respecto de los ejes del juego.
      // Los centros de las ruedas definen el frente de forma estable.
      const center = (name: string) => new THREE.Box3().setFromObject(wheelMeshes.get(name)!).getCenter(new THREE.Vector3());
      const fl = center('FL'), fr = center('FR'), rl = center('RL'), rr = center('RR');
      const front = fl.clone().add(fr).multiplyScalar(0.5);
      const rear = rl.clone().add(rr).multiplyScalar(0.5);
      const forward = front.sub(rear).normalize();
      const right = fr.clone().add(rr).sub(fl).sub(rl).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const axle = new THREE.Vector3().crossVectors(forward, up).normalize();
      if (!Number.isFinite(forward.x) || forward.lengthSq() < 0.9 || up.lengthSq() < 0.9) throw new Error('Ejes del modelo inválidos');
      this.importedWheelAxis.copy(axle);
      this.importedUpAxis.copy(up);
      const orientation = new THREE.Quaternion()
        .setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, axle)).invert();
      const wheelIndex: Record<string, number> = { FL: 1, FR: 0, RL: 3, RR: 2 };
      this.importedWheels = [];
      for (const [name, wheel] of wheelMeshes) {
        const pivot = new THREE.Group();
        pivot.position.copy(center(name));
        model.add(pivot);
        model.updateMatrixWorld(true);
        pivot.attach(wheel);
        this.importedWheels.push({ pivot, index: wheelIndex[name], original: pivot.quaternion.clone() });
      }

      const bounds = new THREE.Box3().setFromObject(model);
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      const fitted = new THREE.Group();
      fitted.add(model);
      fitted.quaternion.copy(orientation);
      fitted.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(fitted).getSize(new THREE.Vector3());
      const scale = 1.12 * Math.min(4.48 / size.x, 1.82 / size.z, 1.85 / size.y);
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('Dimensiones del modelo inválidas');
      fitted.scale.setScalar(scale);
      fitted.updateMatrixWorld(true);
      const finalBounds = new THREE.Box3().setFromObject(fitted);
      const finalCenter = finalBounds.getCenter(new THREE.Vector3());
      fitted.position.set(-finalCenter.x, -0.65 - finalBounds.min.y, -finalCenter.z);
      this.mesh.add(fitted);
      this.fitCabin(finalBounds.clone().translate(fitted.position));
      this.fallbackModel.visible = false;
      this.importedModel = fitted;
      this.setPaint(this.paint);
    } catch (error) {
      console.warn('No se pudo cargar el modelo 3D del auto; se usa el anterior.', error);
      this.importedWheels = [];
      this.importedModel?.removeFromParent();
      this.importedModel = null;
      this.fallbackModel.visible = true;
    }
  }

  /** Cambia el color de la chapa (si el modelo todavía no cargó, se aplica al cargar). */
  setPaint(id: CarPaint): void {
    this.paint = id;
    const mat = this.bodyMaterial, src = this.bodyTexture;
    if (!mat || !src) return;
    const def = CAR_PAINTS.find((p) => p.id === id);
    let map: THREE.Texture = src;
    if (def?.paint) {
      let t = this.paintCache.get(id);
      if (!t) {
        try { t = repaint(src, def.paint); this.paintCache.set(id, t); } catch (e) { console.warn('No se pudo repintar el auto', e); }
      }
      if (t) map = t;
    }
    if (mat.map !== map) { mat.map = map; mat.needsUpdate = true; }
  }

  private buildModel(): THREE.Group {
    const g = new THREE.Group();
    const paint = paintedMaterial({ color: 0xbca36b, brushScale: 1.4, brushAmount: 0.16, rim: 0.25 });
    const lightPaint = paintedMaterial({ color: 0xc9b27a, brushScale: 1.4, brushAmount: 0.12, rim: 0.3 });
    const shade = paintedMaterial({ color: 0x937b4d, brushScale: 1.5, brushAmount: 0.13 });
    const chrome = paintedMaterial({ color: 0xc2c1b4, brushScale: 2, brushAmount: 0.06, rim: 0.42 });
    const trim = paintedMaterial({ color: 0x3a3831, brushScale: 2, brushAmount: 0.05 });
    const glass = paintedMaterial({ color: 0x415865, brushScale: 2.2, brushAmount: 0.07, rim: 0.65, side: THREE.DoubleSide });
    const windshield = paintedMaterial({ color: 0x566978, brushScale: 2, brushAmount: 0.05, rim: 0.75, side: THREE.DoubleSide });
    const tire = paintedMaterial({ color: 0x272720, brushScale: 3, brushAmount: 0.08 });
    const red = paintedMaterial({ color: 0xa83725, emissive: 0x250600, brushAmount: 0.06 });
    const amber = paintedMaterial({ color: 0xc08035, emissive: 0x281000, brushAmount: 0.06 });
    const white = paintedMaterial({ color: 0xe6d9bb, emissive: 0x201b0f, brushAmount: 0.04 });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const panel = (points: number[][], material: THREE.Material) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = false;
      g.add(mesh);
    };

    // Silueta de sedán de cuatro puertas: trompa y baúl rectos, techo bajo.
    box(4.55, 0.62, 1.78, paint, 0, 0.25, 0);
    box(1.22, 0.13, 1.78, lightPaint, 1.66, 0.62, 0); // capot
    box(0.66, 0.11, 1.78, lightPaint, -1.94, 0.61, 0); // tapa del baúl
    box(2.77, 0.14, 1.66, lightPaint, -0.22, 0.70, 0); // línea de cintura
    // Parantes y techo forman un trapecio ancho, como en la foto.
    const cabinSide = new THREE.Shape();
    cabinSide.moveTo(-1.68, 0.73);
    cabinSide.lineTo(1.10, 0.73);
    cabinSide.lineTo(0.55, 1.43);
    cabinSide.lineTo(-1.18, 1.43);
    cabinSide.closePath();
    const cabinGeo = new THREE.ExtrudeGeometry(cabinSide, { depth: 1.49, bevelEnabled: false });
    cabinGeo.translate(0, 0, -0.745);
    const cabin = new THREE.Mesh(cabinGeo, paint);
    cabin.castShadow = cabin.receiveShadow = true;
    g.add(cabin);
    box(1.85, 0.075, 1.57, lightPaint, -0.32, 1.44, 0);

    // Cada paño de vidrio queda separado por el parante central. Los marcos
    // pintados y la moldura cromada hacen legible el modelo desde lejos.
    for (const side of [-1, 1]) {
      const z = side * 0.758;
      panel([[-1.47, 0.82, z], [-0.40, 0.82, z], [-0.40, 1.33, z], [-1.10, 1.33, z]], glass);
      panel([[-0.31, 0.82, z], [0.90, 0.82, z], [0.48, 1.33, z], [-0.31, 1.33, z]], glass);
      box(0.046, 0.55, 0.052, trim, -0.35, 1.08, z + side * 0.014);
      box(2.48, 0.025, 0.05, chrome, -0.25, 0.795, z + side * 0.014);
      box(1.70, 0.025, 0.05, chrome, -0.32, 1.425, z + side * 0.014);
      box(0.045, 0.08, 0.20, chrome, -0.11, 0.63, side * 0.89); // picaportes
      box(0.045, 0.08, 0.20, chrome, -1.10, 0.63, side * 0.89);
      box(4.23, 0.032, 0.045, shade, 0, 0.46, side * 0.907); // nervio lateral
      box(0.38, 0.12, 0.17, paint, 0.91, 0.83, side * 0.92); // espejos
      box(0.13, 0.26, 0.05, trim, 0.81, 0.86, side * 0.94);
      // Hendiduras verticales de las cuatro puertas.
      box(0.016, 0.54, 0.036, shade, -0.34, 0.42, side * 0.914);
      box(0.016, 0.54, 0.036, shade, -1.50, 0.42, side * 0.914);
    }
    panel([[1.102, 0.82, -0.725], [1.102, 0.82, 0.725], [0.555, 1.34, 0.725], [0.555, 1.34, -0.725]], windshield);
    panel([[-1.685, 0.82, 0.725], [-1.685, 0.82, -0.725], [-1.175, 1.34, -0.725], [-1.175, 1.34, 0.725]], windshield);
    for (const side of [-1, 1]) {
      box(0.016, 0.45, 0.018, chrome, 0.84, 1.08, side * 0.72);
      box(0.016, 0.45, 0.018, chrome, -1.43, 1.08, side * 0.72);
    }

    // Parrilla horizontal y faros cuadrados; atrás, ópticas de dos colores.
    box(0.08, 0.34, 1.13, trim, 2.29, 0.43, 0);
    for (const y of [0.32, 0.40, 0.48, 0.56]) box(0.092, 0.019, 1.06, chrome, 2.345, y, 0);
    for (const side of [-1, 1]) {
      box(0.095, 0.31, 0.45, white, 2.30, 0.47, side * 0.68);
      box(0.10, 0.25, 0.45, red, -2.30, 0.50, side * 0.67);
      box(0.105, 0.115, 0.45, amber, -2.31, 0.31, side * 0.67);
      box(0.11, 0.025, 0.47, chrome, -2.32, 0.44, side * 0.67);
      box(0.13, 0.16, 0.12, trim, 2.34, 0.18, side * 0.62); // tacos de paragolpes
      box(0.13, 0.16, 0.12, trim, -2.34, 0.18, side * 0.62);
    }
    box(0.17, 0.17, 1.86, chrome, 2.35, 0.17, 0);
    box(0.17, 0.17, 1.86, chrome, -2.35, 0.17, 0);
    box(0.022, 0.11, 0.30, chrome, -2.30, 0.66, 0); // insignia del baúl
    const plateCanvas = document.createElement('canvas');
    plateCanvas.width = 256; plateCanvas.height = 72;
    const plateCtx = plateCanvas.getContext('2d')!;
    plateCtx.fillStyle = '#2b2b26'; plateCtx.fillRect(0, 0, 256, 72);
    plateCtx.strokeStyle = '#c9c6bd'; plateCtx.lineWidth = 4; plateCtx.strokeRect(3, 3, 250, 66);
    plateCtx.fillStyle = '#e1dfdb'; plateCtx.textAlign = 'center'; plateCtx.textBaseline = 'middle';
    plateCtx.font = 'bold 45px sans-serif'; plateCtx.fillText('VGB 1985', 128, 37);
    const plateTexture = new THREE.CanvasTexture(plateCanvas);
    plateTexture.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.71, 0.20), new THREE.MeshBasicMaterial({ map: plateTexture }));
    plate.rotation.y = -Math.PI / 2;
    plate.position.set(-2.305, 0.47, 0);
    g.add(plate);

    // Ruedas de chapa con centro claro, banda oscura y seis ranuras.
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16);
    wheelGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.285, 16);
    hubGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const wg = new THREE.Group();
      const t = new THREE.Mesh(wheelGeo, tire);
      t.castShadow = true;
      wg.add(t);
      wg.add(new THREE.Mesh(hubGeo, chrome));
      for (let spoke = 0; spoke < 6; spoke++) {
        const a = spoke * Math.PI / 3;
        const spot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.023, 0.296), trim);
        spot.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0);
        spot.rotation.z = a;
        wg.add(spot);
      }
      g.add(wg);
      this.wheels.push(wg);
    }
    g.name = 'Sedán beige de Villa General Belgrano';
    return g;
  }

  /** Ubica el asiento y arma un interior simple a partir del tamaño del modelo visible. */
  private fitCabin(box: THREE.Box3): void {
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const hw = size.z / 2;
    this.driverEye.set(c.x - size.x * 0.06, box.max.y - 0.36, -size.z * 0.21);
    const e = this.driverEye;
    this.interior?.removeFromParent();
    const inside = new THREE.Group();
    const dash = paintedMaterial({ color: 0x3b2e25, brushScale: 3, brushAmount: 0.1 });
    const trim = paintedMaterial({ color: 0xd8ccb0, brushScale: 3, brushAmount: 0.1 });
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      inside.add(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(0.5, 0.22, size.z - 0.25), dash, e.x + 0.78, e.y - 0.4, 0);
    part(new THREE.BoxGeometry(0.05, 0.08, 0.3), paintedMaterial({ color: 0x6a5a48, brushScale: 3 }), e.x + 0.56, e.y - 0.27, e.z);
    const wheel = part(new THREE.TorusGeometry(0.17, 0.022, 6, 20), dash, e.x + 0.5, e.y - 0.3, e.z);
    wheel.rotation.set(0, Math.PI / 2, 0);
    wheel.rotateX(-0.45);
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), dash, e.x + 0.62, e.y - 0.36, e.z).rotation.z = Math.PI / 2 + 0.45;
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(e.x + 1.0, e.y - 0.32, s * (hw - 0.12)), b = new THREE.Vector3(e.x + 0.48, e.y + 0.22, s * (hw - 0.16));
      const pillar = part(new THREE.BoxGeometry(a.distanceTo(b), 0.07, 0.07), trim, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      pillar.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      part(new THREE.BoxGeometry(1.8, 0.07, 0.07), trim, e.x - 0.42, e.y + 0.22, s * (hw - 0.16));
    }
    part(new THREE.BoxGeometry(0.1, 0.07, size.z - 0.3), trim, e.x + 0.48, e.y + 0.22, 0);
    part(new THREE.BoxGeometry(1.85, 0.03, size.z - 0.34), paintedMaterial({ color: 0xcfc2a6, brushScale: 3, side: THREE.DoubleSide }), e.x - 0.45, e.y + 0.25, 0);
    part(new THREE.BoxGeometry(0.03, 0.045, 0.17), dash, e.x + 0.45, e.y + 0.16, 0.02);
    inside.visible = false;
    this.mesh.add(inside);
    this.interior = inside;
  }

  /** Primera persona: muestra el tablero, el volante y el techo por dentro. */
  setInterior(on: boolean): void {
    if (this.interior && this.interior.visible !== on) this.interior.visible = on;
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
    const p = this.mesh.position;
    const ray = new RAPIER.Ray({ x: p.x, y: p.y + 2, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(ray, 8, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    const groundY = hit ? ray.origin.y - hit.timeOfImpact : this.w.heightAtXZ(p.x, p.z);
    const road = this.w.surfaceAt(p.x, -p.z).road;
    const roadY = this.w.heightAtXZ(p.x, p.z) + (road ? (road.major ? 0.1 : 0.06) + (road.bridge ? 0.35 : 0) : 0);
    const visibleGroundY = Math.max(groundY, roadY);
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);
    this.contactShadow.position.set(p.x, visibleGroundY + 0.025, p.z);
    this.contactShadow.rotation.y = Math.atan2(-forward.z, forward.x);
    this.contactShadow.material.uniforms.opacity.value = 0.34 * THREE.MathUtils.clamp(1 - Math.max(0, p.y - visibleGroundY - 0.8) / 2, 0, 1);
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
    if (this.importedWheels.length) {
      // El eje de giro del archivo queda alineado con Z tras ajustar el modelo.
      for (const { pivot, index, original } of this.importedWheels) {
        const roll = this.controller.wheelRotation(index) ?? 0;
        const steer = index < 2 ? this.controller.wheelSteering(index) ?? 0 : 0;
        pivot.quaternion.copy(original)
          .multiply(new THREE.Quaternion().setFromAxisAngle(this.importedUpAxis, steer))
          .multiply(new THREE.Quaternion().setFromAxisAngle(this.importedWheelAxis, -roll));
      }
    }
  }

  /** Punto de la puerta del conductor (lado izquierdo), en Three. */
  doorPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-0.2, 0, -1.7).applyQuaternion(this.currRot).add(this.currPos);
  }
}
