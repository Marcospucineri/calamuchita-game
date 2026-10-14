/** Anotaciones del modo debug y su guardado (API del servidor o, si no hay, el navegador). */

export const CATEGORIES = [
  { id: 'plaza', label: 'Plaza', color: '#3f9a4a' },
  { id: 'edificio', label: 'Edificio', color: '#c0703a' },
  { id: 'calle', label: 'Calle / ruta', color: '#d9a21f' },
  { id: 'vegetacion', label: 'Vegetación', color: '#5b8f2e' },
  { id: 'agua', label: 'Agua / río', color: '#2f7fb8' },
  { id: 'hito', label: 'Hito', color: '#8a4fb0' },
  { id: 'error', label: 'Error', color: '#d23a2a' },
  { id: 'otro', label: 'Otro', color: '#5a6470' },
] as const;
export type Category = (typeof CATEGORIES)[number]['id'];
export const catOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

export interface Note {
  id: string;
  kind: 'point' | 'polygon';
  /** [x (Este), n (Norte), y (altura)] en metros, coordenadas del juego (origen en el centro de VGB). */
  points: number[][];
  lonlat?: number[][] | null;
  category: Category;
  text: string;
  town?: string | null;
  /** abierta = pendiente; procesada = la corrección ya se hizo en el juego (ver resolution). */
  status: 'abierta' | 'procesada';
  resolution?: string | null;
  processedAt?: string | null;
  camera?: { x: number; y: number; z: number; yaw: number; pitch: number } | null;
  createdAt: string;
  updatedAt?: string;
}
export type NewNote = Omit<Note, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'resolution' | 'processedAt'>;

const TOKEN_KEY = 'calamuchita.debugToken';
const LOCAL_KEY = 'calamuchita.notes.local';

export type ConnectResult = { ok: true; where: string } | { ok: false; reason: 'token' | 'disabled' | 'offline'; message: string };

export class NotesClient {
  mode: 'server' | 'local' = 'local';
  where = 'navegador';
  private token = '';

  constructor() {
    try { this.token = localStorage.getItem(TOKEN_KEY) ?? ''; } catch { /* sin almacenamiento */ }
  }

  setToken(t: string): void {
    this.token = t.trim();
    try { localStorage.setItem(TOKEN_KEY, this.token); } catch { /* nada */ }
  }

  private url(id = ''): string {
    return `${import.meta.env.BASE_URL}api/notes${id ? '/' + encodeURIComponent(id) : ''}`;
  }

  private async req(method: string, id = '', body?: unknown): Promise<Response> {
    return fetch(this.url(id), {
      method,
      headers: { 'Content-Type': 'application/json', 'x-debug-token': this.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Prueba el servidor; si no hay API, trabaja en el navegador. */
  async connect(): Promise<ConnectResult> {
    try {
      const r = await this.req('GET');
      const type = r.headers.get('content-type') ?? '';
      if (r.status === 401) return { ok: false, reason: 'token', message: 'Ingresá el token de debug para guardar en el servidor.' };
      if (r.status === 403) { this.useLocal(); return { ok: false, reason: 'disabled', message: (await r.json().catch(() => ({}))).error ?? 'API apagada.' }; }
      if (!r.ok || !type.includes('json')) { this.useLocal(); return { ok: false, reason: 'offline', message: 'Sin API de notas: se guardan en este navegador (exportalas).' }; }
      const data = await r.json();
      this.mode = 'server';
      this.where = data.store === 'mongo' ? 'MongoDB' : 'archivo del proyecto';
      return { ok: true, where: this.where };
    } catch {
      this.useLocal();
      return { ok: false, reason: 'offline', message: 'Sin conexión con la API: se guardan en este navegador.' };
    }
  }

  private useLocal(): void { this.mode = 'local'; this.where = 'navegador'; }

  private readLocal(): Note[] {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]'); } catch { return []; }
  }
  private writeLocal(notes: Note[]): void {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(notes)); } catch { /* nada */ }
  }

  private async json<T>(r: Response): Promise<T> {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as { error?: string }).error ?? `Error ${r.status}`);
    return data as T;
  }

  async list(): Promise<Note[]> {
    if (this.mode === 'local') return this.readLocal().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return (await this.json<{ notes: Note[] }>(await this.req('GET'))).notes;
  }

  async create(n: NewNote): Promise<Note> {
    if (this.mode === 'local') {
      const note: Note = { ...n, id: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, status: 'abierta', createdAt: new Date().toISOString() };
      this.writeLocal([...this.readLocal(), note]);
      return note;
    }
    return this.json<Note>(await this.req('POST', '', n));
  }

  async update(id: string, patch: Partial<Pick<Note, 'text' | 'category' | 'status' | 'resolution'>>): Promise<Note> {
    if (this.mode === 'local') {
      const notes = this.readLocal();
      const i = notes.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('No existe esa nota.');
      const now = new Date().toISOString();
      const extra = patch.status === 'procesada' ? { processedAt: now } : patch.status === 'abierta' ? { processedAt: null, resolution: null } : {};
      notes[i] = { ...notes[i], ...patch, ...extra, updatedAt: now };
      this.writeLocal(notes);
      return notes[i];
    }
    return this.json<Note>(await this.req('PATCH', id, patch));
  }

  async remove(id: string): Promise<void> {
    if (this.mode === 'local') { this.writeLocal(this.readLocal().filter((x) => x.id !== id)); return; }
    await this.json(await this.req('DELETE', id));
  }
}
