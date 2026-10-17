/**
 * Reglas y formato de los mensajes del multiplayer. Todo lo que llega de la red se
 * valida acá: un cliente modificado no puede mandar nombres larguísimos, posiciones
 * fuera del mapa ni colores inventados.
 */
import { normalizeProfile, type Appearance, type Profile } from '../gameplay/Progress';

/** Jugadores por sala. Con más, se pasa a la sala siguiente. */
export const ROOM_CAP = 12;
export const MAX_ROOMS = 30;
/** Intervalo de envío: en movimiento y quieto (latido para que no te den por ido). */
export const SEND_MOVING_MS = 200;
export const SEND_IDLE_MS = 1200;
/** Retraso con el que se dibuja a los demás: deja suavizar entre dos paquetes. */
export const INTERP_DELAY_MS = 260;
/** Sin noticias de alguien en este tiempo, se lo oculta. */
export const STALE_MS = 15000;
export const CHAT_MAX = 120;

/** c = auto, f = a pie, p = avioneta. */
export type NetMode = 'c' | 'f' | 'p' | 'd' | 'h';
const MODES: NetMode[] = ['c', 'f', 'p', 'd', 'h'];

export interface NetState { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; speed: number; mode: NetMode }
export interface NetLook { name: string; appearance: Appearance; paint: string }
export interface ChatLine { name: string; text: string; sid: string; at: number; mine: boolean }

const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;

export function encodeState(s: NetState): number[] {
  return [round(s.x, 2), round(s.y, 2), round(s.z, 2), round(s.qx, 3), round(s.qy, 3), round(s.qz, 3), round(s.qw, 3), round(s.speed, 1), MODES.indexOf(s.mode)];
}

export function decodeState(raw: unknown): NetState | null {
  if (!Array.isArray(raw) || raw.length !== 9) return null;
  for (const v of raw) if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const [x, y, z, qx, qy, qz, qw, speed, m] = raw as number[];
  if (Math.abs(x) > 40000 || Math.abs(z) > 40000 || y < -200 || y > 6000 || Math.abs(speed) > 150) return null;
  const len = Math.hypot(qx, qy, qz, qw);
  if (len < 0.9 || len > 1.1) return null;
  const mode = MODES[m];
  if (!mode) return null;
  return { x, y, z, qx: qx / len, qy: qy / len, qz: qz / len, qw: qw / len, speed, mode };
}

/** Quita caracteres de control y de dirección de texto (que pueden dar vuelta una frase). */
function plain(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

export function cleanName(raw: unknown): string {
  return plain(raw).slice(0, 24) || 'Visitante';
}

export function cleanChatText(raw: unknown): string {
  return plain(raw).slice(0, CHAT_MAX);
}

export function cleanLook(raw: unknown, paints: readonly string[]): NetLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const profile = normalizeProfile({ name: cleanName(o.name), appearance: o.appearance as Appearance } as Profile);
  return { name: profile.name, appearance: profile.appearance, paint: typeof o.paint === 'string' && paints.includes(o.paint) ? o.paint : paints[0] };
}

/** Mensaje de chat recibido, ya validado. */
export function cleanChatLine(raw: unknown, mySid: string): ChatLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = cleanChatText(o.text);
  if (!text) return null;
  const sid = typeof o.sid === 'string' ? o.sid.slice(0, 40) : '';
  return { name: cleanName(o.name), text, sid, at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(), mine: sid !== '' && sid === mySid };
}
