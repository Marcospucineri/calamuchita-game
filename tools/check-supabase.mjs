// Live smoke test: creates a disposable confirmed test user, sends no email, then removes it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = loadEnv('development', process.cwd(), '');
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !publicKey || !env.SUPABASE_SECRET_KEY) throw new Error('Faltan claves Supabase en .env');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, env.SUPABASE_SECRET_KEY, options);
const client = createClient(url, publicKey, options);
const email = `vallecito-test-${randomUUID()}@example.invalid`;
const password = randomUUID() + randomUUID();
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw new Error('No se pudo crear el usuario temporal: ' + created.error.message);
const id = created.data.user.id;
try {
  const login = await client.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null, 'Email/password login works');
  const pois = JSON.parse(readFileSync(new URL('../public/world/pois.json', import.meta.url)));
  const save = { version: 1, mode: 'driving', car: { x: 1, n: 2, heading: 0 }, player: { x: 1, n: 2 }, discovered: [pois[0].id], progress: { profile: { name: 'Prueba automática' }, trips: [] } };
  let result = await client.rpc('sync_progress', { incoming: save });
  assert.equal(result.error, null, 'Save RPC works'); assert.equal(result.data.balance, 50);
  result = await client.rpc('sync_progress', { incoming: save }); assert.equal(result.data.balance, 50, 'Postal is paid once');
  const loaded = await client.from('player_progress').select('save,balance').eq('user_id', id).single();
  assert.equal(loaded.error, null); assert.equal(loaded.data.save.progress.profile.name, 'Prueba automática');
  const forged = await client.from('player_progress').update({ balance: 99999 }).eq('user_id', id); assert.ok(forged.error, 'Direct balance edits denied');
  const anon = createClient(url, publicKey, options);
  assert.ok((await anon.from('player_progress').select('save')).error, 'Anonymous reads denied');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  save.progress.photos = [day, day];
  result = await client.rpc('sync_progress', { incoming: save }); assert.equal(result.data.balance, 60, 'Daily photo pays once');
  result = await client.rpc('sync_progress', { incoming: save }); assert.equal(result.data.balance, 60);
  const sessionId = randomUUID();
  const distanceArgs = { session_id: sessionId, active_seconds: 5, car_meters: 100, plane_meters: 20, foot_meters: 5 };
  assert.equal((await client.rpc('record_distance', distanceArgs)).error, null);
  assert.equal((await client.rpc('record_distance', distanceArgs)).error, null);
  for (const [category, meters] of [['car',100],['plane',20],['foot',5]]) {
    const ranking = await client.rpc('distance_ranking', { category });
    assert.equal(ranking.error, null);
    assert.equal(ranking.data.find((r) => r.is_me).meters, meters, 'Real distance retry does not duplicate');
    assert.ok(ranking.data.every((r) => !('user_id' in r) && !('email' in r)), 'Only public ranking fields');
  }
  assert.ok((await anon.rpc('distance_ranking', { category: 'car' })).error, 'Anonymous ranking denied');
  assert.ok((await client.from('player_distances').update({ car: 99999 }).eq('user_id',id)).error);
  console.log('OK ranking real: tres categorías, reintentos sin duplicación y acceso privado.');
  console.log('OK Supabase real: login, guardado/lectura, postal única, foto diaria y permisos.');
} finally {
  await client.auth.signOut();
  const deleted = await admin.auth.admin.deleteUser(id);
  if (deleted.error) throw new Error('No se pudo limpiar el usuario temporal');
  console.log('Usuario temporal eliminado.');
}
