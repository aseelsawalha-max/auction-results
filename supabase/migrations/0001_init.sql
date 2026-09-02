-- Auction Results Dashboard — persistent shared schema.
--
-- Run this once in the Supabase project's SQL editor (or via `supabase db push`
-- if you use the Supabase CLI). It creates the tables that back the dashboard,
-- and enforces read/write separation at the database level via Row Level
-- Security: rows are only readable by signed-in (authenticated) users — the
-- anon role has no read access at all — and writes are only allowed for
-- users listed in `admin_users`. This holds even if someone bypasses the
-- frontend and calls the Supabase REST API directly.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.auction_records (
  dedupe_key text primary key,
  dedupe_key_is_native_id boolean not null default false,

  auction_id text,
  auction_close date,
  auction_close_raw text,
  facility text,
  unit text,
  status text,
  attendees integer,
  views integer,
  bid numeric,
  winner text,
  void_reason_code text,
  cancel_reason_code text,

  -- Any LockerFox column that isn't one of the fixed fields above, keyed by
  -- its original header text. Keeps the app forward-compatible with new
  -- columns LockerFox may add later without a schema migration.
  extra jsonb not null default '{}'::jsonb,

  first_seen_at timestamptz not null,
  last_updated_at timestamptz not null,
  last_seen_at timestamptz not null,
  source_files text[] not null default '{}'::text[],
  history jsonb not null default '[]'::jsonb,

  updated_by uuid references auth.users(id)
);

create index if not exists auction_records_facility_idx on public.auction_records (facility);
create index if not exists auction_records_auction_close_idx on public.auction_records (auction_close);
create index if not exists auction_records_status_idx on public.auction_records (status);
create index if not exists auction_records_unit_idx on public.auction_records (unit);

create table if not exists public.uploads (
  id text primary key,
  "timestamp" timestamptz not null,
  file_name text not null,
  total_rows_in_file integer not null default 0,
  records_added integer not null default 0,
  records_updated integer not null default 0,
  records_unchanged integer not null default 0,
  rows_skipped integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  detected_columns jsonb not null default '{}'::jsonb,
  unmapped_columns jsonb not null default '[]'::jsonb,
  uploaded_by uuid references auth.users(id)
);

create index if not exists uploads_timestamp_idx on public.uploads ("timestamp" desc);

-- Admin allowlist. A row here means that auth.users(id) is allowed to write
-- auction data. There are intentionally no client-facing RLS policies on this
-- table itself (see below) — it can only be read through the SECURITY DEFINER
-- is_admin() function, never directly via the anon/authenticated API roles.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now(),
  note text
);

-- ---------------------------------------------------------------------------
-- is_admin(): the single source of truth for "is this caller allowed to write".
-- SECURITY DEFINER lets it read admin_users regardless of the caller's own
-- RLS visibility into that table (which is none).
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.auction_records enable row level security;
alter table public.uploads enable row level security;
alter table public.admin_users enable row level security;
-- admin_users gets zero policies: RLS is enabled and no policy grants any
-- access to anon/authenticated, so it is unreadable/unwritable from the
-- client entirely. Manage it from the Supabase SQL editor (or dashboard),
-- using the service role, never from the app.

-- Read access requires a signed-in session — anon has no policy on this
-- table at all, so unauthenticated requests return zero rows.
drop policy if exists "auction_records_public_read" on public.auction_records;
drop policy if exists "auction_records_authenticated_read" on public.auction_records;
create policy "auction_records_authenticated_read"
  on public.auction_records for select
  to authenticated
  using (true);
revoke select on public.auction_records from anon;
grant select on public.auction_records to authenticated;

drop policy if exists "auction_records_admin_write" on public.auction_records;
create policy "auction_records_admin_write"
  on public.auction_records for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "auction_records_admin_update" on public.auction_records;
create policy "auction_records_admin_update"
  on public.auction_records for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "auction_records_admin_delete" on public.auction_records;
create policy "auction_records_admin_delete"
  on public.auction_records for delete
  to authenticated
  using (public.is_admin());

-- Same rule for uploads: signed-in users only, no anon access.
drop policy if exists "uploads_public_read" on public.uploads;
drop policy if exists "uploads_authenticated_read" on public.uploads;
create policy "uploads_authenticated_read"
  on public.uploads for select
  to authenticated
  using (true);
revoke select on public.uploads from anon;
grant select on public.uploads to authenticated;

drop policy if exists "uploads_admin_write" on public.uploads;
create policy "uploads_admin_write"
  on public.uploads for insert
  to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Realtime: lets the read-only dashboard auto-refresh the moment an admin
-- upload changes the data, without the viewer reloading the page.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'auction_records'
  ) then
    alter publication supabase_realtime add table public.auction_records;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'uploads'
  ) then
    alter publication supabase_realtime add table public.uploads;
  end if;
end $$;
