-- Corde — the Otaku event (after shop.sql, progress.sql, achievements.sql). The anime songs live in a secret group
-- (its code is made from the admin panel, never written here). Playing them, golden bananas ride on some notes: the
-- bananas a player picks up fill a bar with three surprise gifts, each one a logro whose prize is in the shop
-- (src/achievements.js forBananas, src/shop.js). The gifts don't show anywhere until they're won.

-- a new part of the look: pets ("ninguna" is the default, no pet)
alter table public.shop_items drop constraint if exists shop_items_slot_check;
alter table public.shop_items add constraint shop_items_slot_check
  check (slot in ('neck', 'gems', 'flames', 'strings', 'star', 'name', 'streak', 'crowd', 'pet'));

insert into public.shop_items (slot, id, price, req, sort) values
  ('pet', 'ninguna', 0, null, 0),
  ('gems', 'titi', 0, 'otaku-titi', 40),
  ('pet', 'nero', 0, 'otaku-nero', 10),
  ('flames', 'antimagia', 0, 'otaku-antimagia', 40)
on conflict (slot, id) do update set price = excluded.price, req = excluded.req, sort = excluded.sort, active = true;

-- the bananas travel with the account like the rest of the progress (the most a device has seen wins)
create or replace function public.acct_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare days jsonb; bests jsonb := coalesce(a -> 'bests', '{}'::jsonb); tour jsonb; ach jsonb := '{}'::jsonb;
  s text; d text; v jsonb; cur jsonb; ban int;
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
  ban := least(100000, greatest(
    case when jsonb_typeof(a -> 'bananas') = 'number' then (a ->> 'bananas')::numeric::int else 0 end,
    case when jsonb_typeof(b -> 'bananas') = 'number' then (b ->> 'bananas')::numeric::int else 0 end, 0));
  return jsonb_build_object('days', days, 'bests', bests, 'tour', tour, 'ach', ach, 'bananas', ban);
end $$;
