-- Distance counters are separate from game saves: a stale save cannot erase them.
create table public.distance_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  seconds double precision not null default 0,
  car double precision not null default 0,
  plane double precision not null default 0,
  foot double precision not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, session_id)
);
create table public.player_distances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  car double precision not null default 0,
  plane double precision not null default 0,
  foot double precision not null default 0
);
alter table public.distance_sessions enable row level security;
alter table public.player_distances enable row level security;
revoke all on public.distance_sessions, public.player_distances from public, anon, authenticated;
create index player_distances_car on public.player_distances (car desc);
create index player_distances_plane on public.player_distances (plane desc);
create index player_distances_foot on public.player_distances (foot desc);

create function public.record_distance(session_id uuid, active_seconds double precision, car_meters double precision, plane_meters double precision, foot_meters double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  old public.distance_sessions%rowtype;
  elapsed double precision;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if session_id is null or active_seconds is null or car_meters is null or plane_meters is null or foot_meters is null
    or not (active_seconds between 0 and 31536000)
    or not (car_meters between 0 and 1e9) or not (plane_meters between 0 and 1e9) or not (foot_meters between 0 and 1e9) then
    raise exception 'Invalid distance';
  end if;
  insert into public.distance_sessions(user_id, session_id) values (uid, session_id) on conflict on constraint distance_sessions_pkey do nothing;
  select * into old from public.distance_sessions d where d.user_id = uid and d.session_id = record_distance.session_id for update;
  elapsed := extract(epoch from clock_timestamp() - old.created_at) + 30;
  if active_seconds > elapsed or car_meters / 85 + plane_meters / 100 + foot_meters / 10 > active_seconds + 0.1 then
    raise exception 'Implausible distance';
  end if;
  -- Absolute session counters make retries, old packets and simultaneous tabs idempotent.
  insert into public.player_distances(user_id, car, plane, foot)
    values (uid, greatest(0, car_meters - old.car), greatest(0, plane_meters - old.plane), greatest(0, foot_meters - old.foot))
    on conflict (user_id) do update set car = player_distances.car + excluded.car,
      plane = player_distances.plane + excluded.plane, foot = player_distances.foot + excluded.foot;
  update public.distance_sessions d set seconds = greatest(old.seconds, active_seconds),
    car = greatest(old.car, car_meters), plane = greatest(old.plane, plane_meters), foot = greatest(old.foot, foot_meters)
    where d.user_id = uid and d.session_id = record_distance.session_id;
end;
$$;
revoke all on function public.record_distance(uuid, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.record_distance(uuid, double precision, double precision, double precision, double precision) to authenticated;

create function public.distance_ranking(category text)
returns table("position" bigint, name text, meters double precision, is_me boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if category not in ('car', 'plane', 'foot') or category is null then raise exception 'Invalid category'; end if;
  return query
    with scores as (
      select d.user_id, case category when 'car' then d.car when 'plane' then d.plane else d.foot end as distance
      from public.player_distances d
    ), ranked as (
      select s.user_id, s.distance, rank() over (order by s.distance desc) as place
      from scores s where s.distance > 0
    ), visible as (
      select * from (select * from ranked order by distance desc, user_id limit 50) top_players
      union select * from ranked where user_id = auth.uid()
    )
    select v.place, coalesce(nullif(left(trim(p.save#>>'{progress,profile,name}'), 24), ''), 'Visitante'),
      v.distance, v.user_id = auth.uid()
    from visible v left join public.player_progress p on p.user_id = v.user_id
    union all
    select null::bigint, coalesce(nullif(left(trim(p.save#>>'{progress,profile,name}'), 24), ''), 'Visitante'), 0::double precision, true
    from (select auth.uid() as user_id) me left join public.player_progress p on p.user_id = me.user_id
    where not exists (select 1 from ranked where user_id = me.user_id)
    order by 1 nulls last, 2;
end;
$$;
revoke all on function public.distance_ranking(text) from public, anon;
grant execute on function public.distance_ranking(text) to authenticated;
