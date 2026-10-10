-- Corde — accounts (applied after secret.sql).
-- One name = one account, never repeated (case, accents and extra spaces don't make a different name).
-- A browser is linked to an account by its secret (the same "corde.player" secret the boards already use: sha-256 of it
-- is the player_key). Progress that used to live only in each browser (song-of-the-day streak, personal bests, tour
-- setlists) is kept in the account too, so every linked device sees the same.
--  - account_claim: the first browser with a name takes it. A name that already has scores from other browsers is
--    reserved for them (one of those browsers claims it the first time it opens the updated game).
--  - account_link: another device joins an account with its 4-letter code (shown in Ajustes on a linked device).
--  - account_sync: merges a browser's progress into the account and hands back the merged progress.
-- Scores (submit-score and submit_daily) only go through when the name is this browser's account.

create extension if not exists unaccent with schema extensions;

create table if not exists public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_key   text not null unique,
  code       text not null,
  failed     int not null default 0,
  progress   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.account_devices (
  device_key text primary key,             -- sha-256 of the browser secret (= player_key on the boards)
  account_id uuid not null references public.accounts (id) on delete cascade,
  linked_at  timestamptz not null default now()
);
create index if not exists account_devices_account_idx on public.account_devices (account_id);
alter table public.accounts enable row level security;
alter table public.account_devices enable row level security;
revoke all on public.accounts, public.account_devices from anon, authenticated; -- only the functions below

-- the key that makes two names the same: lowercase, no accents, single spaces
create or replace function public.acct_key(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select lower(regexp_replace(btrim(extensions.unaccent(coalesce(p, ''))), '\s+', ' ', 'g'))
$$;
create or replace function public.acct_clean(p text) returns text
language sql immutable as $$ select left(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), 16) $$;
create or replace function public.acct_device(p_secret text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex') $$;
create or replace function public.acct_json(a public.accounts) returns json
language sql stable as $$ select json_build_object('name', a.name, 'code', a.code, 'progress', a.progress) $$;

-- progress merge: days → union; bests → the higher score per song + difficulty; tour → the setlists already saved win
create or replace function public.acct_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare days jsonb; bests jsonb := coalesce(a -> 'bests', '{}'::jsonb); tour jsonb; s text; d text; v jsonb; cur jsonb;
begin
  a := coalesce(a, '{}'::jsonb); b := coalesce(b, '{}'::jsonb);
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into days from (
    select distinct x from (
      select jsonb_array_elements_text(coalesce(a -> 'days', '[]'::jsonb)) x
      union select jsonb_array_elements_text(coalesce(b -> 'days', '[]'::jsonb))
    ) u where x ~ '^\d{4}-\d{2}-\d{2}$' order by x desc limit 400
  ) t;
  for s, v in select * from jsonb_each(coalesce(b -> 'bests', '{}'::jsonb)) loop
    if jsonb_typeof(v) <> 'object' then continue; end if;
    for d, cur in select * from jsonb_each(v) loop
      if jsonb_typeof(cur) <> 'object' or coalesce((cur ->> 'score')::numeric, 0) <= 0 then continue; end if;
      if coalesce((bests #>> array[s, d, 'score'])::numeric, -1) < (cur ->> 'score')::numeric then
        bests := jsonb_set(bests, array[s], coalesce(bests -> s, '{}'::jsonb) || jsonb_build_object(d, cur), true);
      end if;
    end loop;
  end loop;
  tour := coalesce(b -> 'tour', '{}'::jsonb) || coalesce(a -> 'tour', '{}'::jsonb);
  return jsonb_build_object('days', days, 'bests', bests, 'tour', tour);
end $$;

/** This browser's account → { name, code, progress } | null */
create or replace function public.account_me(p_secret text) returns json
language sql stable security definer set search_path = public as $$
  select acct_json(a) from accounts a join account_devices d on d.account_id = a.id where d.device_key = acct_device(p_secret)
$$;

/** Takes a name for this browser → { name, code, progress } | { error: 'name_taken' } */
create or replace function public.account_claim(p_name text, p_secret text) returns json
language plpgsql security definer set search_path = public as $$
declare nm text := acct_clean(p_name); k text := acct_key(nm); dk text := acct_device(p_secret); a accounts; v_code text := ''; i int;
begin
  if nm = '' or k = '' or length(coalesce(p_secret, '')) < 16 then raise exception 'Datos inválidos' using errcode = '22023'; end if;
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = dk;
  if found then return acct_json(a); end if; -- already has an account: that's the name
  if exists (select 1 from accounts x where x.name_key = k) then return json_build_object('error', 'name_taken'); end if;
  -- someone already played with this name from another browser: it's theirs to claim
  if (exists (select 1 from scores s where acct_key(s.name) = k) or exists (select 1 from daily_scores s where acct_key(s.name) = k))
     and not exists (select 1 from scores s where acct_key(s.name) = k and s.player_key = dk)
     and not exists (select 1 from daily_scores s where acct_key(s.name) = k and s.player_key = dk) then
    return json_build_object('error', 'name_taken');
  end if;
  for i in 1..4 loop v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1); end loop;
  begin
    insert into accounts (name, name_key, code) values (nm, k, v_code) returning * into a;
  exception when unique_violation then return json_build_object('error', 'name_taken');
  end;
  insert into account_devices (device_key, account_id) values (dk, a.id)
    on conflict (device_key) do update set account_id = excluded.account_id, linked_at = now();
  return acct_json(a);
end $$;

/** Joins this browser to the account with that name, with its code → { name, code, progress } | { error: 'bad_code' } */
create or replace function public.account_link(p_name text, p_code text, p_secret text) returns json
language plpgsql security definer set search_path = public as $$
declare a accounts;
begin
  if length(coalesce(p_secret, '')) < 16 then raise exception 'Datos inválidos' using errcode = '22023'; end if;
  select * into a from accounts where name_key = acct_key(acct_clean(p_name)) for update;
  if not found or a.failed >= 10 then perform pg_sleep(0.5); return json_build_object('error', 'bad_code'); end if;
  if upper(btrim(coalesce(p_code, ''))) <> a.code then
    update accounts set failed = failed + 1 where id = a.id;
    perform pg_sleep(0.5);
    return json_build_object('error', 'bad_code');
  end if;
  update accounts set failed = 0 where id = a.id;
  insert into account_devices (device_key, account_id) values (acct_device(p_secret), a.id)
    on conflict (device_key) do update set account_id = excluded.account_id, linked_at = now();
  return acct_json(a);
end $$;

/** Merges this browser's progress into its account → the merged progress (null without an account) */
create or replace function public.account_sync(p_secret text, p_progress jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a accounts; merged jsonb;
begin
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = acct_device(p_secret) for update of x;
  if not found then return null; end if;
  if length(coalesce(p_progress::text, '')) > 300000 then raise exception 'Datos inválidos' using errcode = '22023'; end if;
  merged := acct_merge(a.progress, p_progress);
  update accounts set progress = merged where id = a.id;
  return merged;
end $$;

/** For the score paths: the account's spelling of the name, if this browser owns it; otherwise an error. */
create or replace function public.account_guard(p_name text, p_secret text) returns text
language plpgsql stable security definer set search_path = public as $$
declare a accounts;
begin
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = acct_device(p_secret);
  if not found then raise exception 'Primero escribe tu nombre' using errcode = '42501'; end if;
  if a.name_key <> acct_key(acct_clean(p_name)) then raise exception 'Ese nombre es de otra cuenta' using errcode = '42501'; end if;
  return a.name;
end $$;

revoke all on function public.acct_merge(jsonb, jsonb), public.acct_json(public.accounts), public.account_guard(text, text) from public, anon, authenticated;
grant execute on function public.account_guard(text, text) to service_role; -- the submit-score function checks the name with it
revoke all on function public.account_me(text), public.account_claim(text, text), public.account_link(text, text, text), public.account_sync(text, jsonb) from public;
grant execute on function public.account_me(text), public.account_claim(text, text), public.account_link(text, text, text), public.account_sync(text, jsonb) to anon, authenticated;

-- song of the day: only from the account's browsers (same function as daily.sql plus the account check)
create or replace function public.submit_daily(
  p_day date, p_song_id text, p_diff text, p_lanes int, p_name text, p_secret text,
  p_score int, p_acc real, p_max_combo int, p_stars int
) returns json
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Bogota')::date;
  nm text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 16);
  k text; g record; n int; mx bigint; ln int; best int; prev int; rnk int; total int;
begin
  if p_day is null or p_day not in (today, today - 1) or p_diff not in ('easy', 'medium', 'hard', 'expert') or p_lanes not in (4, 5)
     or nm = '' or length(coalesce(p_secret, '')) < 16 or p_score is null or p_score <= 0
     or p_acc is null or p_acc = 'NaN'::real or p_acc < 0 or p_acc > 1
     or coalesce(p_stars, -1) not between 1 and 5 or coalesce(p_max_combo, -1) < 0 then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  nm := account_guard(nm, p_secret); -- the name must belong to this browser's account (and comes back as the account spells it)
  if not exists (select 1 from daily x where x.day = p_day and x.song_id = p_song_id) then
    raise exception 'Esa no es la canción del día' using errcode = '22023';
  end if;
  select id, diffs, duration_ms into g from songs where id = p_song_id;
  n := coalesce((g.diffs -> p_diff ->> 'n')::int, 0);
  -- ×8 on every note (star power on a full multiplier) plus every second of the song held at ×8
  select coalesce(sum(50 * 2 * least(4, 1 + i / 10)), 0) into mx from generate_series(0, n - 1) i;
  mx := mx + (60 * 8 * coalesce(g.duration_ms, 600000) / 1000) * 2 + 100;
  if n = 0 or p_score > mx or p_max_combo > n then
    raise exception 'Puntaje no válido' using errcode = '22023';
  end if;
  -- the strings really used (same rule as the song boards): a 5-string run of a chart without the 5th string is a 4-string run
  ln := case when p_lanes = 5 and coalesce(g.diffs -> p_diff -> 'lanes', '[4]'::jsonb) @> '[4]'::jsonb then 5 else 4 end;
  k := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  -- one run at a time: a browser can't send runs faster than half the song plays
  if exists (select 1 from daily_scores s where s.player_key = k
             and s.tried_at > now() - make_interval(secs => greatest(20, coalesce(g.duration_ms, 60000) / 2000.0))) then
    raise exception 'Espera a terminar la canción para enviar otra vez' using errcode = '22023';
  end if;
  select s.score into prev from daily_scores s where s.day = p_day and s.song_id = p_song_id and s.diff = p_diff and s.lanes = ln and s.name_key = lower(nm);
  insert into daily_scores (day, song_id, diff, lanes, name, player_key, score, acc, max_combo, stars, tried_at)
  values (p_day, p_song_id, p_diff, ln, nm, k, p_score, p_acc, p_max_combo, p_stars, now())
  on conflict (day, song_id, diff, lanes, name_key) do update set
    tried_at = now(), player_key = excluded.player_key,
    score = greatest(excluded.score, daily_scores.score),
    acc = case when excluded.score > daily_scores.score then excluded.acc else daily_scores.acc end,
    max_combo = case when excluded.score > daily_scores.score then excluded.max_combo else daily_scores.max_combo end,
    stars = case when excluded.score > daily_scores.score then excluded.stars else daily_scores.stars end,
    name = case when excluded.score > daily_scores.score then excluded.name else daily_scores.name end,
    updated_at = case when excluded.score > daily_scores.score then now() else daily_scores.updated_at end;
  best := greatest(p_score, coalesce(prev, 0));
  select count(*) + 1 into rnk from daily_scores s where s.day = p_day and s.song_id = p_song_id and s.diff = p_diff and s.lanes = ln and s.score > best;
  select count(*) into total from daily_scores s where s.day = p_day and s.song_id = p_song_id and s.diff = p_diff and s.lanes = ln;
  return json_build_object('day', p_day, 'best', best, 'rank', rnk, 'players', total, 'lanes', ln, 'newRecord', prev is null or p_score > prev);
end $$;

