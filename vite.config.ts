import { defineConfig, loadEnv, type Connect } from 'vite';
// @ts-ignore: módulos JS del servidor, sin tipos
import { createNotesApi } from './server/notes-api.mjs';
// @ts-ignore
import { syncNotes } from './server/notes-sync.mjs';

/** En desarrollo, /api/notes guarda las anotaciones del modo debug (archivo local o MongoDB si hay MONGODB_URI). */
function notesApi(env: Record<string, string>) {
  const mount = (use: (fn: Connect.NextHandleFunction) => void) => {
    const api = createNotesApi({ mongoUri: env.MONGODB_URI, token: env.DEBUG_TOKEN, file: 'notes/anotaciones.json', requireToken: false });
    use((req, res, next) => { api(req, res).then((handled: boolean) => { if (!handled) next(); }).catch(next); });
  };
  return {
    name: 'calamuchita-notes-api',
    configureServer(server: { middlewares: Connect.Server }) {
      mount((fn) => server.middlewares.use(fn));
      // al arrancar el dev: sube las marcas de "procesada" y baja las notas a notes/anotaciones.json
      if (env.MONGODB_URI) syncNotes({ mongoUri: env.MONGODB_URI }).catch((e: Error) => console.warn(`[notas] no se pudo sincronizar con MongoDB: ${e.message}`));
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) { mount((fn) => server.middlewares.use(fn)); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    // Only these public values reach the browser. SUPABASE_SECRET_KEY stays server-side.
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || ''),
    },
    server: { host: true },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
    },
    plugins: [notesApi(env)],
  };
});
