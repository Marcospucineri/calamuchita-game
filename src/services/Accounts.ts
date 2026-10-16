import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SaveSystem, type SaveData } from '../gameplay/SaveSystem';
import { newProgress } from '../gameplay/Progress';
import { distances } from './Distances';
import { analytics } from './Analytics';

class Accounts {
  client: SupabaseClient | null = null;
  user: User | null = null;
  status = 'Progreso guardado en este navegador';
  recovery = false;
  googleEnabled = false;
  authError: string | null = null;
  balance: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  private ready = false;
  private listeners = new Set<() => void>();
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((fn) => fn()); }

  async init(): Promise<void> {
    try { await this.bootstrap(); }
    catch { this.status = 'Sin conexión: tu progreso queda en este dispositivo'; }
    finally { this.ready = true; distances.init(this.client, this.user); }
  }
  private async bootstrap(): Promise<void> {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const authParams = new URLSearchParams(location.hash.slice(1));
    const failedOAuth = authParams.has('error') || new URLSearchParams(location.search).has('error');
    if (failedOAuth) this.authError = 'No se completó el ingreso con Google. Podés volver a intentarlo.';
    const oauthReturn = location.hash.includes('access_token=') || new URLSearchParams(location.search).has('code');
    this.client = createClient(url, key);
    this.client.auth.onAuthStateChange((event, session) => {
      if (this.ready && session?.user.id !== this.user?.id) {
        this.user = null; // Prevent beforeunload from writing the old account into a new session.
        setTimeout(() => location.reload(), 0);
      }
      if (event === 'PASSWORD_RECOVERY') { this.recovery = true; this.notify(); }
    });
    const [{ data, error }, settings] = await Promise.all([
      this.client.auth.getSession(),
      fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    this.googleEnabled = settings?.external?.google === true;
    if (failedOAuth) history.replaceState(null, '', location.pathname);
    if (error) { this.status = 'No pudimos conectar la cuenta. Podés jugar sin conexión.'; return; }
    this.user = data.session?.user ?? null;
    if (!this.user) return;
    const guest = SaveSystem.load();
    SaveSystem.setScope(this.user.id);
    const local = SaveSystem.load();
    const { data: row, error: loadError } = await this.client.from('player_progress').select('save,balance').eq('user_id', this.user.id).maybeSingle();
    if (loadError) { this.status = 'Sin conexión: tu progreso queda en este dispositivo'; return; }
    this.balance = row?.balance ?? 0;
    // The guest save is consumed once on this browser. Account caches are isolated.
    const cloud = row?.save as SaveData | undefined;
    const base = local && (local.savedAt ?? 0) >= (cloud?.savedAt ?? 0) ? local : cloud ?? local ?? guest;
    if (base) {
      const merged: SaveData = { ...base, discovered: [...new Set([...(row?.save?.discovered ?? []), ...(local?.discovered ?? []), ...(guest?.discovered ?? [])])] };
      const trips = [...(row?.save?.progress?.trips ?? []), ...(local?.progress?.trips ?? []), ...(guest?.progress?.trips ?? [])];
      merged.progress ??= guest?.progress ?? newProgress();
      merged.progress.photos = [...new Set([...(cloud?.progress?.photos ?? []), ...(local?.progress?.photos ?? []), ...(guest?.progress?.photos ?? [])])];
      merged.progress.trips = [...new Map(trips.map((t) => [t.id, t])).values()];
      SaveSystem.save(merged);
      await this.sync(merged);
      if (this.status === 'Progreso guardado en tu cuenta' && guest) {
        SaveSystem.setScope(null); SaveSystem.clear(); SaveSystem.setScope(this.user.id);
      }
    } else this.status = 'Progreso guardado en tu cuenta';
    if (oauthReturn && this.user.app_metadata.provider === 'google') {
      const created = Date.parse(this.user.created_at);
      analytics.event(Date.now() - created < 60000 ? 'sign_up' : 'login', { method: 'google' });
    }
  }

  sync(save: SaveData): Promise<void> {
    if (!this.client || !this.user) return Promise.resolve();
    const snapshot = structuredClone(save);
    const revision = ++this.revision;
    this.queue = this.queue.then(async () => {
      const { data, error } = await this.client!.rpc('sync_progress', { incoming: snapshot });
      if (error) this.status = 'Sin conexión: tu progreso queda en este dispositivo';
      else {
        this.balance = data.balance;
        // A stale response must never replace newer local movement or profile edits.
        if (revision === this.revision) SaveSystem.save(data.save);
        this.status = 'Progreso guardado en tu cuenta';
      }
      this.notify();
    }).catch(() => { this.status = 'No se pudo sincronizar. Se reintentará al guardar.'; this.notify(); });
    return this.queue;
  }
  async startTrip(id: string, routeId: string): Promise<boolean> {
    if (!this.client || !this.user) return true;
    try {
      const { error } = await this.client.rpc('start_hitchhike', { trip_id: id, route_id: routeId });
      return !error;
    } catch { return false; }
  }
  async signOut(): Promise<void> {
    await distances.flush();
    await this.queue;
    const result = await this.client?.auth.signOut();
    if (result?.error) throw result.error;
    location.href = location.pathname;
  }
}
export const accounts = new Accounts();
