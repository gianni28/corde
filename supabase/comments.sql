-- Corde — the comments wall (after accounts.sql). Any player with an account writes whatever they want; everyone reads
-- the wall; the admin answers each comment from the panel (the answer shows under it, and its writer gets "Gianni te
-- respondió" the next time they open the game), and hides what shouldn't be there.
-- Players reach it only through the functions below (with their browser's secret); the admin through admin-upload.

create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  account_id uuid references public.accounts (id) on delete cascade,
  name       text not null,
  body       text not null check (char_length(body) between 1 and 500),
  reply      text check (reply is null or char_length(reply) between 1 and 1000),
  replied_at timestamptz,
  reply_seen boolean not null default false,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_created_idx on public.comments (created_at desc);
create index if not exists comments_account_idx on public.comments (account_id, created_at desc);
alter table public.comments enable row level security;
revoke all on public.comments from public, anon, authenticated;
revoke all on sequence public.comments_id_seq from public, anon, authenticated;

/** A comment on the wall → { ok } | { error: 'no_account' | 'empty' | 'limit' } (10 a day per account) */
create or replace function public.comment_post(p_secret text, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare a accounts; b text := left(btrim(coalesce(p_body, '')), 500);
begin
  select x.* into a from accounts x join account_devices d on d.account_id = x.id where d.device_key = acct_device(p_secret);
  if not found then return json_build_object('error', 'no_account'); end if;
  if b = '' then return json_build_object('error', 'empty'); end if;
  if (select count(*) from comments where account_id = a.id and created_at > now() - interval '1 day') >= 10 then
    return json_build_object('error', 'limit');
  end if;
  insert into comments (account_id, name, body) values (a.id, a.name, b);
  return json_build_object('ok', true);
end $$;

/** The wall: the latest comments that aren't hidden, newest first → [{ id, name, body, at, reply, replied_at }] */
create or replace function public.comments_wall(p_limit int default 100) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'body', c.body, 'at', c.created_at,
    'reply', c.reply, 'replied_at', c.replied_at) order by c.created_at desc), '[]'::json)
  from (select * from comments where not hidden order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) c
$$;

/** This account's comments the admin answered, not shown to it yet → [{ id, body, reply }] */
create or replace function public.my_comment_replies(p_secret text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', c.id, 'body', c.body, 'reply', c.reply) order by c.replied_at), '[]'::json)
  from account_devices d join comments c on c.account_id = d.account_id
  where d.device_key = acct_device(p_secret) and c.reply is not null and not c.reply_seen and not c.hidden
$$;

/** The answer was shown to its writer (it won't show again) */
create or replace function public.comment_reply_seen(p_secret text, p_id bigint) returns void
language sql security definer set search_path = public as $$
  update comments c set reply_seen = true from account_devices d
  where c.id = p_id and d.device_key = acct_device(p_secret) and c.account_id = d.account_id
$$;

/** Every comment for the admin panel (hidden ones too), newest first */
create or replace function public.admin_comments() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'body', c.body, 'at', c.created_at,
    'reply', c.reply, 'replied_at', c.replied_at, 'seen', c.reply_seen, 'hidden', c.hidden) order by c.created_at desc), '[]'::json)
  from (select * from comments order by created_at desc limit 300) c
$$;

revoke all on function public.comment_post(text, text), public.comments_wall(int), public.my_comment_replies(text),
  public.comment_reply_seen(text, bigint), public.admin_comments() from public, anon, authenticated;
grant execute on function public.comment_post(text, text), public.comments_wall(int), public.my_comment_replies(text),
  public.comment_reply_seen(text, bigint) to anon, authenticated;
grant execute on function public.admin_comments() to service_role;
