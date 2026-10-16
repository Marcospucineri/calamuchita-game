import * as THREE from 'three';
import routes from './routes.json';
import { createAvatar } from '../player/Character';
import { DEFAULT_PROFILE, tripReward, type Progress } from './Progress';
import type { WorldData } from '../world/WorldData';
import { bus } from '../core/EventBus';
import { accounts } from '../services/Accounts';
import { analytics } from '../services/Analytics';

export type Route = typeof routes[number];
export class Hitchhikers {
  private people = new Map<string, THREE.Group>();
  private cooldown = new Map<string, number>();
  private marker = new THREE.Group();
  private time = 0;
  private moving = new THREE.Vector2();
  private last: THREE.Vector2 | null = null;
  private pending: Route | null = null;
  private pickingUp = false;
  private canPick = false;
  onChange: (() => void) | null = null;

  constructor(private world: WorldData, scene: THREE.Scene, readonly progress: Progress) {
    routes.forEach((r, i) => {
      const { mesh, arms } = createAvatar({ ...DEFAULT_PROFILE.appearance, shirt: ['#a63f26', '#2f5c40', '#191e1c'][i % 3], hair: i % 2 ? 'rodete' : 'corto' });
      mesh.position.set(r.x, world.heightAt(r.x, r.n), -r.n);
      mesh.rotation.y = -r.heading;
      arms[0].rotation.z = -1.7;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.4, 0.06), new THREE.MeshToonMaterial({ color: 0xf3e7c8 }));
      sign.position.set(0.3, 1.05, -0.5);
      mesh.add(sign);
      scene.add(mesh);
      this.people.set(r.id, mesh);
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.35, 6, 32), new THREE.MeshBasicMaterial({ color: 0xe0a83a }));
    ring.rotation.x = Math.PI / 2;
    this.marker.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe0a83a }));
    pole.position.y = 4;
    this.marker.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.4, 0.12), new THREE.MeshBasicMaterial({ color: 0x24452f }));
    flag.position.set(1.2, 7.2, 0);
    this.marker.add(flag);
    scene.add(this.marker);
    this.marker.visible = false;
  }
  get active(): Route | null { return routes.find((r) => r.id === this.progress.activeTrip?.routeId) ?? null; }
  get candidate(): Route | null { return this.pending; }

  update(dt: number, x: number, n: number, speed: number, driving: boolean): string | null {
    this.time += dt;
    const active = this.active;
    this.pending = null;
    this.canPick = false;
    this.people.forEach((mesh, id) => { mesh.visible = !active && (this.cooldown.get(id) ?? 0) < this.time; });
    this.marker.visible = !!active;
    if (active) {
      this.people.get(active.id)!.visible = false;
      this.marker.position.set(active.destX, this.world.heightAt(active.destX, active.destN) + 0.8, -active.destN);
      this.moving.set(x, n);
      if (driving && this.last) {
        const d = this.last.distanceTo(this.moving);
        if (d < Math.max(15, dt * 65)) this.progress.activeTrip!.distance += d;
        else this.cancel('El pasajero sigue por su cuenta', 'Los viajes rápidos no cuentan como traslado.');
      }
      this.last = this.moving.clone();
      if (!this.active) return null;
      const distance = Math.hypot(x - active.destX, n - active.destN);
      if (distance < 35 && driving && Math.abs(speed) < 1.5) {
        const trip = this.progress.activeTrip!;
        // Driving the route is required; arriving through teleportation never pays.
        if (trip.distance >= active.distance * 0.8 && Date.now() - trip.startedAt >= active.distance / 55 * 1000) {
          this.progress.trips.push({ id: trip.id, routeId: active.id, startedAt: trip.startedAt, completedAt: Date.now() });
          delete this.progress.activeTrip;
          this.last = null;
          this.cooldown.set(active.id, this.time + 60);
          const value = tripReward(active.distance);
          bus.emit('toast', { text: `+${value} Serranos · Gracias por acercarme`, sub: ['El paisaje venía incluido.', 'Te debo una. Y acá las deudas se saludan en la plaza.', 'Llegamos antes que el pronóstico de lluvia.'][Math.floor(Math.random() * 3)] });
          analytics.event('activity_complete', { activity: 'hitchhike', route_id: active.id, place: active.destination });
          analytics.event('earn_virtual_currency', { virtual_currency_name: 'Serranos', value, source: 'hitchhike' });
          this.onChange?.();
        }
      }
      return `${active.name} → ${active.destination} · ${distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`} · Frená para dejarle`;
    }
    this.last = null;
    if (!driving) return null;
    this.pending = routes.find((r) => (this.cooldown.get(r.id) ?? 0) < this.time && Math.hypot(r.x - x, r.n - n) < 18) ?? null;
    if (!this.pending) return null;
    this.canPick = Math.abs(speed) < 1.5;
    return this.canPick ? `${this.pending.name} hace dedo. ¿Le acercás a ${this.pending.destination}?` : 'Hay alguien haciendo dedo · Frená para acercarle';
  }
  async pickup(): Promise<void> {
    if (!this.pending || !this.canPick || this.active || this.pickingUp) return;
    const r = this.pending;
    const id = crypto.randomUUID();
    this.pickingUp = true;
    let connected = false;
    try { connected = await accounts.startTrip(id, r.id); } finally { this.pickingUp = false; }
    if (!connected) {
      bus.emit('toast', { text: 'No se pudo registrar el viaje', sub: 'Volvé a intentar cuando tengas conexión. Tu progreso sigue guardado acá.' });
      return;
    }
    if (this.pending?.id !== r.id || !this.canPick) return;
    this.progress.activeTrip = { id, routeId: r.id, startedAt: Date.now(), distance: 0 };
    this.last = null;
    bus.emit('toast', { text: `¿Me llevás a ${r.destination}?`, sub: `${r.name} se subió · ${tripReward(r.distance)} Serranos al llegar. El destino está en el mapa.` });
    this.onChange?.();
  }
  cancel(text = 'Viaje cancelado', sub = 'El pasajero vuelve a esperar junto a la ruta.'): void {
    if (!this.active) return;
    delete this.progress.activeTrip;
    this.last = null;
    bus.emit('toast', { text, sub });
    this.onChange?.();
  }
  balance(): number {
    return this.progress.trips.reduce((sum, trip) => {
      const r = routes.find((route) => route.id === trip.routeId);
      return sum + (r ? tripReward(r.distance) : 0);
    }, 0);
  }
}
