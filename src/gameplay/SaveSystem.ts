export interface SaveData {
  version: 1;
  mode: 'driving' | 'onfoot' | 'flying';
  vehicle?: 'car' | 'plane';
  car: { x: number; n: number; heading: number };
  player: { x: number; n: number };
  discovered: string[];
  quality?: string;
}

const KEY = 'calamuchita.save.v1';

/** Guardado local (por navegador). */
export const SaveSystem = {
  load(): SaveData | null {
    try {
      const s = localStorage.getItem(KEY);
      if (!s) return null;
      const d = JSON.parse(s) as SaveData;
      return d.version === 1 ? d : null;
    } catch {
      return null;
    }
  },
  save(d: SaveData): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* modo privado o almacenamiento lleno: se sigue jugando sin guardar */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nada */
    }
  },
};
