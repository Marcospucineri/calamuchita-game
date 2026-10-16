// Prueba de send_chat contra PostgreSQL embebido (Realtime simulado con una tabla).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const uid = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const who = (id) => db.exec(`set role postgres; set request.jwt.claim.sub='${id}'; set role authenticated;`);
const send = (room, text, sid = null, nick = null) => db.query('select public.send_chat($1,$2,$3,$4)', [room, text, sid, nick]);
const sent = async () => (await db.query('select topic, event, payload from sent order by n')).rows;
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema realtime; create table sent(n serial, topic text, event text, payload jsonb, private boolean);
    create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$ insert into public.sent(topic, event, payload, private) values (topic, event, payload, private) $$;
    create table realtime.messages(topic text, extension text);
    create function realtime.topic() returns text language sql as $$ select current_setting('realtime.topic', true) $$;
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated; grant usage on schema auth to authenticated; grant select, insert on realtime.messages to authenticated, anon; grant usage on schema realtime to anon;`);
  await db.exec(fs.readFileSync('supabase/migrations/202610160001_progress.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/202610160003_multiplayer_chat.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/202610160004_multiplayer_guests.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/202610160005_chat_invitados.sql', 'utf8'));
  await db.exec(`insert into auth.users values ('${uid}'),('${other}');
    insert into public.player_progress(user_id, save) values ('${uid}', '{"progress":{"profile":{"name":"  Luz  "}}}');
    grant usage on schema realtime to authenticated; grant select, insert on public.sent to authenticated, anon; grant usage on all sequences in schema public to authenticated; grant usage on all sequences in schema realtime to authenticated;`);
  await db.exec(`grant usage, select on sequence sent_n_seq to authenticated, anon;`);

  await who(uid);
  await send(3, '  Hola\t  valle\n!  ', 'abc');
  let rows = await sent();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, 'vallecito:chat:3');
  assert.equal(rows[0].event, 'chat');
  assert.equal(rows[0].payload.text, 'Hola valle !', 'Texto limpio: sin controles ni espacios repetidos');
  assert.equal(rows[0].payload.name, 'Luz', 'El nombre sale del perfil guardado');
  assert.equal(rows[0].payload.sid, 'abc');

  await assert.rejects(send(3, 'otro enseguida'), /rate limit/, '0,7 s entre mensajes');
  await db.exec(`set role postgres; update public.chat_messages set created_at = now() - interval '5 seconds'; set role authenticated;`);
  await send(3, 'x'.repeat(500));
  rows = await sent();
  assert.equal(rows.at(-1).payload.text.length, 120, 'Máximo 120 caracteres');
  await send(3, '   ');
  assert.equal((await sent()).length, 2, 'El texto vacío se ignora');

  await db.exec(`set role postgres; delete from public.chat_messages; set role authenticated;`);
  for (let i = 0; i < 5; i++) {
    await db.exec(`set role postgres; update public.chat_messages set created_at = now() - interval '2 seconds'; set role authenticated;`);
    await send(1, 'mensaje ' + i);
  }
  await db.exec(`set role postgres; update public.chat_messages set created_at = now() - interval '2 seconds'; set role authenticated;`);
  await assert.rejects(send(1, 'sexto'), /rate limit/, 'Cinco mensajes cada 10 s');

  await who(other);
  await send(2, 'hola desde otro');
  assert.equal((await sent()).at(-1).payload.name, 'Visitante', 'Sin perfil guardado: Visitante');
  await assert.rejects(send(0, 'x'), /Invalid room/);
  await assert.rejects(send(1000, 'x'), /Invalid room/);
  await assert.rejects(db.query('select * from public.chat_messages'), /permission denied/, 'El cliente no lee la tabla');
  await assert.rejects(db.query(`insert into public.chat_messages(user_id, room, name, body) values ('${other}', 1, 'Falso', 'x')`), /permission denied/, 'Ni escribe directo');

  await db.exec(`set role postgres; insert into public.chat_bans(user_id) values ('${other}'); update public.chat_messages set created_at = now() - interval '1 minute'; set role authenticated;`);
  await assert.rejects(send(2, 'baneado'), /unavailable/, 'Los silenciados no pueden escribir');

  await db.exec(`set role postgres; set request.jwt.claim.sub=''; set role anon;`);
  // invitados: alcanza con un nombre
  await assert.rejects(send(1, 'sin sid', null, 'Ana'), /Invalid session/, 'El invitado necesita sid');
  await send(1, 'hola soy invitada', 'guest-0001', '  Ana\t Paz  ');
  rows = await sent();
  assert.equal(rows.at(-1).payload.name, 'Ana Paz', 'Nombre del invitado limpio');
  assert.equal(rows.at(-1).payload.text, 'hola soy invitada');
  await assert.rejects(send(1, 'enseguida', 'guest-0001', 'Ana'), /rate limit/, 'Límite por invitado');
  await send(1, 'otro', 'guest-0002');
  assert.equal((await sent()).at(-1).payload.name, 'Visitante', 'Invitado sin nombre: Visitante');
  await send(1, 'nombre largo', 'guest-0003', 'x'.repeat(80));
  assert.equal((await sent()).at(-1).payload.name.length, 24, 'Nombre de hasta 24 caracteres');
  await db.exec(`set role postgres; insert into public.chat_guest_bans(sid) values ('guest-0004'); set role anon;`);
  await assert.rejects(send(1, 'baneado', 'guest-0004', 'Mal'), /unavailable/, 'Invitados silenciados');
  await db.exec(`set role postgres; update public.chat_messages set created_at = now() - interval '1 second' where guest is not null; set role anon;`);
  for (let i = 0; i < 30; i++) await send(5, 'spam ' + i, 'guest-x' + String(i).padStart(4, '0'));
  await assert.rejects(send(5, 'spam extra', 'guest-zzzz0001'), /rate limit/, 'Límite global de invitados por sala');
  await assert.rejects(db.query('select * from public.chat_messages'), /permission denied/, 'El invitado no lee la tabla');
  await db.exec(`set role postgres; delete from public.chat_messages where guest is not null; set role anon;`);

  await db.exec(`set role postgres; set role authenticated;`);
  await db.exec(`set role postgres; insert into realtime.messages values ('vallecito:pos:1','broadcast'),('vallecito:chat:1','broadcast'),('otro:canal','broadcast'),('vallecito:chat:1','presence'),('vallecito:pos:2','presence'); set role authenticated;`).catch(() => {});
  await db.exec(`set realtime.topic = 'vallecito:pos:1';`);
  const readable = async (topic, ext) => { await db.exec(`set role postgres; set realtime.topic='${topic}'; set role authenticated;`); return (await db.query(`select 1 from realtime.messages where topic='${topic}' and extension='${ext}'`)).rows.length; };
  assert.equal(await readable('vallecito:pos:1', 'broadcast'), 1, 'Posiciones: lectura permitida');
  assert.equal(await readable('vallecito:chat:1', 'broadcast'), 1, 'Chat: lectura permitida');
  assert.equal(await readable('vallecito:chat:1', 'presence'), 0, 'Chat: sin presencia');
  assert.equal(await readable('otro:canal', 'broadcast'), 0, 'Otros canales: bloqueados');
  const guest = async (topic, ext) => { await db.exec(`set role postgres; set realtime.topic='${topic}'; set role anon;`); return (await db.query(`select 1 from realtime.messages where topic='${topic}' and extension='${ext}'`)).rows.length; };
  assert.equal(await guest('vallecito:pos:1', 'broadcast'), 1, 'Invitados: ven posiciones');
  assert.equal(await guest('vallecito:chat:1', 'broadcast'), 1, 'Invitados: leen el chat');
  assert.equal(await guest('otro:canal', 'broadcast'), 0, 'Invitados: otros canales bloqueados');
  console.log('chat sql ok');
} finally {
  await db.close();
}
