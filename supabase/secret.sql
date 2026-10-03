-- Corde — secret songs (applied after daily.sql).
-- Some songs are hidden: they never show up for anyone (library, song of the day, home boards) until the player
-- types the secret code behind the hidden pick in the library. The code is checked here, so the hidden songs never
-- reach a browser that doesn't know it. The admin sets the code and hides/shows songs from the upload screen.

alter table public.songs add column if not exists hidden boolean not null default false;

-- the library only shows songs that aren't hidden (the home boards, which join songs as the player, follow suit)
alter policy "songs are public" on public.songs using (not hidden);

-- the code, as a sha-256 of its lowercased, trimmed text (only these functions and the admin function read it)
create table if not exists public.secret_config (
  id         int primary key default 1 check (id = 1),
  code_hash  text not null,
  updated_at timestamptz not null default now()
);
alter table public.secret_config enable row level security;
revoke all on public.secret_config from anon, authenticated;
-- first code: "pop" (change it from the upload screen)
insert into public.secret_config (id, code_hash) values (1, encode(sha256(convert_to('pop', 'UTF8')), 'hex')) on conflict (id) do nothing;

-- true when p_code is the secret code; a wrong guess waits a little, so guessing is slow
create or replace function public.secret_ok(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (select 1 from secret_config c where c.code_hash = encode(sha256(convert_to(lower(btrim(coalesce(p_code, ''))), 'UTF8')), 'hex')) into ok;
  if not ok then perform pg_sleep(0.6); end if;
  return ok;
end $$;
revoke all on function public.secret_ok(text) from public, anon, authenticated;

-- The hidden songs, for whoever knows the code
create or replace function public.secret_songs(p_code text) returns setof public.songs
language plpgsql security definer set search_path = public as $$
begin
  if not secret_ok(p_code) then raise exception 'Código incorrecto' using errcode = '28000'; end if;
  return query select * from songs where hidden order by artist, name;
end $$;

-- A hidden song's board (the board views can't see hidden songs as the player): same rows as board_song
create or replace function public.secret_board(p_code text, p_song_id text, p_diff text, p_lanes int, p_limit int default 10)
returns table (name text, score int, acc real, max_combo int)
language plpgsql security definer set search_path = public as $$
begin
  if not secret_ok(p_code) then raise exception 'Código incorrecto' using errcode = '28000'; end if;
  return query
    select b.name, b.score::int, b.acc::real, b.max_combo::int from board_song b
    join songs g on g.id = b.song_id and g.hidden
    where b.song_id = p_song_id and b.diff = p_diff and b.lanes = p_lanes
    order by b.score desc, b.updated_at limit least(greatest(coalesce(p_limit, 10), 1), 50);
end $$;

-- One song by its exact id, hidden or not: a friend who knows the code picks a secret song in a multiplayer room,
-- and everyone in the room needs it
create or replace function public.song_by_id(p_id text) returns setof public.songs
language sql stable security definer set search_path = public as $$
  select * from songs where id = p_id;
$$;

revoke all on function public.secret_songs(text) from public;
revoke all on function public.secret_board(text, text, text, int, int) from public;
revoke all on function public.song_by_id(text) from public;
grant execute on function public.secret_songs(text) to anon, authenticated;
grant execute on function public.secret_board(text, text, text, int, int) to anon, authenticated;
grant execute on function public.song_by_id(text) to anon, authenticated;

-- The song of the day is never a secret song (and if today's was hidden after it was picked, a new one is picked)
create or replace function public.daily_today() returns json
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'America/Bogota')::date;
  s text;
begin
  select x.song_id into s from daily x join songs g on g.id = x.song_id and not g.hidden where x.day = d;
  if s is null then
    select g.id into s from songs g
    where not g.hidden and g.id not in (select y.song_id from daily y where y.day > d - 30)
    order by (g.charter is distinct from 'Corde (automático)') desc,
             (coalesce((g.diffs -> 'easy' ->> 'n')::int, 0) > 0 and coalesce((g.diffs -> 'expert' ->> 'n')::int, 0) > 0) desc,
             random()
    limit 1;
    if s is null then select g.id into s from songs g where not g.hidden order by random() limit 1; end if; -- fewer than 30 songs
    if s is null then return null; end if;
    insert into daily (day, song_id) values (d, s)
    on conflict (day) do update set song_id = excluded.song_id
      where exists (select 1 from songs h where h.id = daily.song_id and h.hidden);
    select x.song_id into s from daily x where x.day = d; -- whoever asked first decided it
  end if;
  -- now: the server clock (ms), so a phone with its clock off still counts down to the real midnight
  return json_build_object('day', d, 'song_id', s, 'now', floor(extract(epoch from clock_timestamp()) * 1000));
end $$;
