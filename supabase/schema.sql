-- Corde — run this once in Supabase: SQL Editor → New query → paste → Run.

-- 1. Song library
create table if not exists public.songs (
  id            text primary key,          -- slug: "3-doors-down-kryptonite"
  name          text not null,
  artist        text,
  album         text,
  year          int,
  charter       text,
  genre         text,
  duration_ms   int,
  diffs         jsonb not null,            -- {"easy":{"n":373,"lanes":[0,1,2]}, ...}
  has_guitar    boolean not null default false,
  has_cover     boolean not null default false,
  backing_file  text not null default 'backing.mp3',
  guitar_file   text,
  created_at    timestamptz not null default now()
);

alter table public.songs enable row level security;

-- anyone can read the library; only the service role (upload script) can write
drop policy if exists "songs are public" on public.songs;
create policy "songs are public" on public.songs for select using (true);

-- 2. Storage bucket with the audio, charts and covers (public read)
insert into storage.buckets (id, name, public, file_size_limit)
values ('songs', 'songs', true, 52428800)
on conflict (id) do update set public = true;

drop policy if exists "song files are public" on storage.objects;
create policy "song files are public" on storage.objects for select using (bucket_id = 'songs');

-- Multiplayer uses Realtime broadcast + presence channels: nothing to create here.
