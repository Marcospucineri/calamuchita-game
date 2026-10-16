-- Chat para invitados: alcanza con elegir un nombre, sin cuenta.
-- Los invitados se identifican por el sid que genera el cliente (no es una identidad fuerte):
-- por eso además del límite por sid hay un límite global por sala. Silenciar a un invitado:
--   insert into public.chat_guest_bans(sid, reason) values ('<sid>', 'motivo');

alter table public.chat_messages alter column user_id drop not null;
alter table public.chat_messages add column guest text;
alter table public.chat_messages add constraint chat_messages_who check (user_id is not null or guest is not null);
create index chat_messages_guest_time on public.chat_messages (guest, created_at desc) where guest is not null;
create index chat_messages_room_time on public.chat_messages (room, created_at desc);

create table public.chat_guest_bans (
  sid text primary key,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.chat_guest_bans enable row level security;
revoke all on public.chat_guest_bans from public, anon, authenticated;

drop function public.send_chat(integer, text, text);
create function public.send_chat(room integer, message text, sid text default null, nick text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid text;
  clean text;
  who text;
  typed text;
  recent integer;
  last_at timestamptz;
  in_room integer;
begin
  if room is null or room < 1 or room > 999 then raise exception 'Invalid room'; end if;
  if uid is null then
    gid := left(regexp_replace(coalesce(sid, ''), '[^A-Za-z0-9_-]', '', 'g'), 40);
    if length(gid) < 8 then raise exception 'Invalid session'; end if;
    if exists (select 1 from public.chat_guest_bans b where b.sid = gid) then raise exception 'Chat unavailable'; end if;
  elsif exists (select 1 from public.chat_bans b where b.user_id = uid) then
    raise exception 'Chat unavailable';
  end if;
  clean := btrim(regexp_replace(regexp_replace(coalesce(message, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g'));
  clean := left(clean, 120);
  if clean = '' then return; end if;

  -- como mucho 1 mensaje cada 0,7 s y 5 cada 10 s por cuenta o por invitado
  if uid is not null then
    select max(m.created_at), count(*) into last_at, recent
      from public.chat_messages m where m.user_id = uid and m.created_at > now() - interval '10 seconds';
  else
    select max(m.created_at), count(*) into last_at, recent
      from public.chat_messages m where m.guest = gid and m.created_at > now() - interval '10 seconds';
    -- y entre todos los invitados de una sala: 30 mensajes cada 10 s
    select count(*) into in_room from public.chat_messages m
      where m.room = send_chat.room and m.guest is not null and m.created_at > now() - interval '10 seconds';
    if in_room >= 30 then raise exception 'Chat rate limit'; end if;
  end if;
  if last_at is not null and last_at > clock_timestamp() - interval '700 milliseconds' then raise exception 'Chat rate limit'; end if;
  if recent >= 5 then raise exception 'Chat rate limit'; end if;

  -- nombre que escribió el jugador, sin caracteres de control ni espacios de más
  typed := nullif(left(btrim(regexp_replace(regexp_replace(coalesce(nick, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g')), 24), '');
  if uid is not null then
    -- con cuenta, manda el nombre del perfil guardado; el escrito solo sirve si todavía no hay perfil
    select nullif(left(btrim(p.save #>> '{progress,profile,name}'), 24), '') into who
      from public.player_progress p where p.user_id = uid;
    if who is null or who = 'Visitante' then who := typed; end if;
  else
    who := typed;
  end if;
  who := coalesce(who, 'Visitante');

  insert into public.chat_messages(user_id, guest, room, name, body, created_at)
    values (uid, gid, room, who, clean, clock_timestamp());
  if random() < 0.02 then delete from public.chat_messages m where m.created_at < now() - interval '30 days'; end if;

  perform realtime.send(
    jsonb_build_object('name', who, 'text', clean, 'sid', left(coalesce(sid, ''), 40), 'at', (extract(epoch from clock_timestamp()) * 1000)::bigint),
    'chat', 'vallecito:chat:' || room, true);
end;
$$;
revoke all on function public.send_chat(integer, text, text, text) from public;
grant execute on function public.send_chat(integer, text, text, text) to anon, authenticated;
