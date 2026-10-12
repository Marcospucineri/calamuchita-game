import * as THREE from 'three';
import { PALETTE } from '../core/Config';
import { cloudTexture } from '../render/Textures';

/** Cielo pintado: domo con gradiente, halo del sol y nubes planas. */
export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private clouds: THREE.Sprite[] = [];

  constructor(scene: THREE.Scene, sunDir: THREE.Vector3) {
    const geo = new THREE.SphereGeometry(40000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        ground: { value: new THREE.Color(0xb7c7b8) },
        sunDir: { value: sunDir },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c = mix(horizon, top, smoothstep(0.0, 0.55, y));
          c = mix(c, ground, smoothstep(0.0, -0.08, y));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += vec3(1.0, 0.92, 0.7) * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const ct = cloudTexture();
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.92 });
      const sp = new THREE.Sprite(mat);
      const ang = r() * Math.PI * 2;
      const dist = 4000 + r() * 22000;
      sp.position.set(Math.cos(ang) * dist, 1500 + r() * 1800, Math.sin(ang) * dist - 5000);
      const w = 1800 + r() * 3200;
      sp.scale.set(w, w * 0.42, 1);
      this.clouds.push(sp);
      this.group.add(sp);
    }
    scene.add(this.group);
  }

  update(camPos: THREE.Vector3, t: number): void {
    this.dome.position.copy(camPos);
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.x += Math.sin(i) * 0.02 + 0.6 * 0.016;
    void t;
  }
}
