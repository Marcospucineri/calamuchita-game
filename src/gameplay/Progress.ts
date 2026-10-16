/** Shared rules: Serranos only reward completed activities; no passive coin pickups. */
export const HAIRSTYLES = [
  { id: 'rapado', label: 'Rapado' },
  { id: 'corto', label: 'Corto' },
  { id: 'rodete', label: 'Rodete' },
  { id: 'rulos-largos', label: 'Rulos largos' },
  { id: 'media-melena', label: 'Casi a los hombros' },
  { id: 'largo-lacio', label: 'Largo lacio' },
] as const;
export type HairStyle = typeof HAIRSTYLES[number]['id'];

export interface Appearance {
  skin: string;
  shirt: string;
  hair: HairStyle;
  hairColor: string;
  beard: boolean;
}
export interface Profile { name: string; appearance: Appearance }
export interface TripReceipt { id: string; routeId: string; startedAt: number; completedAt: number }
export interface Progress {
  profile: Profile;
  trips: TripReceipt[];
  photos?: string[];
  activeTrip?: { id: string; routeId: string; startedAt: number; distance: number };
}
export const DEFAULT_PROFILE: Profile = {
  name: 'Visitante',
  appearance: { skin: '#c79061', shirt: '#191e1c', hair: 'rapado', hairColor: '#392a1f', beard: false },
};
const NAME_KEY = 'calamuchita.name';
/** Nombre escrito en la pantalla de inicio (vale aunque todavía no haya partida guardada). */
export function storedName(): string {
  try { return (localStorage.getItem(NAME_KEY) ?? '').trim().slice(0, 24); } catch { return ''; }
}
export function storeName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name.trim().slice(0, 24)); } catch { /* sin almacenamiento */ }
}
export const SKINS = ['#f2c7a5', '#c79061', '#754a35'];
export const SHIRTS = ['#191e1c', '#a63f26', '#2f5c40'];
export const HAIR_COLORS = ['#392a1f', '#ba7941', '#c7bba5'];
export function newProgress(): Progress {
  return { profile: structuredClone(DEFAULT_PROFILE), trips: [] };
}
export function tripReward(distance: number): number {
  return Math.max(20, Math.min(60, 20 + Math.floor(distance / 1000) * 10));
}
export function postalRewards(pois: { id: string; town: string | null }[], discovered: string[]): number {
  const found = new Set(discovered);
  const towns = new Set(pois.map((p) => p.town).filter((t): t is string => !!t));
  return pois.filter((p) => found.has(p.id)).length * 50 + [...towns].filter((town) =>
    pois.filter((p) => p.town === town).every((p) => found.has(p.id))).length * 200;
}
export function normalizeProfile(profile?: Profile): Profile {
  const a = profile?.appearance;
  return {
    name: (profile?.name ?? '').trim().slice(0, 24) || 'Visitante',
    appearance: {
      skin: SKINS.includes(a?.skin ?? '') ? a!.skin : DEFAULT_PROFILE.appearance.skin,
      shirt: SHIRTS.includes(a?.shirt ?? '') ? a!.shirt : DEFAULT_PROFILE.appearance.shirt,
      hair: HAIRSTYLES.some((style) => style.id === a?.hair) ? a!.hair : 'rapado',
      hairColor: HAIR_COLORS.includes(a?.hairColor ?? '') ? a!.hairColor : DEFAULT_PROFILE.appearance.hairColor,
      beard: a?.beard === true,
    },
  };
}
