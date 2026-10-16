import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_ROOMS, ROOM_CAP, SEND_IDLE_MS, SEND_MOVING_MS, cleanChatLine, cleanChatText, cleanLook, decodeState, encodeState,
  type ChatLine, type NetLook, type NetState,
} from './protocol';

export type NetStatus = 'off' | 'connecting' | 'online' | 'error';

export interface NetEvents {
  status(): void;
  peerJoin(sid: string, look: NetLook): void;
  peerLook(sid: string, look: NetLook): void;
  peerLeave(sid: string): void;
  peerState(sid: string, state: NetState): void;
  chat(line: ChatLine): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Conexión con Supabase Realtime. Cada sala son dos canales privados:
 *  - vallecito:pos:N  → posiciones (broadcast) y quién está (presence)
 *  - vallecito:chat:N → solo lectura; los mensajes entran por la función send_chat
 * La identidad de cada jugador en la sala es un id al azar de la sesión: nunca se
 * comparte el id de su cuenta.
 */
export class Network {
  readonly sid = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 12);
  status: NetStatus = 'off';
  room = 0;
  readonly peers = new Map<string, NetLook>();
  on: Partial<NetEvents> = {};
  /** El canal de chat está listo para recibir. */
  chatReady = false;
  private client: SupabaseClient | null = null;
  private pos: RealtimeChannel | null = null;
  private chat: RealtimeChannel | null = null;
  private look!: NetLook;
  private token = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private lastSent = -1e9;
  private lastState: NetState | null = null;

  constructor(private paints: readonly string[]) {}

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.on.status?.();
  }

  async start(client: SupabaseClient, look: NetLook): Promise<void> {
    this.stop();
    this.client = client;
    this.look = look;
    const token = ++this.token;
    this.setStatus('connecting');
    try {
      for (let room = 1; room <= MAX_ROOMS; room++) {
        const joined = await this.join(client, room, token);
        if (token !== this.token) return;
        if (joined) { this.room = room; this.setStatus('online'); return; }
      }
      throw new Error('Todas las salas están llenas');
    } catch (error) {
      if (token !== this.token) return;
      console.warn('[vallecito] multiplayer no disponible', error);
      this.dropChannels();
      this.setStatus('error');
      this.retry = setTimeout(() => { if (token === this.token) void this.start(client, this.look); }, 20000);
    }
  }

  /** Se une a la sala; devuelve false si está llena. */
  private async join(client: SupabaseClient, room: number, token: number): Promise<boolean> {
    const pos = client.channel(`vallecito:pos:${room}`, { config: { private: true, broadcast: { self: false, ack: false }, presence: { key: this.sid } } });
    this.pos = pos;
    pos.on('broadcast', { event: 'p' }, ({ payload }) => this.onPos(payload));
    pos.on('presence', { event: 'sync' }, () => { if (token === this.token) this.syncPeers(); });
    await this.subscribe(pos, token, true);
    if (token !== this.token) return false;
    await pos.track(this.look);
    await sleep(200);
    if (token !== this.token) return false;
    if (Object.keys(pos.presenceState()).length > ROOM_CAP) {
      this.pos = null;
      void client.removeChannel(pos);
      return false;
    }
    this.syncPeers();
    // el chat no es imprescindible para ver a los demás: si falla, se sigue sin él
    const chat = client.channel(`vallecito:chat:${room}`, { config: { private: true } });
    this.chat = chat;
    chat.on('broadcast', { event: 'chat' }, ({ payload }) => {
      const line = cleanChatLine(payload, this.sid);
      if (line) this.on.chat?.(line);
    });
    try { await this.subscribe(chat, token, false); this.chatReady = true; } catch (error) { console.warn('[vallecito] chat no disponible', error); }
    return true;
  }

  private subscribe(channel: RealtimeChannel, token: number, isPos: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let first = true;
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (first) { first = false; resolve(); return; }
          // reconexión: hay que volver a anunciarse
          if (token === this.token && isPos) { void channel.track(this.look); this.setStatus('online'); }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (first) { first = false; reject(err ?? new Error(status)); }
          else if (token === this.token && isPos) this.setStatus('connecting');
        }
      });
    });
  }

  private syncPeers(): void {
    if (!this.pos) return;
    const seen = new Set<string>();
    for (const [key, metas] of Object.entries(this.pos.presenceState())) {
      if (key === this.sid || !metas.length) continue;
      const look = cleanLook(metas[metas.length - 1], this.paints);
      if (!look) continue;
      seen.add(key);
      const before = this.peers.get(key);
      this.peers.set(key, look);
      if (!before) this.on.peerJoin?.(key, look);
      else if (JSON.stringify(before) !== JSON.stringify(look)) this.on.peerLook?.(key, look);
    }
    for (const key of [...this.peers.keys()]) {
      if (seen.has(key)) continue;
      this.peers.delete(key);
      this.on.peerLeave?.(key);
    }
  }

  private onPos(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const { s, p } = payload as { s?: unknown; p?: unknown };
    if (typeof s !== 'string' || s === this.sid || !this.peers.has(s)) return;
    const state = decodeState(p);
    if (state) this.on.peerState?.(s, state);
  }

  /** Se llama en cada cuadro con tu estado; decide si toca mandarlo. */
  tick(state: NetState, now: number): void {
    const pos = this.pos;
    if (this.status !== 'online' || !pos || pos.state !== 'joined' || document.hidden) return;
    const last = this.lastState;
    const moved = !last || last.mode !== state.mode
      || Math.hypot(state.x - last.x, state.y - last.y, state.z - last.z) > 0.2
      || Math.abs(state.qx * last.qx + state.qy * last.qy + state.qz * last.qz + state.qw * last.qw) < 0.9999;
    if (now - this.lastSent < (moved ? SEND_MOVING_MS : SEND_IDLE_MS)) return;
    this.lastSent = now;
    this.lastState = state;
    void pos.send({ type: 'broadcast', event: 'p', payload: { s: this.sid, p: encodeState(state) } });
  }

  setLook(look: NetLook): void {
    this.look = look;
    if (this.pos && this.status === 'online') void this.pos.track(look);
  }

  /** Devuelve un mensaje de error para mostrar, o null si salió bien. */
  async sendChat(text: string): Promise<string | null> {
    const clean = cleanChatText(text);
    if (!clean) return null;
    if (!this.client || this.status !== 'online' || !this.room) return 'Todavía no estás conectado a una sala.';
    try {
      const { error } = await this.client.rpc('send_chat', { room: this.room, message: clean, sid: this.sid });
      if (!error) return null;
      if (/rate limit/i.test(error.message)) return 'Vas muy rápido: esperá un segundo.';
      if (/unavailable/i.test(error.message)) return 'El chat no está disponible para tu cuenta.';
      return 'No se pudo enviar el mensaje.';
    } catch {
      return 'No se pudo enviar el mensaje. Revisá tu conexión.';
    }
  }

  private dropChannels(): void {
    for (const ch of [this.pos, this.chat]) if (ch) void this.client?.removeChannel(ch);
    this.pos = this.chat = null;
    this.chatReady = false;
  }

  stop(): void {
    this.token++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.dropChannels();
    for (const key of [...this.peers.keys()]) { this.peers.delete(key); this.on.peerLeave?.(key); }
    this.room = 0;
    this.lastState = null;
    this.setStatus('off');
  }
}
