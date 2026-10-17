import * as THREE from 'three';
import type { Daylight } from './DayNight';
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
        sunDir: { value: sunDir.clone() },
        daylight: { value: 1 },
        twilight: { value: 0 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform float daylight; uniform float twilight; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c = mix(horizon, top, smoothstep(0.0, 0.55, y));
          c = mix(c, ground, (1.0 - smoothstep(-0.08, 0.0, y)));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          vec3 sunColor = mix(vec3(1.0, .96, .8), vec3(1.0, .48, .16), twilight);
          c += sunColor * (smoothstep(.99975, .99996, s) * 1.8 + pow(s, 80.0) * .2 + pow(s, 12.0) * .12) * smoothstep(-.08, .015, sunDir.y);
          // Warm horizon around the setting/rising sun, cooling to blue above.
          c += vec3(.34, .09, .025) * twilight * pow(s, 3.0) * (1.0 - smoothstep(.0, .4, abs(y)));
          float moon = max(dot(normalize(vDir), normalize(-sunDir)), 0.0);
          c += vec3(.5, .6, .8) * smoothstep(.9997, .99995, moon) * (1.0 - daylight);
          vec2 cell = floor(normalize(vDir).xz / max(.15, y + .4) * 480.0);
          float star = fract(sin(dot(cell, vec2(127.1,311.7))) * 43758.5453);
          c += vec3(.38, .43, .5) * step(.999, star) * (1.0 - daylight) * smoothstep(.1, .35, y);
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

  setDaylight(time: Daylight): void {
    const uniforms = (this.dome.material as THREE.ShaderMaterial).uniforms;
    uniforms.top.value.set(0x071225).lerp(new THREE.Color(PALETTE.skyTop), time.day);
    uniforms.horizon.value.set(0x25364c).lerp(new THREE.Color(PALETTE.skyHorizon), time.day).lerp(new THREE.Color(0xe5a478), time.twilight * .65);
    uniforms.ground.value.set(0x142039).lerp(new THREE.Color(0xb7c7b8), time.day);
    uniforms.sunDir.value.set(time.sun.x, time.sun.y, time.sun.z);
    uniforms.daylight.value = time.day;
    uniforms.twilight.value = time.twilight;
    for (const cloud of this.clouds) {
      const mat = cloud.material as THREE.SpriteMaterial;
      mat.color.set(0x34415d).lerp(new THREE.Color(0xfff8ed), time.day).lerp(new THREE.Color(0xffbc89), time.twilight * .5);
      mat.opacity = .65 + time.day * .27;
    }
  }

  update(camPos: THREE.Vector3, t: number): void {
    this.dome.position.copy(camPos);
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.x += Math.sin(i) * 0.02 + 0.6 * 0.016;
    void t;
  }
}
