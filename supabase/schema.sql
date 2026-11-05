-- MemeDex: paid "Update token info" requests + the approved token profiles shown on the site.
-- Run once in the Supabase SQL editor (or as a migration). Safe to re-run.
--
-- Who can do what (enforced by Row Level Security, not by the website):
--   visitors (anon key)  read token_profiles, submit a pending request, upload images into requests/
--   admins               everything: review requests, create/edit/delete profiles and images
-- An admin is any login listed in public.admins.

create extension if not exists pgcrypto;

-- ---------- admins ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- approved profiles (what the site shows) ----------
create table if not exists public.token_profiles (
  chain       text not null check (char_length(chain) between 2 and 32),
  address     text not null check (char_length(address) between 20 and 80),
  symbol      text check (char_length(symbol) <= 40),
  name        text check (char_length(name) <= 120),
  description text check (char_length(description) <= 1000),
  website     text check (website  is null or (website  ~* '^https://' and char_length(website)  <= 300)),
  twitter     text check (twitter  is null or (twitter  ~* '^https://' and char_length(twitter)  <= 300)),
  telegram    text check (telegram is null or (telegram ~* '^https://' and char_length(telegram) <= 300)),
  discord     text check (discord  is null or (discord  ~* '^https://' and char_length(discord)  <= 300)),
  links       jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 4),
  icon_url    text check (icon_url   is null or icon_url   ~* '^https://'),
  banner_url  text check (banner_url is null or banner_url ~* '^https://'),
  request_id  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (chain, address)
);

-- ---------- requests from token owners ----------
create table if not exists public.profile_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  chain       text not null check (char_length(chain) between 2 and 32),
  address     text not null check (char_length(address) between 20 and 80),
  symbol      text check (char_length(symbol) <= 40),
  name        text check (char_length(name) <= 120),
  description text check (char_length(description) <= 1000),
  website     text check (website  is null or (website  ~* '^https://' and char_length(website)  <= 300)),
  twitter     text check (twitter  is null or (twitter  ~* '^https://' and char_length(twitter)  <= 300)),
  telegram    text check (telegram is null or (telegram ~* '^https://' and char_length(telegram) <= 300)),
  discord     text check (discord  is null or (discord  ~* '^https://' and char_length(discord)  <= 300)),
  links       jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 4),
  icon_url    text check (icon_url   is null or icon_url   ~* '^https://'),
  banner_url  text check (banner_url is null or banner_url ~* '^https://'),
  contact     text not null check (char_length(contact) between 3 and 200),
  pay_method  text not null check (pay_method in ('sol', 'usdc-sol', 'eth-base', 'usdc-base', 'eth-eth', 'usdc-eth')),
  pay_tx      text not null unique check (pay_tx ~ '^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$'),
  pay_check   jsonb,  -- what the submitter's browser saw; the admin panel checks the chain again
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note  text check (char_length(admin_note) <= 1000),
  reviewed_at timestamptz,
  reviewed_by uuid
);
create index if not exists profile_requests_status_idx on public.profile_requests (status, created_at desc);

-- ---------- row level security ----------
alter table public.admins           enable row level security;
alter table public.token_profiles   enable row level security;
alter table public.profile_requests enable row level security;

drop policy if exists "admins read admins" on public.admins;
create policy "admins read admins" on public.admins for select using (public.is_admin());

drop policy if exists "public read profiles"   on public.token_profiles;
drop policy if exists "admins insert profiles" on public.token_profiles;
drop policy if exists "admins update profiles" on public.token_profiles;
drop policy if exists "admins delete profiles" on public.token_profiles;
create policy "public read profiles"   on public.token_profiles for select using (true);
create policy "admins insert profiles" on public.token_profiles for insert with check (public.is_admin());
create policy "admins update profiles" on public.token_profiles for update using (public.is_admin()) with check (public.is_admin());
create policy "admins delete profiles" on public.token_profiles for delete using (public.is_admin());

drop policy if exists "anyone submits requests" on public.profile_requests;
drop policy if exists "admins read requests"    on public.profile_requests;
drop policy if exists "admins update requests"  on public.profile_requests;
drop policy if exists "admins delete requests"  on public.profile_requests;
create policy "anyone submits requests" on public.profile_requests for insert to anon, authenticated
  with check (status = 'pending' and admin_note is null and reviewed_at is null and reviewed_by is null);
create policy "admins read requests"   on public.profile_requests for select using (public.is_admin());
create policy "admins update requests" on public.profile_requests for update using (public.is_admin()) with check (public.is_admin());
create policy "admins delete requests" on public.profile_requests for delete using (public.is_admin());

grant select on public.token_profiles to anon, authenticated;
grant insert on public.profile_requests to anon, authenticated;
grant select, insert, update, delete on public.token_profiles, public.profile_requests to authenticated;
grant select on public.admins to authenticated;

-- ---------- images (icons and banners) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('token-media', 'token-media', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anyone uploads request media" on storage.objects;
drop policy if exists "admins manage media"          on storage.objects;
create policy "anyone uploads request media" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'token-media' and (storage.foldername(name))[1] = 'requests');
create policy "admins manage media" on storage.objects for all to authenticated
  using (bucket_id = 'token-media' and public.is_admin())
  with check (bucket_id = 'token-media' and public.is_admin());

-- ---------- make someone an admin (after they have a login) ----------
-- insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
