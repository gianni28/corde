-- Corde — the One Direction event (after otaku.sql). Its songs live in a secret group; the rule (4 stars or more on each, on Media or harder) lives in
-- src/achievements.js (forOneD). The gift: the five of them as pets, all for whoever wins (they pick their favourite).
insert into public.shop_items (slot, id, price, req, sort) values
  ('pet', 'harry', 0, 'one-direction', 20),
  ('pet', 'liam', 0, 'one-direction', 21),
  ('pet', 'louis', 0, 'one-direction', 22),
  ('pet', 'niall', 0, 'one-direction', 23),
  ('pet', 'zayn', 0, 'one-direction', 24)
on conflict (slot, id) do update set price = excluded.price, req = excluded.req, sort = excluded.sort, active = true;
