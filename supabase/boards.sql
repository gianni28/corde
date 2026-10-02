-- Corde — leaderboards by name (applied after schema.sql).
-- Every board shows each name once (case-insensitive), keeping its best score. The submit-score
-- function writes one row per name; the views also fold any older duplicate rows.

alter table public.scores add column if not exists name_key text generated always as (lower(btrim(name))) stored;
create index if not exists scores_name_idx on public.scores (song_id, diff, lanes, name_key);
grant select (name_key) on public.scores to anon, authenticated;

-- Every run counted under the strings really used: a 5-string run of a difficulty whose chart never
-- touches the 5th string plays the same notes as on 4, so it belongs to the 4-string board.
create view public.score_entries with (security_invoker = true) as
select s.id, s.song_id, s.diff,
  (case when s.lanes = 5 and coalesce(g.diffs->s.diff->'lanes', '[4]'::jsonb) @> '[4]'::jsonb then 5 else 4 end)::smallint as lanes,
  s.name, s.name_key, s.score, s.acc, s.max_combo, s.updated_at, g.name as song, g.artist
from public.scores s join public.songs g on g.id = s.song_id
where s.score > 0;

-- one song + difficulty + string count
create or replace view public.board_song with (security_invoker = true) as
select distinct on (song_id, diff, lanes, name_key) song_id, diff, lanes, name, score, acc, max_combo, updated_at
from public.score_entries
order by song_id, diff, lanes, name_key, score desc, updated_at;

-- home screen, "Total": sum of each name's best score on every song (best difficulty per song)
create or replace view public.board_total with (security_invoker = true) as
with best as (
  select lanes, name_key, song_id, max(score) as score from public.score_entries group by lanes, name_key, song_id
)
select b.lanes,
  (select e.name from public.score_entries e where e.lanes = b.lanes and e.name_key = b.name_key order by e.updated_at desc limit 1) as name,
  sum(b.score)::bigint as total,
  count(*)::int as songs
from best b
group by b.lanes, b.name_key;

-- home screen, "Mejor canción": each name's single best run
create or replace view public.board_best with (security_invoker = true) as
select distinct on (lanes, name_key) lanes, name, score, diff, song_id, song, artist
from public.score_entries
order by lanes, name_key, score desc, updated_at;

grant select on public.score_entries, public.board_song, public.board_total, public.board_best to anon, authenticated;

-- home screen boards with every string count together (what the game shows now)
create view public.board_total_all with (security_invoker = true) as
with best as (
  select name_key, song_id, max(score) as score from public.score_entries group by name_key, song_id
)
select (select e.name from public.score_entries e where e.name_key = b.name_key order by e.updated_at desc limit 1) as name,
  sum(b.score)::bigint as total,
  count(*)::int as songs
from best b
group by b.name_key;
create view public.board_best_all with (security_invoker = true) as
select distinct on (name_key) name, score, diff, song_id, song, artist
from public.score_entries
order by name_key, score desc, updated_at;
grant select on public.board_total_all, public.board_best_all to anon, authenticated;
