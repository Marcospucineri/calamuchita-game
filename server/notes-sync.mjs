// Sincroniza las anotaciones del modo debug con los archivos del proyecto:
//  1. Aplica las marcas pendientes de notes/procesadas.json (estado "procesada" + qué se hizo).
//  2. Baja todas las notas a notes/anotaciones.json.
// Así las correcciones se pueden leer y marcar desde archivos, aunque no haya conexión directa con MongoDB.
import fs from 'node:fs';
import path from 'node:path';
import { openStore, validatePatch } from './notes-api.mjs';

export const NOTES_DIR = 'notes';
export const ALL_FILE = path.join(NOTES_DIR, 'anotaciones.json');
export const QUEUE_FILE = path.join(NOTES_DIR, 'procesadas.json');

export function readQueue(root = process.cwd()) {
  try { return JSON.parse(fs.readFileSync(path.join(root, QUEUE_FILE), 'utf8')).pendientes ?? []; } catch { return []; }
}

export function writeQueue(items, root = process.cwd()) {
  const f = path.join(root, QUEUE_FILE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({
    _info: 'Marcas de notas ya procesadas que todavía no se subieron a la base. Se aplican con "npm run notes" (o al arrancar "npm run dev").',
    pendientes: items,
  }, null, 2) + '\n');
}

/** @returns {Promise<{ applied: number, failed: string[], total: number, open: number }>} */
export async function syncNotes({ mongoUri, root = process.cwd(), log = console.log }) {
  // sin MongoDB, la base ES notes/anotaciones.json: se marca directo ahí
  const store = openStore({ mongoUri, file: path.join(root, ALL_FILE) });
  const failed = [];
  let applied = 0;
  try {
    const queue = readQueue(root);
    const left = [];
    for (const item of queue) {
      try {
        const patch = validatePatch({ status: item.status ?? 'procesada', resolution: item.resolution, processedAt: item.processedAt });
        const ok = await store.update(item.id, patch);
        if (ok) applied++; else { failed.push(`${item.id} (no existe)`); }
      } catch (e) {
        failed.push(`${item.id} (${e.message})`);
        left.push(item);
      }
    }
    if (queue.length) writeQueue(left, root);
    const notes = await store.list();
    if (mongoUri) {
      const f = path.join(root, ALL_FILE);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ _info: 'Copia de las anotaciones de MongoDB (npm run notes). No editar a mano: marcá con "node tools/notes.mjs done".', syncedAt: new Date().toISOString(), notes }, null, 2) + '\n');
    }
    const open = notes.filter((n) => n.status !== 'procesada').length;
    log(`[notas] ${applied ? `${applied} marcadas como procesadas · ` : ''}${notes.length} anotaciones (${open} abiertas) → ${ALL_FILE}${failed.length ? ` · con problemas: ${failed.join(', ')}` : ''}`);
    return { applied, failed, total: notes.length, open };
  } finally {
    await store.close();
  }
}
