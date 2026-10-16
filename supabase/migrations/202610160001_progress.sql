-- Run in Supabase SQL Editor. No service-role key is used by the browser.
create table public.reward_places (
  id text primary key,
  town text
);
create table public.hitchhike_routes (
  id text primary key,
  distance integer not null check (distance > 0)
);
create table public.player_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  save jsonb not null default '{}',
  balance integer not null default 0 check (balance >= 0),
  guest_imported boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.serrano_ledger (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_key text not null,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, reward_key)
);
create table public.active_hitchhikes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trip_id uuid not null,
  route_id text not null references public.hitchhike_routes(id),
  started_at timestamptz not null default now()
);
alter table public.active_hitchhikes enable row level security;
revoke all on public.active_hitchhikes from anon, authenticated;

create or replace function public.start_hitchhike(trip_id uuid, route_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.active_hitchhikes(user_id, trip_id, route_id)
    values (auth.uid(), trip_id, route_id)
    on conflict (user_id) do update set trip_id = excluded.trip_id, route_id = excluded.route_id, started_at = now();
end;
$$;
revoke all on function public.start_hitchhike(uuid, text) from public, anon;
grant execute on function public.start_hitchhike(uuid, text) to authenticated;

alter table public.reward_places enable row level security;
alter table public.hitchhike_routes enable row level security;
alter table public.player_progress enable row level security;
alter table public.serrano_ledger enable row level security;
create policy own_progress on public.player_progress for select to authenticated using (auth.uid() = user_id);
create policy own_ledger on public.serrano_ledger for select to authenticated using (auth.uid() = user_id);
revoke all on public.player_progress, public.serrano_ledger, public.reward_places, public.hitchhike_routes from anon, authenticated;
grant select on public.player_progress, public.serrano_ledger to authenticated;

-- Serializes syncs per user, merges discoveries and receipts, and calculates all values here.
-- Client coordinates are retained for resuming a walk, never used as a reward amount.
create or replace function public.sync_progress(incoming jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  previous jsonb;
  found jsonb;
  receipts jsonb := '[]'::jsonb;
  item jsonb;
  route_distance integer;
  started double precision;
  finished double precision;
  total integer;
  imported boolean;
  photo_days jsonb;
  day text;
  today text := to_char(now() at time zone 'America/Argentina/Cordoba', 'YYYY-MM-DD');
  result jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if octet_length(incoming::text) > 1048576
     or incoming->>'version' is distinct from '1'
     or jsonb_typeof(incoming->'car') is distinct from 'object'
     or jsonb_typeof(incoming->'player') is distinct from 'object'
     or jsonb_typeof(incoming->'discovered') is distinct from 'array'
     or jsonb_typeof(incoming->'progress') is distinct from 'object'
     or jsonb_typeof(incoming#>'{progress,trips}') is distinct from 'array'
     or jsonb_array_length(incoming#>'{progress,trips}') > 2000 then
    raise exception 'Invalid save';
  end if;
  insert into public.player_progress(user_id) values (uid) on conflict do nothing;
  select save, guest_imported into previous, imported from public.player_progress where user_id = uid for update;
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) into found
    from public.reward_places
    where id in (select jsonb_array_elements_text(incoming->'discovered')
                 union select jsonb_array_elements_text(coalesce(previous->'discovered', '[]'::jsonb)));
  insert into public.serrano_ledger(user_id, reward_key, amount)
    select uid, 'postal:' || id, 50 from public.reward_places where found ? id
    on conflict do nothing;
  insert into public.serrano_ledger(user_id, reward_key, amount)
    select uid, 'town:' || town, 200 from public.reward_places where town is not null
    group by town having bool_and(found ? id) on conflict do nothing;

  -- Guest activities migrate through validated receipts. UUID prevents duplicate claims.
  -- Route distance and payment come from the catalog, never from an incoming balance.
  for item in select value from jsonb_array_elements(coalesce(previous#>'{progress,trips}', '[]'::jsonb) || (incoming#>'{progress,trips}')) loop
    if item->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then continue; end if;
    select distance into route_distance from public.hitchhike_routes where id = item->>'routeId';
    if route_distance is null then continue; end if;
    if jsonb_typeof(item->'startedAt') is distinct from 'number' or jsonb_typeof(item->'completedAt') is distinct from 'number' then continue; end if;
    started := (item->>'startedAt')::double precision;
    finished := (item->>'completedAt')::double precision;
    if started < 0 or finished > extract(epoch from now()) * 1000 + 300000
       or finished - started < route_distance::double precision / 55 * 1000 then continue; end if;
    if imported and not exists (
      select 1 from public.serrano_ledger where user_id = uid and reward_key = 'trip:' || (item->>'id')
    ) and not exists (
      select 1 from public.active_hitchhikes a
      where a.user_id = uid and a.trip_id::text = item->>'id' and a.route_id = item->>'routeId'
        and extract(epoch from (now() - a.started_at)) >= route_distance::double precision / 55
    ) then
      continue;
    end if;
    if not exists (select 1 from jsonb_array_elements(receipts) r where r->>'id' = item->>'id') then
      receipts := receipts || jsonb_build_array(item);
    end if;
    insert into public.serrano_ledger(user_id, reward_key, amount)
      values (uid, 'trip:' || (item->>'id'), greatest(20, least(60, 20 + (route_distance / 1000) * 10)))
      on conflict do nothing;
    delete from public.active_hitchhikes where user_id = uid and trip_id::text = item->>'id';
  end loop;
  -- One photo payment per valley calendar day. Older guest days migrate once.
  for day in select jsonb_array_elements_text(coalesce(incoming#>'{progress,photos}', '[]'::jsonb)) loop
    if day ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
       and (day = today or (not imported and day <= today)) then
      insert into public.serrano_ledger(user_id, reward_key, amount) values (uid, 'photo:' || day, 10) on conflict do nothing;
    end if;
  end loop;
  select coalesce(jsonb_agg(substring(reward_key from 7) order by reward_key), '[]'::jsonb) into photo_days
    from public.serrano_ledger where user_id = uid and reward_key like 'photo:%';
  select coalesce(sum(amount), 0) into total from public.serrano_ledger where user_id = uid;
  result := jsonb_set(incoming, '{discovered}', found);
  result := jsonb_set(result, '{progress,trips}', receipts);
  result := jsonb_set(result, '{progress,photos}', photo_days);
  update public.player_progress set save = result, balance = total, guest_imported = true, updated_at = now() where user_id = uid;
  return jsonb_build_object('save', result, 'balance', total);
end;
$$;
revoke all on function public.sync_progress(jsonb) from public, anon;
grant execute on function public.sync_progress(jsonb) to authenticated;

insert into public.reward_places(id,town) values
('osm-1088091778','lr'),
('osm-1088106457','lr'),
('osm-1088112311','lr'),
('osm-1088121867','lr'),
('osm-1088158321','lr'),
('osm-3779074503','vgb'),
('osm-5471369058','vgb'),
('osm-5471369059','vgb'),
('osm-5471369152','vgb'),
('osm-6768261979','lr'),
('osm-7810809712','lr'),
('osm-7821475842','vcp'),
('osm-7882386322','vgb'),
('osm-7882386354','vgb'),
('osm-7882386411','vgb'),
('osm-9024234220',null),
('osm-9025327801','vcp'),
('osm-9452889568','vcp'),
('osm-9868441143','vgb'),
('osm-10210432719',null),
('osm-10210473118','vgb'),
('osm-10210473617',null),
('osm-11077987360','vgb'),
('osm-13581370202','vgb'),
('osm-13704587318',null),
('osm-13781786401','vgb');

insert into public.hitchhike_routes(id,distance) values
('dedo-1',696),
('dedo-2',1339),
('dedo-3',2084),
('dedo-4',3495),
('dedo-5',3070),
('dedo-6',792),
('dedo-7',1443),
('dedo-8',2332),
('dedo-9',3572);
