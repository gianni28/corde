-- Corde — comments are private (after comments.sql): nobody reads anybody else's any more. A player sees only what
-- they wrote and the admin's answers to it; every comment reaches only the admin (admin_comments, the panel).

/** This account's own comments, newest first → [{ id, body, at, reply, replied_at }] */
create or replace function public.my_comments(p_secret text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', c.id, 'body', c.body, 'at', c.created_at, 'reply', c.reply,
    'replied_at', c.replied_at) order by c.created_at desc), '[]'::json)
  from (select x.* from account_devices d join comments x on x.account_id = d.account_id
        where d.device_key = acct_device(p_secret) and not x.hidden order by x.created_at desc limit 50) c
$$;
revoke all on function public.my_comments(text) from public, anon, authenticated;
grant execute on function public.my_comments(text) to anon, authenticated;

-- the public wall is closed: no player can read it any more
revoke all on function public.comments_wall(int) from public, anon, authenticated;
