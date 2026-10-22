-- Corde — the public key (anon) can only read and call the game's own functions.
-- The browser never writes to these tables (scores go through the submit-score function, songs through admin-upload,
-- both with the service role), and RLS already blocked it; this takes the write grants away as well.
revoke insert, update, delete, truncate on public.scores, public.songs, public.weekly_scores from anon, authenticated;
-- the weekly board's writer: only submit-score (service role) calls it
revoke execute on function public.weekly_submit from public, anon, authenticated;
