// Servidor estático mínimo para producción (Railway u otro hosting con Node).
// Sirve dist/ con compresión gzip y caché para los datos del mundo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createNotesApi } from './server/notes-api.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'dist');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};
// ya vienen comprimidos: no se pasan por gzip
const PRECOMPRESSED = new Set(['.png', '.jpg', '.webp', '.woff2', '.mp3']);
// archivos con hash de Vite, tipografías e ilustraciones: casi nunca cambian
const longCache = (url) => /^\/(assets|fonts)\//.test(url) || /^\/(postales|brand)\//.test(url);
const gzCache = new Map();
// anotaciones del modo debug: en producción solo con DEBUG_TOKEN
const notesApi = createNotesApi({
  mongoUri: process.env.MONGODB_URI,
  token: process.env.DEBUG_TOKEN,
  file: path.resolve(path.dirname(new URL(import.meta.url).pathname), 'notes', 'anotaciones.json'),
  requireToken: true,
});

http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    notesApi(req, res)
      .then((handled) => { if (!handled) res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"No encontrado"}'); })
      .catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
    return;
  }
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  const ext = path.extname(file);
  const cache = ext === '.html' ? 'no-cache' : url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : longCache(url) ? 'public, max-age=604800' : 'public, max-age=3600';
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && !PRECOMPRESSED.has(ext)) {
    let gz = gzCache.get(file);
    if (!gz) { gz = zlib.gzipSync(fs.readFileSync(file), { level: 6 }); gzCache.set(file, gz); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
    res.end(gz);
    return;
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Vallecito en http://localhost:${PORT}`));
