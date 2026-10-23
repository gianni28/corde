-- Corde — "¡Ya está tu canción!" for a request answered with a secret song (applied after inbox.sql and secret_groups.sql).
-- A secret song is announced only to a player whose browser has its group's code (p_codes: the codes it has), so the
-- announcement never shows a secret to someone without it. Browsers from before send only p_secret: as before.
drop function if exists public.my_fulfilled(text);
create or replace function public.my_fulfilled(p_secret text, p_codes text[] default '{}') returns json
language sql stable security definer set search_path = public as $$
  with mine as (select distinct secret_group_of(c) g from unnest((coalesce(p_codes, '{}'))[1:8]) c)
  select coalesce(json_agg(json_build_object('id', r.id, 'body', r.body,
      'song', json_build_object('id', s.id, 'name', s.name, 'artist', s.artist, 'has_cover', s.has_cover)) order by r.created_at), '[]'::json)
  from account_devices d
  join song_requests r on r.account_id = d.account_id
  join songs s on s.id = r.song_id
  where d.device_key = acct_device(p_secret) and r.done and not r.announced
    and (not s.hidden or s.secret_group in (select g from mine where g is not null))
$$;
revoke all on function public.my_fulfilled(text, text[]) from public, anon, authenticated;
grant execute on function public.my_fulfilled(text, text[]) to anon, authenticated;

-- the admin's inbox says when the song of a request is secret (its player sees it only with the code)
create or replace function public.admin_inbox() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', coalesce((select json_agg(json_build_object('id', r.id, 'name', r.name, 'body', r.body, 'done', r.done, 'at', r.created_at,
        'song', (select json_build_object('id', s.id, 'name', s.name, 'artist', s.artist, 'hidden', s.hidden) from songs s where s.id = r.song_id),
        'announced', r.announced) order by r.created_at desc)
      from (select * from song_requests order by created_at desc limit 300) r), '[]'::json),
    'notices', coalesce((select json_agg(json_build_object(
        'id', n.id, 'body', n.body, 'all', n.to_all, 'active', n.active, 'at', n.created_at,
        'to', coalesce((select json_agg(a.name order by a.name) from notice_targets t join accounts a on a.id = t.account_id where t.notice_id = n.id), '[]'::json),
        'seen', (select count(*) from notice_seen s where s.notice_id = n.id),
        'replies', coalesce((select json_agg(json_build_object('name', p.name, 'body', p.body, 'at', p.created_at) order by p.created_at) from notice_replies p where p.notice_id = n.id), '[]'::json)
      ) order by n.created_at desc) from (select * from notices order by created_at desc limit 100) n), '[]'::json)
  )
$$;
