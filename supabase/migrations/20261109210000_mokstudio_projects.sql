-- Cloud project saves for mokstudio (private-only).
-- Design goals vs Rotato-style leaks:
--   * No visibility/public column — every row is private to its owner.
--   * anon role: zero grants (cannot list, guess UUIDs, or insert).
--   * authenticated: RLS requires user_id = auth.uid() on every op.
--   * FORCE ROW LEVEL SECURITY so even privileged table-owner sessions
--     still hit policies (service_role remains the only intentional bypass).
--   * BEFORE trigger overwrites user_id from auth.uid() so clients cannot
--     spoof ownership on insert/update.

create table if not exists public.mokstudio_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Stable id from the local recent-projects list (e.g. recent-…).
  local_id text not null,
  name text not null default 'Untitled composition',
  device_id text not null default 'iphone-17-pro',
  device_count integer not null default 1
    check (device_count >= 1 and device_count <= 64),
  -- Slim MockupProject JSON (large screenshots stripped client-side before sync).
  state jsonb not null default '{}'::jsonb
    check (pg_column_size(state) <= 4_000_000),
  preview_url text
    check (preview_url is null or (
      char_length(preview_url) <= 2_048
      and preview_url ~* '^https://'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mokstudio_projects_local_id_len check (char_length(local_id) between 1 and 120),
  constraint mokstudio_projects_name_len check (char_length(name) between 1 and 200),
  constraint mokstudio_projects_user_local unique (user_id, local_id)
);

comment on table public.mokstudio_projects is
  'Private mokstudio compositions. No public/shared visibility — RLS owner-only.';

create index if not exists mokstudio_projects_user_updated_idx
  on public.mokstudio_projects (user_id, updated_at desc);

create or replace function public.mokstudio_projects_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mokstudio_projects_updated_at on public.mokstudio_projects;
create trigger mokstudio_projects_updated_at
  before update on public.mokstudio_projects
  for each row
  execute function public.mokstudio_projects_set_updated_at();

-- Invoker (not definer): uses the caller's auth.uid(); cannot escalate.
create or replace function public.mokstudio_projects_enforce_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'mokstudio_projects requires an authenticated user';
  end if;
  -- Always bind ownership to the session user. Ignore any client-supplied user_id.
  new.user_id := uid;
  return new;
end;
$$;

drop trigger if exists mokstudio_projects_owner on public.mokstudio_projects;
create trigger mokstudio_projects_owner
  before insert or update on public.mokstudio_projects
  for each row
  execute function public.mokstudio_projects_enforce_owner();

alter table public.mokstudio_projects enable row level security;
alter table public.mokstudio_projects force row level security;

revoke all on table public.mokstudio_projects from public, anon, authenticated;
grant select, insert, update, delete on table public.mokstudio_projects to authenticated;

-- Explicit auth.uid() IS NOT NULL guards — no anonymous or leaked cross-user reads.
drop policy if exists mokstudio_projects_select on public.mokstudio_projects;
create policy mokstudio_projects_select
  on public.mokstudio_projects
  for select
  to authenticated
  using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists mokstudio_projects_insert on public.mokstudio_projects;
create policy mokstudio_projects_insert
  on public.mokstudio_projects
  for insert
  to authenticated
  with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists mokstudio_projects_update on public.mokstudio_projects;
create policy mokstudio_projects_update
  on public.mokstudio_projects
  for update
  to authenticated
  using (auth.uid() is not null and user_id = auth.uid())
  with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists mokstudio_projects_delete on public.mokstudio_projects;
create policy mokstudio_projects_delete
  on public.mokstudio_projects
  for delete
  to authenticated
  using (auth.uid() is not null and user_id = auth.uid());

revoke all on function public.mokstudio_projects_set_updated_at() from public, anon, authenticated;
revoke all on function public.mokstudio_projects_enforce_owner() from public, anon, authenticated;
