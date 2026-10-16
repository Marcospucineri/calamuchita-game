-- Multiplayer y chat de Vallecito (Supabase Realtime).
--
-- Canales privados, uno de posiciones y uno de chat por sala:
--   vallecito:pos:<sala>   los jugadores mandan y reciben posiciones (broadcast) y presencia.
--   vallecito:chat:<sala>  solo se RECIBE: los mensajes entran por send_chat(), que valida
--                          todo en el servidor y los publica con realtime.send().
-- Así nadie puede escribirse un nombre ajeno ni saltarse el límite de velocidad del chat.
-- Requiere "Realtime Authorization" (viene activado por defecto en proyectos nuevos).

create table public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  room integer not null,
  name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index chat_messages_user_time on public.chat_messages (user_id, created_at desc);
create index chat_messages_time on public.chat_messages (created_at desc);

-- Para silenciar a alguien: insert into public.chat_bans(user_id, reason) values ('<uuid>', 'motivo');
create table public.chat_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;
alter table public.chat_bans enable row level security;
revoke all on public.chat_messages, public.chat_bans from public, anon, authenticated;

create function public.send_chat(room integer, message text, sid text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  clean text;
  who text;
  recent integer;
  last_at timestamptz;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if room is null or room < 1 or room > 999 then raise exception 'Invalid room'; end if;
  if exists (select 1 from public.chat_bans b where b.user_id = uid) then raise exception 'Chat unavailable'; end if;
  clean := btrim(regexp_replace(regexp_replace(coalesce(message, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g'));
  clean := left(clean, 120);
  if clean = '' then return; end if;

  -- como mucho 1 mensaje cada 0,7 s y 5 cada 10 s por cuenta (en todas las salas)
  select max(m.created_at), count(*) into last_at, recent
    from public.chat_messages m where m.user_id = uid and m.created_at > now() - interval '10 seconds';
  if last_at is not null and last_at > clock_timestamp() - interval '700 milliseconds' then raise exception 'Chat rate limit'; end if;
  if recent >= 5 then raise exception 'Chat rate limit'; end if;

  -- el nombre sale del perfil guardado en la cuenta, nunca del cliente
  select coalesce(nullif(left(btrim(p.save #>> '{progress,profile,name}'), 24), ''), 'Visitante') into who
    from public.player_progress p where p.user_id = uid;
  who := coalesce(who, 'Visitante');

  insert into public.chat_messages(user_id, room, name, body, created_at) values (uid, room, who, clean, clock_timestamp());
  if random() < 0.02 then delete from public.chat_messages m where m.created_at < now() - interval '30 days'; end if;

  perform realtime.send(
    jsonb_build_object('name', who, 'text', clean, 'sid', left(coalesce(sid, ''), 40), 'at', (extract(epoch from clock_timestamp()) * 1000)::bigint),
    'chat', 'vallecito:chat:' || room, true);
end;
$$;
revoke all on function public.send_chat(integer, text, text) from public, anon;
grant execute on function public.send_chat(integer, text, text) to authenticated;

-- Autorización de Realtime: solo usuarios con sesión, y solo en los canales del juego.
create policy "vallecito posiciones: leer" on realtime.messages for select to authenticated
  using (realtime.topic() like 'vallecito:pos:%' and extension in ('broadcast', 'presence'));
create policy "vallecito posiciones: escribir" on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'vallecito:pos:%' and extension in ('broadcast', 'presence'));
create policy "vallecito chat: leer" on realtime.messages for select to authenticated
  using (realtime.topic() like 'vallecito:chat:%' and extension = 'broadcast');
