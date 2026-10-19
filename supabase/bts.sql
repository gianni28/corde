-- Corde — the BTS event (after onedirection.sql): like One Direction's (src/achievements.js BANDS), its gift the seven
-- of them as pets, all for whoever wins (they pick their favourite in the shop's BTS card).
insert into public.shop_items (slot, id, price, req, sort) values
  ('pet', 'rm', 0, 'bts', 30), ('pet', 'jin', 0, 'bts', 31), ('pet', 'suga', 0, 'bts', 32), ('pet', 'jhope', 0, 'bts', 33),
  ('pet', 'jimin', 0, 'bts', 34), ('pet', 'v', 0, 'bts', 35), ('pet', 'jungkook', 0, 'bts', 36)
on conflict (slot, id) do update set price = excluded.price, req = excluded.req, sort = excluded.sort, active = true;
