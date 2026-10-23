-- Corde — the song of the day's calendar (after daily.sql).
-- The next days are picked ahead (same rules: never a secret song, charted songs first, nothing that's the song of
-- the day within 30 days either side), and the admin can change any of them from tomorrow on (manual) or give it
-- back to the automatic pick. Today's song never changes once it's out (its board would split).

alter table public.daily add column if not exists manual boolean not null default false;

-- the upcoming days stay out of sight: anyone reads today's and the past ones (the game asks daily_today)
drop policy if exists "daily is public" on public.daily;
create policy "daily is public" on public.daily for select using (day <= (now() at time zone 'America/Bogota')::date and exists (select 1 from songs g where g.id = daily.song_id));

-- a pick for day d
create or replace function public.daily_pick(d date) returns text
language sql volatile security definer set search_path = public as $$
  select coalesce(
    (select g.id from songs g
      where not g.hidden and g.id not in (select y.song_id from daily y where y.day > d - 30 and y.day < d + 30 and y.day <> d)
      order by (g.charter is distinct from 'Corde (automático)') desc,
               (coalesce((g.diffs -> 'easy' ->> 'n')::int, 0) > 0 and coalesce((g.diffs -> 'expert' ->> 'n')::int, 0) > 0) desc,
               random()
      limit 1),
    (select g.id from songs g where not g.hidden order by random() limit 1)); -- fewer songs than days
$$;
revoke all on function public.daily_pick(date) from public, anon, authenticated;

-- today and the next days get their song if they have none (or it went secret since)
create or replace function public.daily_fill(p_days int default 21) returns void
language plpgsql security definer set search_path = public as $$
declare d0 date := (now() at time zone 'America/Bogota')::date; i int; s text;
begin
  for i in 0 .. least(greatest(coalesce(p_days, 21), 1), 60) - 1 loop
    if not exists (select 1 from daily x join songs g on g.id = x.song_id and not g.hidden where x.day = d0 + i) then
      s := daily_pick(d0 + i);
      if s is null then return; end if;
      insert into daily (day, song_id) values (d0 + i, s) on conflict (day) do update set song_id = excluded.song_id, manual = false;
    end if;
  end loop;
end $$;
revoke all on function public.daily_fill(int) from public, anon, authenticated;

-- Today's song: { day, song_id } (picked here if the calendar hasn't got it yet)
create or replace function public.daily_today() returns json
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'America/Bogota')::date;
  s text;
begin
  select x.song_id into s from daily x join songs g on g.id = x.song_id and not g.hidden where x.day = d;
  if s is null then
    s := daily_pick(d);
    if s is null then return null; end if;
    insert into daily (day, song_id) values (d, s)
    on conflict (day) do update set song_id = excluded.song_id, manual = false
      where exists (select 1 from songs h where h.id = daily.song_id and h.hidden);
    select x.song_id into s from daily x where x.day = d; -- whoever asked first decided it
  end if;
  -- now: the server clock (ms), so a phone with its clock off still counts down to the real midnight
  return json_build_object('day', d, 'song_id', s, 'now', floor(extract(epoch from clock_timestamp()) * 1000));
end $$;
