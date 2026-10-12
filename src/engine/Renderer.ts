import * as THREE from 'three';
import { PALETTE, QualitySettings } from '../core/Config';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Dirección hacia el sol (normalizada). */
  readonly sunDir = new THREE.Vector3(-0.45, 0.72, 0.35).normalize();

  constructor(canvas: HTMLCanvasElement, private q: QualitySettings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 60000);

    this.scene.fog = new THREE.FogExp2(PALETTE.fog, 0.00011);
    this.scene.background = new THREE.Color(PALETTE.skyHorizon);

    this.hemi = new THREE.HemisphereLight(0xcfe3f0, 0x6b6340, 1.15);
    this.scene.add(this.hemi);
    const amb = new THREE.AmbientLight(0xfff4e0, 0.35);
    this.scene.add(amb);

    this.sun = new THREE.DirectionalLight(PALETTE.sun, 2.3);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const s = 70;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 600 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
    this.renderer.setPixelRatio(q.pixelRatio);
    this.resize();
  }

  /** La sombra sigue al jugador; se ajusta a la grilla de texels para que no "tiemble". */
  followShadow(target: THREE.Vector3): void {
    const texel = (2 * 70) / (this.q.shadowMapSize || 2048);
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(tx + this.sunDir.x * 300, target.y + this.sunDir.y * 300, tz + this.sunDir.z * 300);
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
