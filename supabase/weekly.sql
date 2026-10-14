-- Corde — weekly boards (applied after boards.sql and accounts.sql).
-- Same boards as always, but only with what was played this week: Monday 00:00 to Sunday 23:59, Colombia time.
-- Every Monday they start empty, so someone new has a real chance of being on top. The submit-score function
-- writes here too (one row per name, song, difficulty and strings really used, keeping the week's best).

create or replace function public.corde_week() returns date
language sql stable set search_path = public as $$
  select date_trunc('week', now() at time zone 'America/Bogota')::date
$$;
grant execute on function public.corde_week() to anon, authenticated, service_role;

create table if not exists public.weekly_scores (
  id         bigint generated always as identity primary key,
  week       date not null,                  -- the Monday that starts the week
  song_id    text not null references public.songs (id) on delete cascade,
  diff       text not null check (diff in ('easy', 'medium', 'hard', 'expert')),
  lanes      smallint not null,              -- strings really used (4 or 5)
  name       text not null,
  name_key   text generated always as (lower(btrim(name))) stored,
  score      integer not null check (score > 0),
  acc        real not null default 0,
  max_combo  integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint weekly_scores_board_key unique (week, song_id, diff, lanes, name_key)
);
create index if not exists weekly_scores_board_idx on public.weekly_scores (week, song_id, diff, lanes, score desc);
create index if not exists weekly_scores_name_idx on public.weekly_scores (week, name_key);

alter table public.weekly_scores enable row level security;
drop policy if exists "weekly scores are public" on public.weekly_scores;
create policy "weekly scores are public" on public.weekly_scores for select using (true);
revoke all on public.weekly_scores from anon, authenticated;
grant select on public.weekly_scores to anon, authenticated;

-- a validated run (only the submit-score function calls this, after its checks and the account check)
create or replace function public.weekly_submit(
  p_song_id text, p_diff text, p_lanes int, p_name text, p_score int, p_acc real, p_max_combo int
) returns void
language sql security definer set search_path = public as $$
  insert into weekly_scores as w (week, song_id, diff, lanes, name, score, acc, max_combo)
  values (corde_week(), p_song_id, p_diff, p_lanes, p_name, p_score, coalesce(p_acc, 0), coalesce(p_max_combo, 0))
  on conflict on constraint weekly_scores_board_key do update
    set name = excluded.name, score = excluded.score, acc = excluded.acc, max_combo = excluded.max_combo, updated_at = now()
    where excluded.score > w.score
$$;
revoke all on function public.weekly_submit(text, text, int, text, int, real, int) from public, anon, authenticated;
grant execute on function public.weekly_submit(text, text, int, text, int, real, int) to service_role;

-- this week's board for one song + difficulty + strings (hidden songs drop out: songs is filtered for players)
create or replace view public.board_week_song with (security_invoker = true) as
select w.song_id, w.diff, w.lanes, w.name, w.score, w.acc, w.max_combo, w.updated_at
from public.weekly_scores w join public.songs g on g.id = w.song_id
where w.week = public.corde_week();

-- home screen this week, "Total": each name's best of the week on every song, added up
create or replace view public.board_week_total with (security_invoker = true) as
with e as (
  select w.name_key, w.name, w.song_id, w.score, w.updated_at
  from public.weekly_scores w join public.songs g on g.id = w.song_id
  where w.week = public.corde_week()
), best as (
  select name_key, song_id, max(score) as score from e group by name_key, song_id
)
select (select e.name from e where e.name_key = b.name_key order by e.updated_at desc limit 1) as name,
  sum(b.score)::bigint as total,
  count(*)::int as songs
from best b
group by b.name_key;

-- home screen this week, "Mejor canción": each name's single best run of the week
create or replace view public.board_week_best with (security_invoker = true) as
select distinct on (w.name_key) w.name, w.score, w.diff, w.song_id, g.name as song, g.artist
from public.weekly_scores w join public.songs g on g.id = w.song_id
where w.week = public.corde_week()
order by w.name_key, w.score desc, w.updated_at;

grant select on public.board_week_song, public.board_week_total, public.board_week_best to anon, authenticated;
