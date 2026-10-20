-- Corde — a secret group can carry an event (after secret_groups.sql, otaku.sql): the game finds the Otaku event's
-- group by this mark, not by its name, so the admin can rename the group freely.
alter table public.secret_groups add column if not exists event text;
update public.secret_groups set event = 'otaku' where name in ('Mono Tití', 'Otaku') and event is null;

create or replace function public.secret_open(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare g secret_groups;
begin
  select * into g from secret_groups where id = secret_group_of(p_code);
  if g.id is null then raise exception 'Código incorrecto' using errcode = '28000'; end if;
  return json_build_object('id', g.id, 'name', g.name, 'event', g.event, 'songs',
    coalesce((select json_agg(s order by s.artist, s.name) from songs s where s.hidden and s.secret_group = g.id), '[]'::json));
end $$;
