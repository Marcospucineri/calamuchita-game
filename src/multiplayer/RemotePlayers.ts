import * as THREE from 'three';
import { createParachute } from '../player/Parachute';
import { createAvatar } from '../player/Character';
import type { Vehicle } from '../player/Vehicle';
import type { Aircraft } from '../player/Aircraft';
import { INTERP_DELAY_MS, STALE_MS, type NetLook, type NetMode, type NetState } from './protocol';

interface Snap { t: number; p: THREE.Vector3; q: THREE.Quaternion; speed: number }
interface Visual { mode: NetMode; group: THREE.Group; legs: THREE.Object3D[]; arms: THREE.Object3D[]; wheels: THREE.Object3D[]; propeller: THREE.Object3D | null; dispose(): void }

/** Cartel sobre la cabeza: nombre y, un rato, lo último que dijo. */
class Tag {
  readonly el = document.createElement('div');
  private bubble = document.createElement('div');
  private name = document.createElement('div');
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(parent: HTMLElement, label: string) {
    this.el.className = 'mp-tag';
    this.bubble.className = 'mp-bubble';
    this.name.className = 'mp-name';
    this.name.textContent = label;
    this.el.append(this.bubble, this.name);
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }
  setLabel(label: string): void { this.name.textContent = label; }
  say(text: string): void {
    this.bubble.textContent = text;
    this.el.classList.add('talking');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('talking'), Math.min(9000, 3500 + text.length * 70));
  }
  get talking(): boolean { return this.el.classList.contains('talking'); }
  place(x: number, y: number, opacity: number): void {
    this.el.style.display = opacity <= 0.02 ? 'none' : '';
    this.el.style.opacity = String(opacity);
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  hide(): void { this.el.style.display = 'none'; }
  remove(): void { if (this.timer) clearTimeout(this.timer); this.el.remove(); }
}

interface RemotePeer {
  sid: string;
  look: NetLook;
  snaps: Snap[];
  mode: NetMode;
  visual: Visual | null;
  tag: Tag;
  lastSeen: number;
  phase: number;
  roll: number;
  pos: THREE.Vector3;
  shown: boolean;
}

const HEIGHT: Record<NetMode, number> = { c: 2.1, f: 2.25, p: 3.6, d: 2.25, h: 6.5 };
const tmpV = new THREE.Vector3();
const tmpF = new THREE.Vector3();

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

/** Los otros jugadores dentro de la escena: modelos, suavizado de movimiento y carteles. */
export class RemotePlayers {
  private peers = new Map<string, RemotePeer>();
  private tags: HTMLElement;
  private self: Tag;
  private selfTimer = 0;

  constructor(private scene: THREE.Scene, private car: Vehicle, private plane: Aircraft, parent: HTMLElement) {
    this.tags = document.createElement('div');
    this.tags.className = 'mp-tags';
    this.tags.setAttribute('aria-hidden', 'true');
    parent.prepend(this.tags);
    this.self = new Tag(this.tags, '');
    this.self.el.classList.add('self');
  }

  get count(): number { return this.peers.size; }

  add(sid: string, look: NetLook): void {
    if (this.peers.has(sid)) { this.setLook(sid, look); return; }
    this.peers.set(sid, { sid, look, snaps: [], mode: 'c', visual: null, tag: new Tag(this.tags, look.name), lastSeen: performance.now(), phase: 0, roll: 0, pos: new THREE.Vector3(), shown: false });
  }

  setLook(sid: string, look: NetLook): void {
    const p = this.peers.get(sid);
    if (!p) return;
    p.look = look;
    p.tag.setLabel(look.name);
    this.dropVisual(p); // se rearma con el aspecto nuevo
  }

  remove(sid: string): void {
    const p = this.peers.get(sid);
    if (!p) return;
    this.dropVisual(p);
    p.tag.remove();
    this.peers.delete(sid);
  }

  push(sid: string, s: NetState, now = performance.now()): void {
    const p = this.peers.get(sid);
    if (!p) return;
    p.lastSeen = now;
    p.mode = s.mode;
    p.snaps.push({ t: now, p: new THREE.Vector3(s.x, s.y, s.z), q: new THREE.Quaternion(s.qx, s.qy, s.qz, s.qw), speed: s.speed });
    if (p.snaps.length > 40) p.snaps.splice(0, p.snaps.length - 40);
  }

  say(sid: string, text: string): void { this.peers.get(sid)?.tag.say(text); }
  saySelf(text: string): void { this.self.say(text); }

  /** Dónde están, en coordenadas del mapa (x este, n norte), para el minimapa. */
  markers(): { x: number; n: number; name: string; mode: NetMode }[] {
    const out: { x: number; n: number; name: string; mode: NetMode }[] = [];
    for (const p of this.peers.values()) if (p.shown) out.push({ x: p.pos.x, n: -p.pos.z, name: p.look.name, mode: p.mode });
    return out;
  }

  private dropVisual(p: RemotePeer): void {
    if (!p.visual) return;
    this.scene.remove(p.visual.group);
    p.visual.dispose();
    p.visual = null;
  }

  private build(p: RemotePeer, mode: NetMode): Visual {
    if (mode === 'f' || mode === 'd' || mode === 'h') {
      const a = createAvatar(p.look.appearance);
      const group = new THREE.Group(); group.add(a.mesh);
      if (mode === 'd') { a.mesh.rotation.z = Math.PI; a.mesh.position.y = 1.85; }
      if (mode === 'h') group.add(createParachute());
      if (mode !== 'f') a.arms.forEach((arm) => { arm.rotation.z = mode === 'h' ? 2.6 : 1.1; });
      this.scene.add(group);
      return { mode, group, legs: mode === 'f' ? a.legs : [], arms: a.arms, wheels: [], propeller: null, dispose: () => disposeObject(group) };
    }
    if (mode === 'p') {
      const r = this.plane.makeRemote();
      this.scene.add(r.group);
      return { mode, group: r.group, legs: [], arms: [], wheels: [], propeller: r.propeller, dispose: () => { /* comparte geometría y materiales */ } };
    }
    const r = this.car.makeRemote(p.look.paint);
    this.scene.add(r.group);
    return { mode, group: r.group, legs: [], arms: [], wheels: r.wheels, propeller: null, dispose: r.dispose };
  }

  /** Posición suavizada: se dibuja un poco en el pasado, entre los dos paquetes que rodean ese momento. */
  private sample(p: RemotePeer, now: number, outP: THREE.Vector3, outQ: THREE.Quaternion): number {
    const rt = now - INTERP_DELAY_MS;
    const s = p.snaps;
    while (s.length > 2 && s[1].t < rt - 500) s.shift();
    if (s.length === 1 || rt <= s[0].t) { outP.copy(s[0].p); outQ.copy(s[0].q); return s[0].speed; }
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (rt > b.t) continue;
      // un salto grande (viaje rápido, volver al aeroclub) no se recorre: se corta
      if (a.p.distanceToSquared(b.p) > 100 * 100) {
        const c = rt >= b.t - 1 ? b : a;
        outP.copy(c.p); outQ.copy(c.q); return c.speed;
      }
      const k = THREE.MathUtils.clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
      outP.lerpVectors(a.p, b.p, k); outQ.slerpQuaternions(a.q, b.q, k);
      return THREE.MathUtils.lerp(a.speed, b.speed, k);
    }
    // sin paquetes nuevos: sigue un instante en la misma dirección y se queda
    const last = s[s.length - 1];
    const ahead = Math.min(0.6, (rt - last.t) / 1000);
    tmpF.set(1, 0, 0).applyQuaternion(last.q);
    outP.copy(last.p).addScaledVector(tmpF, last.speed * ahead);
    outQ.copy(last.q);
    return last.speed * (1 - ahead / 0.6);
  }

  update(dt: number, camera: THREE.Camera, selfAt: THREE.Vector3 | null, selfMode: NetMode, now = performance.now()): void {
    const w = window.innerWidth, h = window.innerHeight;
    const q = new THREE.Quaternion();
    for (const p of this.peers.values()) {
      const stale = now - p.lastSeen > STALE_MS || p.snaps.length === 0;
      if (stale) {
        if (p.visual) p.visual.group.visible = false;
        p.tag.hide();
        p.shown = false;
        continue;
      }
      const speed = this.sample(p, now, p.pos, q);
      if (p.visual && p.visual.mode !== p.mode) this.dropVisual(p);
      p.visual ??= this.build(p, p.mode);
      const v = p.visual;
      v.group.visible = true;
      v.group.position.copy(p.pos);
      v.group.quaternion.copy(q);
      p.shown = true;
      if (v.legs.length) {
        const s = Math.min(Math.abs(speed), 6.2);
        p.phase += dt * (3 + s * 1.6) * (s > 0.2 ? 1 : 0);
        const amp = Math.min(1, s / 2.6) * (s > 4.3 ? 0.85 : 0.55);
        v.legs[0].rotation.z = Math.sin(p.phase) * amp;
        v.legs[1].rotation.z = -Math.sin(p.phase) * amp;
        v.arms[0].rotation.z = -Math.sin(p.phase) * amp * 0.8;
        v.arms[1].rotation.z = Math.sin(p.phase) * amp * 0.8;
      }
      if (v.wheels.length) {
        p.roll -= (speed / 0.36) * dt;
        for (const wheel of v.wheels) wheel.children.forEach((c) => (c.rotation.z = p.roll));
      }
      if (v.propeller) {
        p.roll = (p.roll + dt * (14 + Math.min(1, Math.abs(speed) / 40) * 90)) % (Math.PI * 2);
        v.propeller.rotation.x = p.roll;
      }
      this.project(p.tag, p.pos, HEIGHT[p.mode], camera, w, h, p.tag.talking);
    }
    if (selfAt && this.self.talking) this.project(this.self, selfAt, HEIGHT[selfMode], camera, w, h, true);
    else this.self.hide();
  }

  private project(tag: Tag, at: THREE.Vector3, height: number, camera: THREE.Camera, w: number, h: number, talking: boolean): void {
    tmpV.copy(at); tmpV.y += height;
    const dist = camera.position.distanceTo(tmpV);
    tmpV.project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.15 || Math.abs(tmpV.y) > 1.15) { tag.hide(); return; }
    // el nombre se desvanece con la distancia; quien está hablando se lee desde más lejos
    const far = talking ? 320 : 200;
    tag.place((tmpV.x * 0.5 + 0.5) * w, (-tmpV.y * 0.5 + 0.5) * h, THREE.MathUtils.clamp((far - dist) / (far * 0.6), 0, 1));
  }

  clear(): void {
    for (const sid of [...this.peers.keys()]) this.remove(sid);
  }

  dispose(): void {
    this.clear();
    this.self.remove();
    this.tags.remove();
    clearTimeout(this.selfTimer);
  }
}
