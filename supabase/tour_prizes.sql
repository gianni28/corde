-- Corde — the tour's prizes (after shop.sql and progress.sql): three per difficulty, claimed like a logro's prize
-- (req: the logro "gira-<difficulty>-<venue>", won in the game when that venue is cleared; src/tour.js TOUR_PRIZES).
insert into public.shop_items (slot, id, price, req, sort) values
  ('flames', 'fogata', 0, 'gira-easy-bar', 30), ('crowd', 'bengalas', 0, 'gira-easy-theater', 30), ('neck', 'calcomanias', 0, 'gira-easy-stadium', 30),
  ('strings', 'cables', 0, 'gira-medium-bar', 30), ('star', 'cian', 0, 'gira-medium-theater', 30), ('gems', 'vinilo', 0, 'gira-medium-stadium', 30),
  ('name', 'festival', 0, 'gira-hard-bar', 30), ('streak', 'pirotecnia', 0, 'gira-hard-theater', 30), ('neck', 'laser', 0, 'gira-hard-stadium', 31),
  ('flames', 'supernova', 0, 'gira-expert-bar', 31), ('star', 'blanca', 0, 'gira-expert-theater', 31), ('neck', 'mundial', 0, 'gira-expert-stadium', 32)
on conflict (slot, id) do update set price = 0, req = excluded.req, sort = excluded.sort, lvl = null;

-- the song of the day's streak prizes (logros dia-3, dia-7, dia-14, dia-30: days in a row, counted in the game).
-- (A first set — sol, luciernagas, racha, sol-luna — was retired the day after for these, more rock ones.)
update public.shop_items set active = false where (slot, id) in (('star', 'sol'), ('crowd', 'luciernagas'), ('name', 'racha'), ('neck', 'sol-luna'));
insert into public.shop_items (slot, id, price, req, sort) values
  ('flames', 'brasas', 0, 'dia-3', 20), ('crowd', 'estrobos', 0, 'dia-7', 20), ('name', 'heavy', 0, 'dia-14', 20), ('neck', 'calavera', 0, 'dia-30', 20)
on conflict (slot, id) do update set price = 0, req = excluded.req, sort = excluded.sort, lvl = null, active = true;
