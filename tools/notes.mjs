// Anotaciones del modo debug (?debug) desde la terminal.
//   npm run notes                         sincroniza: sube las marcas pendientes y baja todo a notes/anotaciones.json
//   npm run notes -- list [--all]         lista las notas abiertas (o todas)
//   npm run notes -- done <id> "<texto>"  marca una nota como procesada, con lo que se hizo
//   npm run notes -- reopen <id>          la vuelve a dejar abierta
// Las marcas se guardan primero en notes/procesadas.json y se suben a MongoDB en el próximo sync,
// así funcionan aunque no haya conexión con la base en ese momento.
import fs from 'node:fs';
import { ALL_FILE, readQueue, syncNotes, writeQueue } from '../server/notes-sync.mjs';

const [cmd = 'sync', ...args] = process.argv.slice(2);
const mongoUri = process.env.MONGODB_URI || undefined;

const readAll = () => { try { return JSON.parse(fs.readFileSync(ALL_FILE, 'utf8')).notes ?? []; } catch { return []; } };

async function trySync() {
  try { await syncNotes({ mongoUri }); } catch (e) { console.log(`[notas] sin conexión con la base (${e.message}); la marca quedó en notes/procesadas.json y se sube en el próximo sync.`); }
}

if (cmd === 'sync') {
  await syncNotes({ mongoUri });
} else if (cmd === 'list') {
  const all = args.includes('--all');
  const queued = new Set(readQueue().map((q) => q.id));
  const notes = readAll().filter((n) => all || (n.status !== 'procesada' && !queued.has(n.id)));
  if (!notes.length) console.log(all ? 'No hay notas.' : 'No hay notas abiertas.');
  for (const n of notes) {
    const c = n.points.reduce((a, p) => [a[0] + p[0] / n.points.length, a[1] + p[1] / n.points.length], [0, 0]);
    console.log(`- ${n.id} [${n.status}${queued.has(n.id) ? ', marcada' : ''}] ${n.category} · ${n.kind === 'polygon' ? `polígono de ${n.points.length}` : 'punto'} · ${n.town ?? 'fuera de los pueblos'} · x ${c[0].toFixed(0)} n ${c[1].toFixed(0)}\n    ${n.text.replace(/\n/g, '\n    ')}${n.resolution ? `\n    ✔ ${n.resolution}` : ''}`);
  }
} else if (cmd === 'done' || cmd === 'reopen') {
  const [id, ...rest] = args;
  if (!id) { console.error(`Uso: npm run notes -- ${cmd} <id>${cmd === 'done' ? ' "qué se hizo"' : ''}`); process.exit(1); }
  const queue = readQueue().filter((q) => q.id !== id);
  queue.push(cmd === 'done'
    ? { id, status: 'procesada', resolution: rest.join(' ').trim() || null, processedAt: new Date().toISOString() }
    : { id, status: 'abierta' });
  writeQueue(queue);
  console.log(`[notas] ${id} → ${cmd === 'done' ? 'procesada' : 'abierta'} (pendiente de subir)`);
  await trySync();
} else {
  console.error('Comandos: sync | list [--all] | done <id> "texto" | reopen <id>');
  process.exit(1);
}
