/** Approximate solar position from NOAA, independent of the device timezone.
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Three coordinates: +X east, +Y up, -Z north. */
export interface Daylight { hour: number; day: number; night: number; twilight: number; elevation: number; sun: { x: number; y: number; z: number } }
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const RAD = Math.PI / 180;
export function daylightAt(date = new Date(), latitude = -31.9765, longitude = -64.559): Daylight {
  const argentina = new Date(date.getTime() - 3 * 3600000);
  const hour = argentina.getUTCHours() + argentina.getUTCMinutes() / 60 + argentina.getUTCSeconds() / 3600;
  const year = date.getUTCFullYear();
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  const doy = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / days * (doy - 1 + (utc - 12) / 24);
  const equation = 229.18 * (.000075 + .001868 * Math.cos(gamma) - .032077 * Math.sin(gamma) - .014615 * Math.cos(2 * gamma) - .040849 * Math.sin(2 * gamma));
  const decl = .006918 - .399912 * Math.cos(gamma) + .070257 * Math.sin(gamma) - .006758 * Math.cos(2 * gamma) + .000907 * Math.sin(2 * gamma) - .002697 * Math.cos(3 * gamma) + .00148 * Math.sin(3 * gamma);
  const solarMinutes = ((utc * 60 + equation + 4 * longitude) % 1440 + 1440) % 1440;
  const angle = (solarMinutes / 4 - 180) * RAD, lat = latitude * RAD;
  const east = -Math.cos(decl) * Math.sin(angle);
  const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(angle);
  const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(angle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, up))) / RAD;
  const day = smooth(-6, 4, elevation);
  return { hour, day, night: 1 - day, twilight: smooth(-8, 0, elevation) * (1 - smooth(5, 16, elevation)), elevation, sun: { x: east, y: up, z: -north } };
}
/** Development/test preview of a GMT−3 hour on the supplied local calendar date. */
export function daylightForHour(hour: number, reference = new Date(), latitude = -31.9765, longitude = -64.559): Daylight {
  const local = new Date(reference.getTime() - 3 * 3600000);
  const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3);
  return daylightAt(new Date(base + hour * 3600000), latitude, longitude);
}
