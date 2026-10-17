import * as THREE from 'three';
import type { Daylight } from '../world/DayNight';
import { sharedUniforms } from '../render/PaintedMaterial';
import { PALETTE, QualitySettings } from '../core/Config';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  private moonDir = new THREE.Vector3(.3, .8, -.3).normalize();
  readonly ambient: THREE.AmbientLight;
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
    this.ambient = new THREE.AmbientLight(0xfff4e0, 0.35);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(PALETTE.sun, 2.3);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const s = 70;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 600 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x91acdf, 0);
    this.moon.target = this.sun.target;
    this.scene.add(this.moon);

    window.addEventListener('resize', () => this.resize());
  }

  setDaylight(time: Daylight): void {
    const { day, night, twilight } = time;
    sharedUniforms.uNight.value = night;
    this.hemi.color.set(0x718ec0).lerp(new THREE.Color(0xcfe3f0), day);
    this.hemi.groundColor.set(0x292b3b).lerp(new THREE.Color(0x6b6340), day);
    this.hemi.intensity = .32 + day * .83;
    this.ambient.color.set(0x7185b0).lerp(new THREE.Color(0xfff4e0), day);
    this.ambient.intensity = .13 + day * .22;
    const sunlight = new THREE.Color(PALETTE.sun).lerp(new THREE.Color(0xffa05c), twilight * .8);
    this.sun.color.set(0x91acdf).lerp(sunlight, day);
    this.sun.intensity = time.elevation > -.8 ? day * 2.3 * Math.min(1, Math.max(0, (time.elevation + .8) / 2.8)) : 0;
    this.moon.intensity = .24 * night;
    const daylightDirection = new THREE.Vector3(time.sun.x, Math.max(.08, time.sun.y), time.sun.z).normalize();
    this.moonDir.set(-time.sun.x, Math.max(.25, -time.sun.y), -time.sun.z).normalize();
    this.sunDir.copy(daylightDirection);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(0x152238).lerp(new THREE.Color(PALETTE.fog), day).lerp(new THREE.Color(0xb7867f), twilight * .35);
    (this.scene.background as THREE.Color).copy(fog.color);
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
    this.moon.position.set(tx + this.moonDir.x * 300, target.y + this.moonDir.y * 300, tz + this.moonDir.z * 300);
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
