-- Corde — the crowd, each its own thing (src/stagecrew.js): two more to buy. "luciernagas" (a streak prize retired in
-- tour_prizes.sql) comes back as fireflies that fly over the crowd, sold; "gatos" is a crowd of cats.
update public.shop_items set price = 350, req = null, sort = 4, active = true where slot = 'crowd' and id = 'luciernagas';
insert into public.shop_items (slot, id, price, req, sort) values ('crowd', 'gatos', 500, null, 5)
on conflict (slot, id) do update set price = excluded.price, req = excluded.req, sort = excluded.sort, active = true;
