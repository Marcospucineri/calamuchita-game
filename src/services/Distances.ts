import type { SupabaseClient, User } from '@supabase/supabase-js';

export type TravelCategory = 'car' | 'plane' | 'foot';
export interface DistanceSession { id: string; seconds: number; car: number; plane: number; foot: number }
export interface RankingRow { position: number | null; name: string; meters: number; is_me: boolean }
export const TRAVEL_CATEGORIES: { id: TravelCategory; label: string }[] = [
  { id: 'car', label: 'Auto' }, { id: 'plane', label: 'Avioneta' }, { id: 'foot', label: 'A pie' },
];
// Generous limits above normal gameplay speed; resets and teleports are excluded.
const LIMITS = { car: 85, plane: 100, foot: 10 };
export function traveledMeters(category: TravelCategory, dt: number, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number {
  if (!Number.isFinite(dt) || dt <= 0 || dt > .25) return 0;
  const d = Math.hypot(to.x - from.x, to.z - from.z, category === 'plane' ? to.y - from.y : 0);
  return Number.isFinite(d) && d > .001 && d <= LIMITS[category] * dt + .02 ? d : 0;
}

class Distances {
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private session: DistanceSession | null = null;
  private flushing: Promise<boolean> | null = null;
  private prefix = '';
  init(client: SupabaseClient | null, user: User | null): void {
    this.client = client; this.userId = user?.id ?? null;
    if (!client || !user) return;
    this.prefix = `vallecito.distance.${user.id}.`;
    this.session = { id: crypto.randomUUID(), seconds: 0, car: 0, plane: 0, foot: 0 };
    this.persist();
    void this.flush();
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.persist(); void this.flush(); } });
    window.addEventListener('pagehide', () => this.persist());
  }
  record(category: TravelCategory, dt: number, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void {
    if (!this.userId || !this.session || document.hidden || !Number.isFinite(dt) || dt <= 0 || dt > .25) return;
    this.session.seconds += dt;
    this.session[category] += traveledMeters(category, dt, from, to);
  }
  persist(): void {
    if (!this.session) return;
    try { localStorage.setItem(this.prefix + this.session.id, JSON.stringify(this.session)); } catch { /* Continue without persistent storage. */ }
  }
  flush(): Promise<boolean> {
    this.persist();
    if (!this.client || !this.userId) return Promise.resolve(false);
    if (this.flushing) return this.flushing;
    this.flushing = this.send().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private async send(): Promise<boolean> {
    const pending: DistanceSession[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith(this.prefix)) {
          try { pending.push(JSON.parse(localStorage.getItem(key)!)); } catch { /* Ignore damaged local records. */ }
        }
      }
    } catch { /* Private mode: still send the current session. */ }
    if (this.session && !pending.some((s) => s.id === this.session!.id)) pending.push({ ...this.session });
    let ok = true;
    for (const snapshot of pending) {
      try {
        const { error } = await this.client!.rpc('record_distance', { session_id: snapshot.id, active_seconds: snapshot.seconds, car_meters: snapshot.car, plane_meters: snapshot.plane, foot_meters: snapshot.foot });
        if (error) {
          // If this session began offline, establish its server clock now so
          // retained snapshots can be retried later instead of resetting it forever.
          if (error.message.includes('Implausible distance')) await this.client!.rpc('record_distance', { session_id: snapshot.id, active_seconds: 0, car_meters: 0, plane_meters: 0, foot_meters: 0 });
          ok = false; continue;
        }
        // Never erase a newer unsent snapshot, including one from before pagehide.
        if (localStorage.getItem(this.prefix + snapshot.id) === JSON.stringify(snapshot)) localStorage.removeItem(this.prefix + snapshot.id);
      } catch { ok = false; }
    }
    return ok;
  }
  async ranking(category: TravelCategory): Promise<RankingRow[]> {
    if (!this.client || !this.userId) throw new Error('Iniciá sesión para ver el ranking.');
    const { data, error } = await this.client.rpc('distance_ranking', { category });
    if (error) throw new Error('No pudimos cargar el ranking. Volvé a intentar.');
    return data as RankingRow[];
  }
}
export const distances = new Distances();
