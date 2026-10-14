// API de anotaciones del modo debug (/api/notes).
// - Con MONGODB_URI guarda en MongoDB Atlas (base "calamuchita", colección "notes").
// - Sin MONGODB_URI guarda en un archivo JSON del proyecto (notes/anotaciones.json).
// - Con DEBUG_TOKEN exige el encabezado "x-debug-token". En producción (Railway) sin token la API queda apagada.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_BODY = 200_000;
const CATEGORIES = ['plaza', 'edificio', 'calle', 'vegetacion', 'agua', 'hito', 'error', 'otro'];
const STATUSES = ['abierta', 'procesada'];

/**
 * @param {{ mongoUri?: string, dbName?: string, token?: string, file: string, requireToken?: boolean }} opts
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean>}
 *   Devuelve true si atendió el pedido.
 */
export function createNotesApi(opts) {
  const store = openStore(opts);
  const where = opts.mongoUri ? 'MongoDB' : `archivo ${path.relative(process.cwd(), opts.file)}`;
  console.log(`[notas] guardando en ${where}${opts.token ? ' (con token)' : opts.requireToken ? ' — API apagada: falta DEBUG_TOKEN' : ''}`);

  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/notes')) return false;
    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (!opts.token && opts.requireToken) { send(403, { error: 'La API de notas está apagada: configurá DEBUG_TOKEN.' }); return true; }
    if (opts.token && !safeEqual(String(req.headers['x-debug-token'] ?? ''), opts.token)) { send(401, { error: 'Token de debug inválido.' }); return true; }

    const id = decodeURIComponent(url.pathname.slice('/api/notes'.length).replace(/^\//, ''));
    try {
      if (req.method === 'GET' && !id) { send(200, { store: opts.mongoUri ? 'mongo' : 'archivo', notes: await store.list() }); return true; }
      if (req.method === 'POST' && !id) {
        const note = validateNew(await readJson(req));
        send(201, await store.create(note));
        return true;
      }
      if (req.method === 'PATCH' && id) {
        const patch = validatePatch(await readJson(req));
        const out = await store.update(id, patch);
        if (out) send(200, out); else send(404, { error: 'No existe esa nota.' });
        return true;
      }
      if (req.method === 'DELETE' && id) {
        if (await store.remove(id)) send(200, { ok: true }); else send(404, { error: 'No existe esa nota.' });
        return true;
      }
      send(405, { error: 'Método no permitido.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      send(e?.status ?? 500, { error: msg });
      if (!e?.status) console.error('[notas]', e);
    }
    return true;
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function bad(message) { const e = new Error(message); e.status = 400; return e; }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(bad('El pedido es demasiado grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(bad('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

function validateNew(b) {
  if (!b || typeof b !== 'object') throw bad('Falta la nota.');
  if (b.kind !== 'point' && b.kind !== 'polygon') throw bad('kind tiene que ser "point" o "polygon".');
  const pts = Array.isArray(b.points) ? b.points : [];
  const need = b.kind === 'point' ? 1 : 3;
  if (pts.length < need || pts.length > 300 || !pts.every((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 3).every(num))) throw bad('Puntos inválidos.');
  const points = pts.map((p) => p.slice(0, 3).map((v) => Math.round(v * 10) / 10));
  const lonlat = Array.isArray(b.lonlat) && b.lonlat.length === pts.length && b.lonlat.every((p) => Array.isArray(p) && p.length === 2 && p.every(num))
    ? b.lonlat.map(([lon, lat]) => [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]) : null;
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 4000) : '';
  if (!text) throw bad('Escribí la observación.');
  const now = new Date().toISOString();
  return {
    kind: b.kind,
    points,
    lonlat,
    // GeoJSON en lon/lat para ubicar la nota en cualquier mapa
    geometry: lonlat ? (b.kind === 'point' ? { type: 'Point', coordinates: lonlat[0] } : { type: 'Polygon', coordinates: [[...lonlat, lonlat[0]]] }) : null,
    category: CATEGORIES.includes(b.category) ? b.category : 'otro',
    text,
    town: typeof b.town === 'string' ? b.town.slice(0, 80) : null,
    camera: b.camera && typeof b.camera === 'object' && ['x', 'y', 'z', 'yaw', 'pitch'].every((k) => num(b.camera[k]))
      ? Object.fromEntries(['x', 'y', 'z', 'yaw', 'pitch'].map((k) => [k, Math.round(b.camera[k] * 100) / 100])) : null,
    status: 'abierta',
    createdAt: now,
    updatedAt: now,
  };
}

/** Almacén de notas: MongoDB si hay URI, si no el archivo JSON. */
export function openStore(opts) {
  return opts.mongoUri ? mongoStore(opts.mongoUri, opts.dbName ?? 'calamuchita') : fileStore(opts.file);
}

export function validatePatch(b) {
  const out = {};
  if (typeof b?.text === 'string') { const t = b.text.trim().slice(0, 4000); if (!t) throw bad('La observación no puede quedar vacía.'); out.text = t; }
  if (typeof b?.category === 'string') out.category = CATEGORIES.includes(b.category) ? b.category : 'otro';
  if (typeof b?.status === 'string') {
    if (!STATUSES.includes(b.status)) throw bad('Estado inválido.');
    out.status = b.status;
    // procesada = ya se aplicó la corrección en el juego (con lo que se hizo); reabrir la vuelve a dejar pendiente
    if (b.status === 'procesada') out.processedAt = typeof b.processedAt === 'string' ? b.processedAt : new Date().toISOString();
    else { out.processedAt = null; out.resolution = null; }
  }
  if (typeof b?.resolution === 'string' && out.status !== 'abierta') out.resolution = b.resolution.trim().slice(0, 2000) || null;
  if (!Object.keys(out).length) throw bad('No hay cambios.');
  out.updatedAt = new Date().toISOString();
  return out;
}

// ---------------------------------------------------------------- almacenamiento en archivo

function fileStore(file) {
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).notes ?? []; } catch { return []; }
  };
  const write = (notes) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ notes }, null, 2) + '\n');
    fs.renameSync(tmp, file);
  };
  return {
    async list() { return read().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
    async create(note) { const notes = read(); const n = { id: crypto.randomUUID(), ...note }; notes.push(n); write(notes); return n; },
    async update(id, patch) {
      const notes = read(); const i = notes.findIndex((n) => n.id === id);
      if (i < 0) return null;
      notes[i] = { ...notes[i], ...patch }; write(notes); return notes[i];
    },
    async remove(id) { const notes = read(); const left = notes.filter((n) => n.id !== id); if (left.length === notes.length) return false; write(left); return true; },
    async close() {},
  };
}

// ---------------------------------------------------------------- almacenamiento en MongoDB

function mongoStore(uri, dbName) {
  let col = null;
  let client = null;
  const get = async () => {
    if (col) return col;
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(uri, { appName: 'calamuchita-debug' });
    await client.connect();
    col = client.db(dbName).collection('notes');
    await col.createIndex({ createdAt: -1 });
    return col;
  };
  const toId = async (id) => {
    const { ObjectId: OID } = await import('mongodb');
    if (!OID.isValid(id)) { const e = new Error('Id inválido.'); e.status = 400; throw e; }
    return new OID(id);
  };
  const out = (d) => { if (!d) return null; const { _id, ...rest } = d; return { id: String(_id), ...rest }; };
  return {
    async list() { return (await (await get()).find().sort({ createdAt: -1 }).toArray()).map(out); },
    async create(note) { const c = await get(); const r = await c.insertOne({ ...note }); return out({ _id: r.insertedId, ...note }); },
    async update(id, patch) { const c = await get(); return out(await c.findOneAndUpdate({ _id: await toId(id) }, { $set: patch }, { returnDocument: 'after' })); },
    async remove(id) { const c = await get(); return (await c.deleteOne({ _id: await toId(id) })).deletedCount > 0; },
    async close() { await client?.close(); col = null; client = null; },
  };
}
