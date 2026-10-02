-- Corde — leaderboards by name (applied after schema.sql).
-- Every board shows each name once (case-insensitive), keeping its best score. The submit-score
-- function writes one row per name; the views also fold any older duplicate rows.

alter table public.scores add column if not exists name_key text generated always as (lower(btrim(name))) stored;
create index if not exists scores_name_idx on public.scores (song_id, diff, lanes, name_key);
grant select (name_key) on public.scores to anon, authenticated;

-- one song + difficulty + string count
create view public.board_song with (security_invoker = true) as
select distinct on (song_id, diff, lanes, name_key) song_id, diff, lanes, name, score, acc, max_combo, updated_at
from public.scores
where score > 0
order by song_id, diff, lanes, name_key, score desc, updated_at;

-- home screen, "Total": sum of each name's best score on every song (best difficulty per song)
create view public.board_total with (security_invoker = true) as
with best as (
  select lanes, name_key, song_id, max(score) as score
  from public.scores where score > 0
  group by lanes, name_key, song_id
)
select b.lanes,
  (select s.name from public.scores s where s.lanes = b.lanes and s.name_key = b.name_key order by s.updated_at desc limit 1) as name,
  sum(b.score)::bigint as total,
  count(*)::int as songs
from best b
group by b.lanes, b.name_key;

-- home screen, "Mejor canción": each name's single best run
create view public.board_best with (security_invoker = true) as
select distinct on (s.lanes, s.name_key)
  s.lanes, s.name, s.score, s.diff, s.song_id, g.name as song, g.artist
from public.scores s
join public.songs g on g.id = s.song_id
where s.score > 0
order by s.lanes, s.name_key, s.score desc, s.updated_at;

grant select on public.board_song, public.board_total, public.board_best to anon, authenticated;
