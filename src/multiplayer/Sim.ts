/** Solo desarrollo: ?mpsim=N crea N jugadores simulados cerca tuyo (sin red) para probar la vista y el chat. */
import type { WorldData } from '../world/WorldData';
import type { Online } from './Online';
import type { NetLook, NetMode } from './protocol';
import { HAIR_COLORS, HAIRSTYLES, SHIRTS, SKINS } from '../gameplay/Progress';
import { CAR_PAINTS } from '../player/Vehicle';

const NAMES = ['Luz', 'Axel', 'Mica', 'Nico', 'Fede', 'Sofi', 'Bauti', 'Cami'];
const SAYS = ['¡Hola a todos!', 'Qué lindo día para manejar por el valle', 'Alguien para ir a la Oktoberfest?', 'Me quedé sin nafta en Los Reartes jajaja', 'Buenísimo el aeroclub'];

export function startSim(online: Online, world: WorldData, count: number): void {
  online.simulated = true;
  const start = world.meta.start;
  const modes: NetMode[] = ['c', 'f', 'p', 'c', 'c', 'f', 'p', 'c'];
  const peers = Array.from({ length: count }, (_, i) => {
    const look: NetLook = {
      name: NAMES[i % NAMES.length],
      appearance: { skin: SKINS[i % 3], shirt: SHIRTS[(i + 1) % 3], hair: HAIRSTYLES[(i * 2) % HAIRSTYLES.length].id, hairColor: HAIR_COLORS[i % 3], beard: i % 2 === 1 },
      paint: CAR_PAINTS[(i + 2) % CAR_PAINTS.length].id,
    };
    const sid = `sim-${i}`;
    online.remotes.add(sid, look);
    return { sid, look, mode: modes[i % modes.length], radius: 14 + i * 9, speed: modes[i % modes.length] === 'f' ? 2.4 : modes[i % modes.length] === 'p' ? 28 : 9, phase: i * 1.3 };
  });
  online.chat.setOthers(count);
  const t0 = performance.now();
  const timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    for (const p of peers) {
      const a = p.phase + (t * p.speed) / p.radius;
      const x = start.x + Math.cos(a) * p.radius, n = start.n + Math.sin(a) * p.radius;
      const y = world.heightAt(x, n) + (p.mode === 'p' ? 60 : p.mode === 'c' ? 0.75 : 0);
      // el frente del modelo mira a +X; en Three la tangente del círculo es (-sin a, 0, -cos a)
      const heading = Math.atan2(Math.cos(a), -Math.sin(a));
      const h = heading / 2;
      online.remotes.push(p.sid, { x, y, z: -n, qx: 0, qy: Math.sin(h), qz: 0, qw: Math.cos(h), speed: p.speed, mode: p.mode });
    }
  }, 200);
  let i = 0;
  const talk = setInterval(() => {
    const p = peers[i % peers.length];
    const text = SAYS[i % SAYS.length];
    online.chat.add({ name: p.look.name, text, mine: false });
    online.remotes.say(p.sid, text);
    i++;
  }, 6000);
  (window as unknown as { __mpsim: () => void }).__mpsim = () => { clearInterval(timer); clearInterval(talk); };
}
