export type QualityLevel = 'baja' | 'media' | 'alta';

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  treeNearRadius: number;
  treeFarRadius: number;
  terrainLodDistances: [number, number, number];
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  baja: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.25), shadows: false, shadowMapSize: 1024, treeNearRadius: 200, treeFarRadius: 1400, terrainLodDistances: [450, 1000, 2200] },
  media: { pixelRatio: 1, shadows: true, shadowMapSize: 2048, treeNearRadius: 380, treeFarRadius: 2400, terrainLodDistances: [700, 1500, 3200] },
  alta: { pixelRatio: Math.min(window.devicePixelRatio, 2), shadows: true, shadowMapSize: 4096, treeNearRadius: 600, treeFarRadius: 3400, terrainLodDistances: [900, 2000, 4000] },
};

export const PHYSICS_HZ = 60;
export const FIXED_DT = 1 / PHYSICS_HZ;

/** Paleta general (tomada de la imagen de referencia). */
export const PALETTE = {
  skyTop: 0x2f7fd0,
  skyHorizon: 0xbfd9e8,
  fog: 0xa9c4cf,
  sun: 0xfff1d6,
  grass: 0x7d8f3a,
  grassDry: 0xa79a55,
  forestFloor: 0x55652e,
  dirt: 0xa88358,
  urban: 0x8f8a62,
  sand: 0xc9b58a,
  lawn: 0x6f8f35,
  rock: 0x8a8577,
  pine: 0x355a2a,
  pineLight: 0x5b7d33,
  broadleaf: 0x6d8a32,
  trunk: 0x5a3d26,
  asphalt: 0x5d5a55,
  roofTile: 0x9a4a2c,
  water: 0x4f8f8a,
};
