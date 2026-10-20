-- Corde — the Iron Maiden event, La Gira de la Bestia (after otaku.sql): surprise gifts as the Beast's stars add up
-- (src/achievements.js BEAST_GIFTS), and Eddie for EDDIE_STARS stars on every Iron Maiden song, any difficulty.
insert into public.shop_items (slot, id, price, req, sort) values
  ('gems', 'powerslave', 0, 'bestia-powerslave', 50),
  ('crowd', 'banderas', 0, 'bestia-trooper', 50),
  ('flames', 'piramide', 0, 'bestia-piramide', 50),
  ('neck', 'fear-of-the-dark', 0, 'bestia-fear', 50),
  ('name', 'bestia', 0, 'bestia-nombre', 50),
  ('pet', 'eddie', 0, 'bestia-eddie', 50)
on conflict (slot, id) do update set price = excluded.price, req = excluded.req, sort = excluded.sort, active = true;
