import type * as THREE from 'three';
import { bus } from '../core/EventBus';
import { accounts } from '../services/Accounts';
import { CAR_PAINTS } from '../player/Vehicle';
import type { PlayerController } from '../player/PlayerController';
import type { Profile } from '../gameplay/Progress';
import type { WorldData } from '../world/WorldData';
import type { HUD } from '../ui/HUD';
import { overlays } from '../ui/Overlays';
import { ChatUI } from '../ui/Chat';
import { Network } from './Network';
import { RemotePlayers } from './RemotePlayers';
import type { NetLook, NetMode, NetState } from './protocol';

const PREF = 'calamuchita.online';
export const onlinePreference = (): boolean => {
  try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; }
};

export interface OnlineDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  hud: HUD;
  world: WorldData;
  player: PlayerController;
  profile(): Profile;
  openProfile(): void;
}

/** Une la red, los jugadores remotos y el chat con el resto del juego. */
export class Online {
  readonly net = new Network(CAR_PAINTS.map((p) => p.id));
  readonly remotes: RemotePlayers;
  readonly chat: ChatUI;
  enabled = onlinePreference();
  /** Solo en desarrollo (?mpsim=N): jugadores simulados sin red. */
  simulated = false;
  private connectedAt = 0;

  constructor(private d: OnlineDeps) {
    this.remotes = new RemotePlayers(d.scene, d.player.car, d.player.plane, d.hud.root);
    this.chat = new ChatUI(d.hud.root, {
      canOpen: () => this.checkChat(),
      blocked: () => overlays.isOpen || d.hud.isMapOpen,
      send: (text) => this.sendChat(text),
      info: () => this.info(),
    });
    d.hud.onChat = () => this.chat.toggle();
    this.net.on = {
      status: () => {
        if (this.net.status === 'online') this.connectedAt = performance.now();
        this.chat.setOthers(this.net.status === 'online' ? this.net.peers.size : null);
      },
      peerJoin: (sid, look) => {
        this.remotes.add(sid, look);
        this.chat.setOthers(this.net.peers.size);
        if (performance.now() - this.connectedAt > 2500) bus.emit('toast', { text: `${look.name} se sumó al valle`, sub: 'Apretá T para saludar' });
      },
      peerLook: (sid, look) => this.remotes.setLook(sid, look),
      peerLeave: (sid) => { this.remotes.remove(sid); this.chat.setOthers(this.net.status === 'online' ? this.net.peers.size : null); },
      peerState: (sid, state) => this.remotes.push(sid, state),
      chat: (line) => {
        this.chat.add(line);
        if (line.mine) this.remotes.saySelf(line.text);
        else this.remotes.say(line.sid, line.text);
      },
    };
    this.connect();
    if (import.meta.env.DEV) {
      const n = Number(new URLSearchParams(location.search).get('mpsim'));
      if (n > 0) void import('./Sim').then((m) => m.startSim(this, d.world, Math.min(8, n)));
    }
  }

  private look(): NetLook {
    const p = this.d.profile();
    return { name: p.name, appearance: p.appearance, paint: this.d.player.car.paint };
  }

  private connect(): void {
    if (this.simulated || !this.enabled || !accounts.client || !accounts.user) return;
    void this.net.start(accounts.client, this.look());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
    this.remotes.clear();
    if (on) this.connect();
    else { this.chat.close(); this.net.stop(); }
  }

  /** Tras cambiar el nombre o el aspecto. */
  refreshLook(): void {
    if (this.net.status === 'online') this.net.setLook(this.look());
  }

  private info(): string {
    if (this.simulated) return 'Sala de prueba';
    const others = this.net.peers.size;
    return others === 0 ? `Sala ${this.net.room} · por ahora estás solo` : `Sala ${this.net.room} · ${others + 1} jugadores`;
  }

  private checkChat(): boolean {
    if (this.simulated) return true;
    let why: string | null = null;
    if (!accounts.client) why = 'Sin conexión: el chat no está disponible.';
    else if (!accounts.user) {
      bus.emit('toast', { text: 'Iniciá sesión para chatear', sub: 'Con tu cuenta de Google ves a otros jugadores y escribís en la sala.' });
      this.d.openProfile();
      return false;
    } else if (!this.enabled) why = 'El modo online está apagado. Podés activarlo en Opciones.';
    else if (this.net.status === 'connecting') why = 'Conectando con el valle…';
    else if (this.net.status !== 'online') why = 'No pudimos conectar con el valle. Reintentamos en unos segundos.';
    else if (!this.net.chatReady) why = 'El chat no está disponible en esta sala.';
    if (why) bus.emit('toast', { text: why });
    return !why;
  }

  private sendChat(text: string): Promise<string | null> {
    if (this.simulated) {
      this.chat.add({ name: this.d.profile().name, text, mine: true });
      this.remotes.saySelf(text);
      return Promise.resolve(null);
    }
    return this.net.sendChat(text);
  }

  private localState(): { state: NetState; obj: THREE.Object3D } {
    const p = this.d.player;
    const mode: NetMode = p.flying ? 'p' : p.mode === 'onfoot' || p.mode === 'exiting' ? 'f' : 'c';
    const obj = mode === 'p' ? p.plane.mesh : mode === 'f' ? p.person.mesh : p.car.mesh;
    const speed = mode === 'p' ? p.plane.speed : mode === 'f' ? p.person.speed : p.car.speed;
    const q = obj.quaternion;
    return { obj, state: { x: obj.position.x, y: obj.position.y, z: obj.position.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, speed, mode } };
  }

  /** Una vez por cuadro, después de acomodar los modelos del jugador. */
  update(dt: number): void {
    const now = performance.now();
    const { state, obj } = this.localState();
    if (this.net.status === 'online') this.net.tick(state, now);
    this.remotes.update(dt, this.d.camera, obj.position, state.mode, now);
    this.d.hud.minimap.others = this.remotes.markers();
  }

  dispose(): void {
    this.net.stop();
    this.remotes.dispose();
  }
}
