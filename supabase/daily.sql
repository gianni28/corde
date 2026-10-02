-- Corde — song of the day (applied after boards.sql).
-- One song a day for everyone, by Colombia's calendar. It's picked at random the first time anyone asks for it
-- (charted songs before auto-generated ones, never one from the last 30 days) and stays fixed for the day.
-- Runs of it go to the day's board: one entry per name, difficulty and strings really used (4 or 5, the same rule
-- as the song boards), keeping the best.

create table if not exists public.daily (
  day        date primary key,
  song_id    text not null references public.songs (id) on delete cascade, -- a deleted song makes way for a new pick
  created_at timestamptz not null default now()
);

create table if not exists public.daily_scores (
  id         bigint generated always as identity primary key,
  day        date not null,
  song_id    text not null,
  diff       text not null check (diff in ('easy', 'medium', 'hard', 'expert')),
  lanes      smallint not null,           -- strings really used (4 or 5)
  name       text not null,
  name_key   text generated always as (lower(btrim(name))) stored,
  player_key text not null,               -- sha-256 of a secret kept in the browser (never readable)
  score      integer not null,
  acc        real not null default 0,
  max_combo  integer not null default 0,
  stars      smallint not null default 0,
  updated_at timestamptz not null default now(), -- when the best run was set
  tried_at   timestamptz not null default now(), -- the last run sent (one run at a time per browser)
  constraint daily_scores_board_key unique (day, song_id, diff, lanes, name_key)
);
create index if not exists daily_scores_song_board_idx on public.daily_scores (day, song_id, diff, lanes, score desc);
create index if not exists daily_scores_tried_idx on public.daily_scores (player_key, tried_at desc);

alter table public.daily enable row level security;
alter table public.daily_scores enable row level security;
drop policy if exists "daily is public" on public.daily;
create policy "daily is public" on public.daily for select using (true);
drop policy if exists "daily scores are public" on public.daily_scores;
create policy "daily scores are public" on public.daily_scores for select using (true);
-- writes only through the functions below; player_key stays hidden
revoke all on public.daily, public.daily_scores from anon, authenticated;
grant select on public.daily to anon, authenticated;
grant select (id, day, song_id, diff, lanes, name, name_key, score, acc, max_combo, stars, updated_at) on public.daily_scores to anon, authenticated;

-- Today's song: { day, song_id } (picks it if nobody has asked yet today)
create or replace function public.daily_today() returns json
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'America/Bogota')::date;
  s text;
begin
  select x.song_id into s from daily x where x.day = d;
  if s is null then
    select g.id into s from songs g
    where g.id not in (select y.song_id from daily y where y.day > d - 30)
    order by (g.charter is distinct from 'Corde (automático)') desc,
             (coalesce((g.diffs -> 'easy' ->> 'n')::int, 0) > 0 and coalesce((g.diffs -> 'expert' ->> 'n')::int, 0) > 0) desc,
             random()
    limit 1;
    if s is null then select g.id into s from songs g order by random() limit 1; end if; -- fewer than 30 songs
    if s is null then return null; end if;
    insert into daily (day, song_id) values (d, s) on conflict (day) do nothing;
    select x.song_id into s from daily x where x.day = d; -- whoever asked first decided it
  end if;
  -- now: the server clock (ms), so a phone with its clock off still counts down to the real midnight
  return json_build_object('day', d, 'song_id', s, 'now', floor(extract(epoch from clock_timestamp()) * 1000));
end $$;

-- A run of the day's song. Same checks as the submit-score function (no impossible scores), sane accuracy, stars
-- and combo, and one run at a time per browser. p_day is the day the song was the song of the day (a song started
-- just before midnight still counts for that day).
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

revoke all on function public.daily_today() from public;
revoke all on function public.submit_daily(date, text, text, int, text, text, int, real, int, int) from public;
grant execute on function public.daily_today() to anon, authenticated;
grant execute on function public.submit_daily(date, text, text, int, text, text, int, real, int, int) to anon, authenticated;
