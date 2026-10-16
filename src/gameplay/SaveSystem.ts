import type { Progress } from './Progress';

export interface SaveData {
  version: 1;
  mode: 'driving' | 'onfoot' | 'flying';
  vehicle?: 'car' | 'plane';
  car: { x: number; n: number; heading: number };
  player: { x: number; n: number };
  discovered: string[];
  savedAt?: number;
  quality?: string;
  paint?: string;
  progress?: Progress;
}

const KEY = 'calamuchita.save.v1';
let scope: string | null = null;
const key = () => scope ? `${KEY}.${scope}` : KEY;

/** Guardado local (por navegador). */
export const SaveSystem = {
  setScope(userId: string | null): void { scope = userId; },
  load(): SaveData | null {
    try {
      const s = localStorage.getItem(key());
      if (!s) return null;
      const d = JSON.parse(s) as SaveData;
      return d.version === 1 ? d : null;
    } catch {
      return null;
    }
  },
  save(d: SaveData): void {
    try {
      localStorage.setItem(key(), JSON.stringify(d));
    } catch {
      /* modo privado o almacenamiento lleno: se sigue jugando sin guardar */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(key());
    } catch {
      /* nada */
    }
  },
};
