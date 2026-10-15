-- Corde — what the players tell the admin, and what the admin tells them (after accounts.sql).
-- Song requests: a player with an account writes whatever they want; it lands in the admin panel.
-- Notices: the admin writes a message for everyone or for chosen players; each one sees it once, the next time they
-- open the game, with a box to answer if they feel like it (the answers land in the admin panel too).
-- Players reach all of it only through the functions below (with their browser's secret); the admin through the
-- admin-upload function (the admin code, the service role).

create table if not exists public.song_requests (
  id         bigint generated always as identity primary key,
  account_id uuid references public.accounts (id) on delete set null,
  name       text not null,
  body       text not null check (char_length(body) between 1 and 500),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.notices (
  id         bigint generated always as identity primary key,
  body       text not null check (char_length(body) between 1 and 1000),
  to_all     boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.notice_targets (
  notice_id  bigint not null references public.notices (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  primary key (notice_id, account_id)
);
create table if not exists public.notice_seen (
  notice_id  bigint not null references public.notices (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (notice_id, account_id)
);
create table if not exists public.notice_replies (
  id         bigint generated always as identity primary key,
  notice_id  bigint not null references public.notices (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  name       text not null,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists song_requests_account_idx on public.song_requests (account_id, created_at desc);
create index if not exists notice_replies_notice_idx on public.notice_replies (notice_id, created_at);

alter table public.song_requests enable row level security;
alter table public.notices enable row level security;
alter table public.notice_targets enable row level security;
alter table public.notice_seen enable row level security;
alter table public.notice_replies enable row level security;
-- new tables come with every privilege for the players: take them all back (only the functions below reach them)
revoke all on public.song_requests, public.notices, public.notice_targets, public.notice_seen, public.notice_replies from public, anon, authenticated;
revoke all on sequence public.song_requests_id_seq, public.notices_id_seq, public.notice_replies_id_seq from public, anon, authenticated;

/** A song request → { ok } | { error: 'no_account' | 'empty' | 'limit' } (10 a day per account) */
create or replace function public.song_request(p_secret text, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare a accounts; b text := left(btrim(coalesce(p_body, '')), 500);
begin
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = acct_device(p_secret);
  if not found then return json_build_object('error', 'no_account'); end if;
  if b = '' then return json_build_object('error', 'empty'); end if;
  if (select count(*) from song_requests where account_id = a.id and created_at > now() - interval '1 day') >= 10 then
    return json_build_object('error', 'limit');
  end if;
  insert into song_requests (account_id, name, body) values (a.id, a.name, b);
  return json_build_object('ok', true);
end $$;

/** The notices this account hasn't seen yet, oldest first → [{ id, body, at }] (none without an account) */
create or replace function public.my_notices(p_secret text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', n.id, 'body', n.body, 'at', n.created_at) order by n.created_at), '[]'::json)
  from account_devices d
  join notices n on n.active
  where d.device_key = acct_device(p_secret)
    and (n.to_all or exists (select 1 from notice_targets t where t.notice_id = n.id and t.account_id = d.account_id))
    and not exists (select 1 from notice_seen s where s.notice_id = n.id and s.account_id = d.account_id)
$$;

/** The notice was shown to this account (it won't show again) */
create or replace function public.notice_seen_by(p_secret text, p_id bigint) returns void
language sql security definer set search_path = public as $$
  insert into notice_seen (notice_id, account_id)
  select n.id, d.account_id from account_devices d join notices n on n.id = p_id
  where d.device_key = acct_device(p_secret)
  on conflict do nothing
$$;

/** An answer to a notice → { ok } | { error: 'no_account' | 'empty' | 'limit' } (5 per notice per account) */
create or replace function public.notice_reply(p_secret text, p_id bigint, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare a accounts; b text := left(btrim(coalesce(p_body, '')), 500);
begin
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = acct_device(p_secret);
  if not found then return json_build_object('error', 'no_account'); end if;
  if b = '' or not exists (select 1 from notices where id = p_id) then return json_build_object('error', 'empty'); end if;
  if (select count(*) from notice_replies where notice_id = p_id and account_id = a.id) >= 5 then return json_build_object('error', 'limit'); end if;
  insert into notice_replies (notice_id, account_id, name, body) values (p_id, a.id, a.name, b);
  return json_build_object('ok', true);
end $$;

/** The admin's new notice (only the admin-upload function calls this) → { id, missing: [names not found] } */
create or replace function public.notice_create(p_body text, p_all boolean, p_names text[]) returns json
language plpgsql security definer set search_path = public as $$
declare nid bigint; missing text[] := '{}'; nm text; acc uuid;
begin
  insert into notices (body, to_all) values (left(btrim(p_body), 1000), coalesce(p_all, false)) returning id into nid;
  if not coalesce(p_all, false) then
    foreach nm in array coalesce(p_names, '{}') loop
      select id into acc from accounts where name_key = acct_key(nm);
      if found then insert into notice_targets (notice_id, account_id) values (nid, acc) on conflict do nothing;
      else missing := array_append(missing, nm); end if;
    end loop;
  end if;
  return json_build_object('id', nid, 'missing', to_json(missing));
end $$;

/** Everything for the admin panel → { requests: [...], notices: [{ ..., to: [names], seen, replies: [...] }] } */
create or replace function public.admin_inbox() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', coalesce((select json_agg(json_build_object('id', r.id, 'name', r.name, 'body', r.body, 'done', r.done, 'at', r.created_at) order by r.created_at desc)
      from (select * from song_requests order by created_at desc limit 300) r), '[]'::json),
    'notices', coalesce((select json_agg(json_build_object(
        'id', n.id, 'body', n.body, 'all', n.to_all, 'active', n.active, 'at', n.created_at,
        'to', coalesce((select json_agg(a.name order by a.name) from notice_targets t join accounts a on a.id = t.account_id where t.notice_id = n.id), '[]'::json),
        'seen', (select count(*) from notice_seen s where s.notice_id = n.id),
        'replies', coalesce((select json_agg(json_build_object('name', p.name, 'body', p.body, 'at', p.created_at) order by p.created_at) from notice_replies p where p.notice_id = n.id), '[]'::json)
      ) order by n.created_at desc) from (select * from notices order by created_at desc limit 100) n), '[]'::json)
  )
$$;

revoke all on function public.song_request(text, text), public.my_notices(text), public.notice_seen_by(text, bigint),
  public.notice_reply(text, bigint, text), public.notice_create(text, boolean, text[]), public.admin_inbox() from public, anon, authenticated;
grant execute on function public.song_request(text, text), public.my_notices(text), public.notice_seen_by(text, bigint),
  public.notice_reply(text, bigint, text) to anon, authenticated;
grant execute on function public.notice_create(text, boolean, text[]), public.admin_inbox() to service_role;
