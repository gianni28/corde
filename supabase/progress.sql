-- Corde — levels and daily challenges (after shop.sql).
-- Every púa earned playing (runs and the song of the day's bonus) is also experience (xp). Levels pay púas when
-- they're reached, and levels 5, 10 and 20 give a name style nobody can buy. Three challenges a day (the same for
-- everyone, on Colombia's calendar) pay púas when they're done, and a bit more for doing all three. The submit-score
-- function counts them on every paid run, so the cooldown that guards the run's púas guards them too.

alter table public.wallets
  add column if not exists xp      int not null default 0,  -- púas earned playing (not welcome, challenges or levels)
  add column if not exists lvl     int not null default 1,  -- the last level whose reward got paid
  add column if not exists ch_day  date,                    -- the day ch_prog is about
  add column if not exists ch_prog int[];                   -- progress on that day's three challenges
alter table public.shop_items add column if not exists lvl int; -- a level's prize: free from that level on

-- players who were already playing: what they've earned playing so far counts (their level rewards come with their next run)
update public.wallets w set xp = t.s
from (select account_id, sum(delta)::int s from public.wallet_ledger where delta > 0 and reason in ('run', 'daily') group by account_id) t
where t.account_id = w.account_id and w.xp = 0;

insert into public.shop_items (slot, id, price, req, sort, lvl) values
  ('name', 'plata', 0, null, 20, 5), ('name', 'electrico', 0, null, 21, 10), ('name', 'estrella', 0, null, 22, 20)
on conflict (slot, id) do update set lvl = excluded.lvl, price = 0, req = null;

/** The level some xp reaches: level L needs 25(L-1)² + 75(L-1) (100, 250, 450, 700, …) */
create or replace function public.level_of(p_xp int) returns int
language sql immutable as $$
  select least(99, 1 + floor((sqrt(5625 + 100.0 * greatest(0, coalesce(p_xp, 0))) - 75) / 50)::int)
$$;

/** The day's three challenges: one of playing, one of playing well, one of a harder kind → [{ k, n, r }] */
create or replace function public.challenges_for(p_day date) returns jsonb
language sql immutable as $$
  select jsonb_build_array(
    (array['{"k":"runs","n":3,"r":25}', '{"k":"runs","n":5,"r":40}']::jsonb[])[1 + abs(hashtext(p_day::text || 'a')) % 2],
    (array['{"k":"stars","n":4,"r":30}', '{"k":"stars","n":5,"r":45}', '{"k":"acc","n":90,"r":30}', '{"k":"acc","n":95,"r":45}']::jsonb[])[1 + abs(hashtext(p_day::text || 'b')) % 4],
    (array['{"k":"combo","n":100,"r":30}', '{"k":"combo","n":250,"r":45}', '{"k":"hard","n":1,"r":30}', '{"k":"expert","n":1,"r":40}']::jsonb[])[1 + abs(hashtext(p_day::text || 'c')) % 4]
  )
$$;

/** Púas outside the day's 500 (challenges and levels: they have their own limits) — internal */
create or replace function public.wallet_bonus(p_account uuid, p_amount int, p_reason text, p_ref text) returns void
language sql security definer set search_path = public as $$
  update wallets set picks = picks + p_amount, earned_total = earned_total + p_amount where account_id = p_account;
  insert into wallet_ledger (account_id, delta, reason, ref) values (p_account, p_amount, p_reason, p_ref);
$$;

-- what's earned playing is also xp
create or replace function public.wallet_pay(p_account uuid, p_amount int, p_reason text, p_ref text) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Bogota')::date; w wallets; paid int;
begin
  select * into w from wallets where account_id = p_account for update;
  if not found then return 0; end if;
  if w.day is distinct from today then w.day_earned := 0; end if;
  paid := greatest(0, least(coalesce(p_amount, 0), 500 - w.day_earned));
  update wallets set picks = picks + paid, earned_total = earned_total + paid, day = today, day_earned = w.day_earned + paid,
    xp = xp + case when p_reason in ('run', 'daily') then paid else 0 end
    where account_id = p_account;
  if paid > 0 then insert into wallet_ledger (account_id, delta, reason, ref) values (p_account, paid, p_reason, p_ref); end if;
  return paid;
end $$;

/** Pays the levels reached since the last paid one (25 × each level) → { from, to, reward } | null — internal */
create or replace function public.wallet_levelup(p_account uuid) returns json
language plpgsql security definer set search_path = public as $$
declare w wallets; L int; pay int;
begin
  select * into w from wallets where account_id = p_account for update;
  if not found then return null; end if;
  L := level_of(w.xp);
  if L <= w.lvl then return null; end if;
  select sum(25 * i)::int into pay from generate_series(w.lvl + 1, L) i;
  update wallets set lvl = L where account_id = p_account;
  perform wallet_bonus(p_account, pay, 'level', L::text);
  return json_build_object('from', w.lvl, 'to', L, 'reward', pay);
end $$;

-- the wallet now brings its level and the day's challenges: { picks, owned, equipped, xp, level, ch: [{ k, n, r, p }] }
create or replace function public.wallet_json(w public.wallets) returns json
language sql stable set search_path = public as $$
  select case when w.account_id is null then null
    else json_build_object('picks', w.picks, 'owned', to_json(w.owned), 'equipped', w.equipped, 'xp', w.xp, 'level', level_of(w.xp),
      'ch', (select jsonb_agg(e.c || jsonb_build_object('p', case when w.ch_day = d.today then coalesce(w.ch_prog[e.i], 0) else 0 end) order by e.i)
             from (select (now() at time zone 'America/Bogota')::date today) d, jsonb_array_elements(challenges_for(d.today)) with ordinality e(c, i))) end
$$;

/** A finished run, now with what the challenges need (accuracy 0..1 and the best combo)
 *  → { earned, balance, base, first, record, reason, challenges: [{ k, n, r }] done now, all: bonus | 0, level: { from, to, reward } | null,
 *      xp, lvl } | null (no account) */
create or replace function public.wallet_award(
  p_secret text, p_song_id text, p_diff text, p_stars int, p_first boolean, p_record boolean, p_acc real, p_combo int
) returns json
language plpgsql security definer set search_path = public as $$
declare
  acc uuid; w wallets; dur int; earned int := 0; why text := 'ok';
  st int := least(5, greatest(1, coalesce(p_stars, 1)));
  base int;
  fst int := case when p_first then 15 else 0 end;
  rec int := case when p_record and not coalesce(p_first, false) then 10 else 0 end;
  today date := (now() at time zone 'America/Bogota')::date;
  chs jsonb := challenges_for(today); c jsonb; prog int[]; n int; was int; v int;
  done jsonb := '[]'::jsonb; allb int := 0; lv json;
begin
  if p_diff is null or p_diff not in ('easy', 'medium', 'hard', 'expert') then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  select d.account_id into acc from account_devices d where d.device_key = acct_device(p_secret);
  if not found then return null; end if;
  perform wallet_ensure(acc);
  select * into w from wallets where account_id = acc for update;
  select g.duration_ms into dur from songs g where g.id = p_song_id;
  base := round(case p_diff when 'easy' then 10 when 'medium' then 15 when 'hard' then 22 else 30 end * (0.5 + 0.1 * st));
  if w.last_award_at > now() - make_interval(secs => greatest(20, coalesce(dur, 60000) / 2000.0)) then
    why := 'cooldown';
  else
    earned := wallet_pay(acc, base + fst + rec, 'run', p_song_id || ':' || p_diff);
    if earned < base + fst + rec then why := 'cap'; end if;
    update wallets set last_award_at = now() where account_id = acc;
    -- the day's challenges
    prog := case when w.ch_day = today and w.ch_prog is not null then w.ch_prog else array[0, 0, 0] end;
    for i in 1..3 loop
      c := chs -> (i - 1); n := (c ->> 'n')::int; was := prog[i];
      v := case c ->> 'k'
        when 'runs' then was + 1
        when 'stars' then greatest(was, st)
        when 'acc' then greatest(was, floor(100 * least(1, greatest(0, coalesce(p_acc, 0))))::int)
        when 'combo' then greatest(was, least(100000, greatest(0, coalesce(p_combo, 0))))
        when 'hard' then case when p_diff in ('hard', 'expert') then 1 else was end
        when 'expert' then case when p_diff = 'expert' then 1 else was end
        else was end;
      prog[i] := least(v, n);
      if was < n and prog[i] >= n then
        done := done || jsonb_build_array(c);
        perform wallet_bonus(acc, (c ->> 'r')::int, 'challenge', today::text || ':' || i);
      end if;
    end loop;
    if jsonb_array_length(done) > 0 and prog[1] >= (chs -> 0 ->> 'n')::int and prog[2] >= (chs -> 1 ->> 'n')::int and prog[3] >= (chs -> 2 ->> 'n')::int then
      allb := 30;
      perform wallet_bonus(acc, allb, 'challenge', today::text || ':all');
    end if;
    update wallets set ch_day = today, ch_prog = prog where account_id = acc;
    lv := wallet_levelup(acc);
  end if;
  select * into w from wallets where account_id = acc;
  return json_build_object('earned', earned, 'balance', w.picks, 'base', base, 'first', fst, 'record', rec, 'reason', why,
    'challenges', done, 'all', allb, 'level', lv, 'xp', w.xp, 'lvl', level_of(w.xp));
end $$;

/** Buys an item (and puts it on); a logro's or a level's prize is claimed for free once it's earned */
create or replace function public.shop_buy(p_secret text, p_slot text, p_item text) returns json
language plpgsql security definer set search_path = public as $$
declare a accounts; it shop_items; w wallets; k text := p_slot || ':' || p_item; cost int; prize boolean;
begin
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = acct_device(p_secret);
  if not found then return json_build_object('error', 'no_account'); end if;
  select * into it from shop_items where slot = p_slot and id = p_item and active;
  if not found then return json_build_object('error', 'unknown'); end if;
  perform wallet_ensure(a.id);
  select * into w from wallets where account_id = a.id for update;
  prize := it.req is not null or it.lvl is not null;
  if (it.price = 0 and not prize) or k = any(w.owned) then return json_build_object('error', 'owned'); end if;
  if it.req is not null and not coalesce(a.progress -> 'ach' ? it.req, false) then
    return json_build_object('error', 'locked');
  end if;
  if it.lvl is not null and level_of(w.xp) < it.lvl then return json_build_object('error', 'locked'); end if;
  cost := case when prize then 0 else it.price end;
  if w.picks < cost then return json_build_object('error', 'not_enough'); end if;
  update wallets set picks = picks - cost, owned = array_append(owned, k), equipped = equipped || jsonb_build_object(p_slot, p_item)
    where account_id = a.id returning * into w;
  insert into wallet_ledger (account_id, delta, reason, ref) values (a.id, -cost, case when prize then 'claim' else 'buy' end, k);
  return wallet_json(w);
end $$;

-- a level's prize costs 0 but isn't a default
create or replace function public.shop_equip(p_secret text, p_slot text, p_item text) returns json
language plpgsql security definer set search_path = public as $$
declare acc uuid; w wallets; dflt boolean;
begin
  select d.account_id into acc from account_devices d where d.device_key = acct_device(p_secret);
  if not found then return json_build_object('error', 'no_account'); end if;
  select exists (select 1 from shop_items i where i.slot = p_slot and i.price = 0 and i.req is null and i.lvl is null and (p_item is null or i.id = p_item)) into dflt;
  perform wallet_ensure(acc);
  select * into w from wallets where account_id = acc for update;
  if dflt then
    update wallets set equipped = equipped - p_slot where account_id = acc returning * into w;
  elsif p_slot || ':' || p_item = any(w.owned) then
    update wallets set equipped = equipped || jsonb_build_object(p_slot, p_item) where account_id = acc returning * into w;
  else
    return json_build_object('error', 'not_owned');
  end if;
  return wallet_json(w);
end $$;

revoke all on function public.level_of(int), public.challenges_for(date), public.wallet_bonus(uuid, int, text, text),
  public.wallet_levelup(uuid), public.wallet_award(text, text, text, int, boolean, boolean, real, int) from public, anon, authenticated;
grant execute on function public.wallet_award(text, text, text, int, boolean, boolean, real, int) to service_role;

-- names on the boards: their style and, for every account, its level (the same formula as level_of, written out so
-- the players reading the view don't need to run that function)
create or replace view public.name_styles with (security_invoker = false) as
select a.name_key, nullif(w.equipped ->> 'name', 'normal') as style,
  least(99, 1 + floor((sqrt(5625 + 100.0 * greatest(0, w.xp)) - 75) / 50)::int) as level
from public.wallets w join public.accounts a on a.id = w.account_id;
revoke all on public.name_styles from public, anon, authenticated;
grant select on public.name_styles to anon, authenticated;

-- more level prizes: 3, 15, 30 and 50
insert into public.shop_items (slot, id, price, req, sort, lvl) values
  ('strings', 'bronce', 0, null, 20, 3), ('flames', 'aurora', 0, null, 20, 15), ('star', 'atardecer', 0, null, 20, 30), ('streak', 'platino', 0, null, 20, 50)
on conflict (slot, id) do update set lvl = excluded.lvl, price = 0, req = null;
