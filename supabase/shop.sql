-- Corde — the shop: púas and cosmetics (applied after weekly.sql).
-- Playing earns púas (guitar picks), counted here on the server: only an account's browsers earn, and only for runs
-- that reach the submit-score function (finished, score > 0). They're spent in the Tienda on cosmetics (necks, gems,
-- flames, strings, star power, name, streak, crowd). The balance, what's owned and what's equipped live in the
-- account's wallet (never in progress: account_sync takes any JSON a browser sends).
--  - a run: by difficulty (easy 10, medium 15, hard 22, expert 30) × (0.5 + 0.1 × stars), +15 the first time on that
--    song's board, +10 for a new record. One paid run per account per half a song (at least 20 s), and 500 a day.
--  - the song of the day: +25 once a day (in submit_daily; its run is paid by submit-score like any other).
--  - a new wallet starts with 100, +5 for every song + difficulty the account already has on the boards.
-- Re-running this file is safe: it only creates what's missing, replaces the functions and updates the catalog.

-- the catalog: prices live here, not in the game (a price 0 without req is the slot's default, always owned;
-- one with req is an exclusive, free for an account whose logros include req)
create table if not exists public.shop_items (
  id     text not null,
  slot   text not null check (slot in ('neck', 'gems', 'flames', 'strings', 'star', 'name', 'streak', 'crowd')),
  price  int not null check (price >= 0),
  req    text,                               -- a logro id (src/achievements.js)
  sort   int not null default 0,
  active boolean not null default true,
  primary key (slot, id)
);
alter table public.shop_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_items' and policyname = 'shop items are public') then
    create policy "shop items are public" on public.shop_items for select using (true);
  end if;
end $$;
revoke all on public.shop_items from public, anon, authenticated;
grant select on public.shop_items to anon, authenticated; -- prices aren't secret

create table if not exists public.wallets (
  account_id      uuid primary key references public.accounts (id) on delete cascade,
  picks           int not null default 0 check (picks >= 0),
  earned_total    int not null default 0,
  owned           text[] not null default '{}',         -- "slot:id" of everything bought or claimed
  equipped        jsonb not null default '{}'::jsonb,   -- { slot: id }; a slot that isn't there wears its default
  last_award_at   timestamptz,                          -- the last paid run (one at a time per account)
  day             date,                                 -- the Colombia day day_earned counts
  day_earned      int not null default 0,
  daily_bonus_day date,                                 -- the last song of the day that paid its bonus
  created_at      timestamptz not null default now()
);
create table if not exists public.wallet_ledger (
  id         bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  delta      int not null,
  reason     text not null,                  -- welcome | run | daily | buy | claim
  ref        text,                           -- song_id:diff, the day, slot:id
  created_at timestamptz not null default now()
);
create index if not exists wallet_ledger_account_idx on public.wallet_ledger (account_id, created_at desc);
alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
-- only the functions below (new tables come with every privilege for the players: take them all back)
revoke all on public.wallets, public.wallet_ledger from public, anon, authenticated;
revoke all on sequence public.wallet_ledger_id_seq from public, anon, authenticated;

insert into public.shop_items (slot, id, price, req, sort) values
  ('neck', 'palo-rosa', 0, null, 0), ('neck', 'arce', 150, null, 1), ('neck', 'ebano', 150, null, 2),
  ('neck', 'camuflaje', 250, null, 3), ('neck', 'nacar', 300, null, 4), ('neck', 'carbono', 300, null, 5),
  ('neck', 'retro', 350, null, 6), ('neck', 'hielo', 400, null, 7), ('neck', 'lava', 500, null, 8),
  ('neck', 'llamas', 700, null, 9), ('neck', 'neon', 600, null, 10), ('neck', 'galaxia', 800, null, 11),
  ('neck', 'oro', 2000, null, 12), ('neck', 'leyenda', 0, 'leyenda', 13),
  ('gems', 'clasicas', 0, null, 0), ('gems', 'cromo', 200, null, 1), ('gems', 'pastel', 200, null, 2),
  ('gems', 'caramelo', 300, null, 3), ('gems', 'cuadradas', 350, null, 4), ('gems', 'neon', 400, null, 5),
  ('gems', 'pixel', 450, null, 6), ('gems', 'cristal', 600, null, 7), ('gems', 'oro', 1500, null, 8),
  ('gems', 'diamante', 0, 'virtuoso', 9),
  ('flames', 'fuego', 0, null, 0), ('flames', 'azul', 150, null, 1), ('flames', 'verde', 200, null, 2),
  ('flames', 'rosa', 200, null, 3), ('flames', 'morado', 250, null, 4), ('flames', 'dorado', 400, null, 5),
  ('flames', 'plasma', 500, null, 6), ('flames', 'notas', 600, null, 7), ('flames', 'arcoiris', 1000, null, 8),
  ('flames', 'perfecto', 0, 'sin-fallar', 9),
  ('strings', 'acero', 0, null, 0), ('strings', 'cobre', 150, null, 1), ('strings', 'negras', 150, null, 2),
  ('strings', 'oro', 200, null, 3), ('strings', 'hielo', 300, null, 4), ('strings', 'neon', 500, null, 5),
  ('star', 'azul', 0, null, 0), ('star', 'dorado', 300, null, 1), ('star', 'rosa', 300, null, 2),
  ('star', 'rojo', 300, null, 3), ('star', 'verde', 300, null, 4), ('star', 'morado', 300, null, 5),
  ('star', 'arcoiris', 1200, null, 6),
  ('name', 'normal', 0, null, 0), ('name', 'dorado', 300, null, 1), ('name', 'rosa', 300, null, 2),
  ('name', 'cian', 300, null, 3), ('name', 'verde', 300, null, 4), ('name', 'fuego', 800, null, 5),
  ('name', 'arcoiris', 1500, null, 6), ('name', 'corona', 0, 'leyenda', 7),
  ('streak', 'clasica', 0, null, 0), ('streak', 'neon', 250, null, 1), ('streak', 'fuego', 400, null, 2),
  ('streak', 'oro', 600, null, 3), ('streak', 'arcoiris', 900, null, 4),
  ('crowd', 'encendedores', 0, null, 0), ('crowd', 'celulares', 150, null, 1), ('crowd', 'rojo', 200, null, 2),
  ('crowd', 'barras', 300, null, 3)
on conflict (slot, id) do update set price = excluded.price, req = excluded.req, sort = excluded.sort, active = excluded.active;

/** The account's wallet, created the first time with the welcome púas (internal) */
create or replace function public.wallet_ensure(p_account uuid) returns public.wallets
language plpgsql security definer set search_path = public as $$
declare w wallets; a accounts; gift int;
begin
  select * into w from wallets where account_id = p_account;
  if found then return w; end if;
  select * into a from accounts where id = p_account;
  if not found then return null; end if;
  -- welcome: 100, +5 for every song + difficulty it had played before the shop opened (with its name or from its
  -- browsers), at most +300. Runs sent after the opening don't count: they pay as they're played, so a script can't
  -- post a score on every song under a new name and then claim the name for a pile of púas.
  select 100 + least(300, 5 * count(*)) into gift from (
    select distinct s.song_id, s.diff from scores s
    where s.created_at < timestamptz '2026-10-15 05:00:00+00'
      and (acct_key(s.name) = a.name_key or s.player_key in (select d.device_key from account_devices d where d.account_id = a.id))
  ) t;
  insert into wallets (account_id, picks, earned_total) values (a.id, gift, gift)
    on conflict (account_id) do nothing returning * into w;
  if found then
    insert into wallet_ledger (account_id, delta, reason) values (a.id, gift, 'welcome');
  else
    select * into w from wallets where account_id = a.id; -- another call created it first
  end if;
  return w;
end $$;

/** What the game sees of a wallet → { picks, owned: ["slot:id"…], equipped: { slot: id } } (internal) */
create or replace function public.wallet_json(w public.wallets) returns json
language sql immutable set search_path = public as $$
  select case when w.account_id is null then null
    else json_build_object('picks', w.picks, 'owned', to_json(w.owned), 'equipped', w.equipped) end
$$;

/** Pays up to p_amount within the day's 500 and writes it down → what was paid (internal) */
create or replace function public.wallet_pay(p_account uuid, p_amount int, p_reason text, p_ref text) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Bogota')::date; w wallets; paid int;
begin
  select * into w from wallets where account_id = p_account for update;
  if not found then return 0; end if;
  if w.day is distinct from today then w.day_earned := 0; end if;
  paid := greatest(0, least(coalesce(p_amount, 0), 500 - w.day_earned));
  update wallets set picks = picks + paid, earned_total = earned_total + paid, day = today, day_earned = w.day_earned + paid
    where account_id = p_account;
  if paid > 0 then insert into wallet_ledger (account_id, delta, reason, ref) values (p_account, paid, p_reason, p_ref); end if;
  return paid;
end $$;

/** A finished run (only the submit-score function calls this, after writing the score)
 *  → { earned, balance, base, first, record, reason: 'ok' | 'cooldown' | 'cap' } | null (no account).
 *  base, first and record are what the run is worth; earned is what got paid. */
create or replace function public.wallet_award(
  p_secret text, p_song_id text, p_diff text, p_stars int, p_first boolean, p_record boolean
) returns json
language plpgsql security definer set search_path = public as $$
declare
  acc uuid; w wallets; dur int; earned int := 0; why text := 'ok';
  st int := least(5, greatest(1, coalesce(p_stars, 1)));
  base int;
  fst int := case when p_first then 15 else 0 end;                                   -- first time on that board
  rec int := case when p_record and not coalesce(p_first, false) then 10 else 0 end; -- beat their own record
begin
  if p_diff is null or p_diff not in ('easy', 'medium', 'hard', 'expert') then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  select d.account_id into acc from account_devices d where d.device_key = acct_device(p_secret);
  if not found then return null; end if; -- a browser without an account has no wallet
  perform wallet_ensure(acc);
  select * into w from wallets where account_id = acc for update;
  select g.duration_ms into dur from songs g where g.id = p_song_id;
  base := round(case p_diff when 'easy' then 10 when 'medium' then 15 when 'hard' then 22 else 30 end * (0.5 + 0.1 * st));
  -- one paid run at a time per account (all its browsers together): not faster than half the song plays
  if w.last_award_at > now() - make_interval(secs => greatest(20, coalesce(dur, 60000) / 2000.0)) then
    why := 'cooldown';
  else
    earned := wallet_pay(acc, base + fst + rec, 'run', p_song_id || ':' || p_diff);
    if earned < base + fst + rec then why := 'cap'; end if;
    update wallets set last_award_at = now() where account_id = acc returning * into w;
  end if;
  return json_build_object('earned', earned, 'balance', w.picks, 'base', base, 'first', fst, 'record', rec, 'reason', why);
end $$;

/** Buys an item (and puts it on) → { picks, owned, equipped } | { error: 'no_account' | 'unknown' | 'owned' | 'locked' | 'not_enough' }.
 *  An exclusive (req) isn't sold: it's claimed for free once the account has that logro. */
create or replace function public.shop_buy(p_secret text, p_slot text, p_item text) returns json
language plpgsql security definer set search_path = public as $$
declare a accounts; it shop_items; w wallets; k text := p_slot || ':' || p_item; cost int;
begin
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = acct_device(p_secret);
  if not found then return json_build_object('error', 'no_account'); end if;
  select * into it from shop_items where slot = p_slot and id = p_item and active;
  if not found then return json_build_object('error', 'unknown'); end if;
  perform wallet_ensure(a.id);
  select * into w from wallets where account_id = a.id for update;
  if (it.price = 0 and it.req is null) or k = any(w.owned) then return json_build_object('error', 'owned'); end if;
  if it.req is not null and not coalesce(a.progress -> 'ach' ? it.req, false) then
    return json_build_object('error', 'locked');
  end if;
  cost := case when it.req is null then it.price else 0 end;
  if w.picks < cost then return json_build_object('error', 'not_enough'); end if;
  update wallets set picks = picks - cost, owned = array_append(owned, k), equipped = equipped || jsonb_build_object(p_slot, p_item)
    where account_id = a.id returning * into w;
  insert into wallet_ledger (account_id, delta, reason, ref) values (a.id, -cost, case when it.req is null then 'buy' else 'claim' end, k);
  return wallet_json(w);
end $$;

/** Puts on an item it owns, or the slot's default (p_item null works too)
 *  → { picks, owned, equipped } | { error: 'no_account' | 'not_owned' } */
create or replace function public.shop_equip(p_secret text, p_slot text, p_item text) returns json
language plpgsql security definer set search_path = public as $$
declare acc uuid; w wallets; dflt boolean;
begin
  select d.account_id into acc from account_devices d where d.device_key = acct_device(p_secret);
  if not found then return json_build_object('error', 'no_account'); end if;
  select exists (select 1 from shop_items i where i.slot = p_slot and i.price = 0 and i.req is null and (p_item is null or i.id = p_item)) into dflt;
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

revoke all on function public.wallet_ensure(uuid), public.wallet_json(public.wallets), public.wallet_pay(uuid, int, text, text),
  public.wallet_award(text, text, text, int, boolean, boolean) from public, anon, authenticated;
grant execute on function public.wallet_award(text, text, text, int, boolean, boolean) to service_role; -- the submit-score function pays with it
revoke all on function public.shop_buy(text, text, text), public.shop_equip(text, text, text) from public;
grant execute on function public.shop_buy(text, text, text), public.shop_equip(text, text, text) to anon, authenticated;

-- the account payloads (account_me, account_claim, account_link) bring the wallet: { name, code, progress, wallet }.
-- Volatile now: the first one creates the wallet (create or replace keeps who can run them).
create or replace function public.acct_json(a public.accounts) returns json
language sql volatile as $$
  select json_build_object('name', a.name, 'code', a.code, 'progress', a.progress, 'wallet', wallet_json(wallet_ensure(a.id)))
$$;
create or replace function public.account_me(p_secret text) returns json
language sql volatile security definer set search_path = public as $$
  select acct_json(a) from accounts a join account_devices d on d.account_id = a.id where d.device_key = acct_device(p_secret)
$$;
revoke all on function public.acct_json(public.accounts) from public, anon, authenticated;
revoke all on function public.account_me(text) from public;
grant execute on function public.account_me(text) to anon, authenticated;

-- names on the boards wear their name style for everyone (names are public on the boards anyway)
create or replace view public.name_styles with (security_invoker = false) as
select a.name_key, w.equipped ->> 'name' as style
from public.wallets w join public.accounts a on a.id = w.account_id
where coalesce(w.equipped ->> 'name', 'normal') <> 'normal';
revoke all on public.name_styles from public, anon, authenticated;
grant select on public.name_styles to anon, authenticated;

-- song of the day: same as accounts.sql, plus its bonus once a day per account → { …, picks: { earned, balance, reason } | null }
-- (reason 'ok' | 'cap' | 'paid': 'paid' when the account already got this day's bonus, or a later day's)
create or replace function public.submit_daily(
  p_day date, p_song_id text, p_diff text, p_lanes int, p_name text, p_secret text,
  p_score int, p_acc real, p_max_combo int, p_stars int
) returns json
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Bogota')::date;
  nm text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 16);
  k text; g record; n int; mx bigint; ln int; best int; prev int; rnk int; total int;
  acc uuid; w wallets; got int := 0; why text; bonus json;
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
  -- the day's bonus (the run itself is paid by submit-score, like any other run): once per account and day of the song
  select d.account_id into acc from account_devices d where d.device_key = k;
  if found then
    perform wallet_ensure(acc);
    select * into w from wallets where account_id = acc for update;
    if w.daily_bonus_day is null or w.daily_bonus_day < p_day then
      got := wallet_pay(acc, 25, 'daily', p_day::text);
      why := case when got < 25 then 'cap' else 'ok' end;
      update wallets set daily_bonus_day = p_day where account_id = acc returning * into w;
    else
      why := 'paid';
    end if;
    bonus := json_build_object('earned', got, 'balance', w.picks, 'reason', why);
  end if;
  return json_build_object('day', p_day, 'best', best, 'rank', rnk, 'players', total, 'lanes', ln, 'newRecord', prev is null or p_score > prev,
    'picks', bonus);
end $$;
revoke all on function public.submit_daily(date, text, text, int, text, text, int, real, int, int) from public;
grant execute on function public.submit_daily(date, text, text, int, text, text, int, real, int, int) to anon, authenticated;
