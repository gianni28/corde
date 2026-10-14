-- Corde — logros in the account (applied after accounts.sql).
-- Same merge as before plus "ach": { id: "YYYY-MM-DD" } from every device, each kept with its earliest date.
-- Also: the secret songs' boards list everyone, like the other boards (up to 1000).

create or replace function public.acct_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare days jsonb; bests jsonb := coalesce(a -> 'bests', '{}'::jsonb); tour jsonb; ach jsonb := '{}'::jsonb;
  s text; d text; v jsonb; cur jsonb;
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
  -- logros: every id from both sides (at most 100, short ids), the earliest date wins
  select coalesce(jsonb_object_agg(k, dt), '{}'::jsonb) into ach from (
    select k, min(dt) as dt from (
      select key as k, value #>> '{}' as dt from jsonb_each(case when jsonb_typeof(a -> 'ach') = 'object' then a -> 'ach' else '{}'::jsonb end)
      union all
      select key, value #>> '{}' from jsonb_each(case when jsonb_typeof(b -> 'ach') = 'object' then b -> 'ach' else '{}'::jsonb end)
    ) u where k ~ '^[a-z0-9-]{1,40}$' and dt ~ '^\d{4}-\d{2}-\d{2}$'
    group by k order by k limit 100
  ) t;
  return jsonb_build_object('days', days, 'bests', bests, 'tour', tour, 'ach', ach);
end $$;
-- (create or replace keeps acct_merge's privileges: players can't call it directly)

create or replace function public.secret_board(p_code text, p_song_id text, p_diff text, p_lanes int, p_limit int default 1000)
returns table (name text, score int, acc real, max_combo int)
language plpgsql security definer set search_path = public as $$
begin
  if not secret_ok(p_code) then raise exception 'Código incorrecto' using errcode = '28000'; end if;
  return query
    select b.name, b.score::int, b.acc::real, b.max_combo::int from board_song b
    join songs g on g.id = b.song_id and g.hidden
    where b.song_id = p_song_id and b.diff = p_diff and b.lanes = p_lanes
    order by b.score desc, b.updated_at limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;
