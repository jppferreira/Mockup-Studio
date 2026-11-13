-- Versioned global template publishing (admin-authored, customer-consumed).
-- Admins are assigned in mokstudio_admins (not editable client profile fields).
-- Scene payloads reuse CompositionTemplate JSON; device GLBs stay referenced by id.

-- ---------------------------------------------------------------------------
-- Admin role (secure assignment)
-- ---------------------------------------------------------------------------

create table if not exists public.mokstudio_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 240)
);

comment on table public.mokstudio_admins is
  'Users with administrator privileges for global template publishing. Not client-editable.';

alter table public.mokstudio_admins enable row level security;
alter table public.mokstudio_admins force row level security;

revoke all on table public.mokstudio_admins from public, anon, authenticated;
grant select on table public.mokstudio_admins to authenticated;

-- Anyone signed in can check whether *they* are an admin (needed for UI gating).
drop policy if exists mokstudio_admins_select_self on public.mokstudio_admins;
create policy mokstudio_admins_select_self
  on public.mokstudio_admins
  for select
  to authenticated
  using (auth.uid() is not null and user_id = auth.uid());

-- Security-definer helper used by RLS (avoids recursive policy checks).
create or replace function public.mokstudio_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mokstudio_admins a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.mokstudio_is_admin() from public, anon, authenticated;
grant execute on function public.mokstudio_is_admin() to authenticated;

-- Seed primary admin by email (idempotent).
insert into public.mokstudio_admins (user_id, note)
select u.id, 'Primary Mockup Studio admin'
from auth.users u
where lower(u.email) = 'hello@jppferreira.com'
on conflict (user_id) do nothing;

-- Prefer admin table over hardcoded JWT email for legacy master catalog writes.
drop policy if exists mokstudio_template_catalog_write on public.mokstudio_template_catalog;
create policy mokstudio_template_catalog_write
  on public.mokstudio_template_catalog
  for all
  to authenticated
  using (auth.uid() is not null and public.mokstudio_is_admin())
  with check (auth.uid() is not null and public.mokstudio_is_admin());

-- ---------------------------------------------------------------------------
-- Templates + versions
-- ---------------------------------------------------------------------------

create table if not exists public.mokstudio_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (char_length(trim(title)) between 1 and 120),
  description text not null default ''
    check (char_length(description) <= 2000),
  category text not null
    check (category in (
      'single-device',
      'multiple-devices',
      'floating-devices',
      'product-showcase',
      'animated-compositions',
      'social-media',
      'custom'
    )),
  tags text[] not null default '{}'::text[]
    check (cardinality(tags) <= 24),
  thumbnail_path text
    check (
      thumbnail_path is null
      or (
        char_length(thumbnail_path) <= 512
        and thumbnail_path ~* '^template-thumbnails/'
      )
    ),
  access_tier text not null default 'free'
    check (access_tier in ('free', 'pro')),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  current_version_id uuid,
  schema_version integer not null default 1
    check (schema_version >= 1),
  library_category text not null default 'devices'
    check (library_category in ('devices', 'scenes', 'social')),
  slug text
    check (slug is null or (char_length(slug) between 1 and 80 and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

comment on table public.mokstudio_templates is
  'Global composition templates. Admins author; customers browse published rows.';

create unique index if not exists mokstudio_templates_slug_uidx
  on public.mokstudio_templates (slug)
  where slug is not null;

create index if not exists mokstudio_templates_status_updated_idx
  on public.mokstudio_templates (status, updated_at desc);

create index if not exists mokstudio_templates_category_status_idx
  on public.mokstudio_templates (category, status);

create index if not exists mokstudio_templates_published_idx
  on public.mokstudio_templates (published_at desc nulls last)
  where status = 'published';

create table if not exists public.mokstudio_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.mokstudio_templates (id) on delete cascade,
  version_number integer not null
    check (version_number >= 1),
  scene_json jsonb not null
    check (pg_column_size(scene_json) <= 4_000_000),
  schema_version integer not null default 1
    check (schema_version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  unique (template_id, version_number)
);

comment on table public.mokstudio_template_versions is
  'Immutable scene snapshots for each template publish/update. Never overwrite prior versions.';

create index if not exists mokstudio_template_versions_template_idx
  on public.mokstudio_template_versions (template_id, version_number desc);

-- current_version_id FK (deferred until versions table exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mokstudio_templates_current_version_fk'
  ) then
    alter table public.mokstudio_templates
      add constraint mokstudio_templates_current_version_fk
      foreign key (current_version_id)
      references public.mokstudio_template_versions (id)
      on delete set null;
  end if;
end $$;

create or replace function public.mokstudio_templates_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mokstudio_templates_updated_at on public.mokstudio_templates;
create trigger mokstudio_templates_updated_at
  before update on public.mokstudio_templates
  for each row
  execute function public.mokstudio_templates_set_updated_at();

-- Entitlement helper for Pro scene access.
create or replace function public.mokstudio_has_pro_entitlement()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mokstudio_entitlements e
    where e.user_id = auth.uid()
      and e.tier in ('pro', 'pro_max')
      and (
        e.status is null
        or e.status in ('active', 'trialing', 'canceled')
      )
      and (
        e.period_end is null
        or e.period_end > now()
      )
  );
$$;

revoke all on function public.mokstudio_has_pro_entitlement() from public, anon, authenticated;
grant execute on function public.mokstudio_has_pro_entitlement() to authenticated;

alter table public.mokstudio_templates enable row level security;
alter table public.mokstudio_templates force row level security;
alter table public.mokstudio_template_versions enable row level security;
alter table public.mokstudio_template_versions force row level security;

revoke all on table public.mokstudio_templates from public, anon, authenticated;
revoke all on table public.mokstudio_template_versions from public, anon, authenticated;
grant select on table public.mokstudio_templates to authenticated;
grant insert, update, delete on table public.mokstudio_templates to authenticated;
grant select on table public.mokstudio_template_versions to authenticated;
grant insert on table public.mokstudio_template_versions to authenticated;

-- Metadata: published visible to all signed-in users; drafts/archived admin-only.
drop policy if exists mokstudio_templates_select on public.mokstudio_templates;
create policy mokstudio_templates_select
  on public.mokstudio_templates
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.mokstudio_is_admin()
      or status = 'published'
    )
  );

drop policy if exists mokstudio_templates_insert on public.mokstudio_templates;
create policy mokstudio_templates_insert
  on public.mokstudio_templates
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.mokstudio_is_admin()
    and created_by = auth.uid()
  );

drop policy if exists mokstudio_templates_update on public.mokstudio_templates;
create policy mokstudio_templates_update
  on public.mokstudio_templates
  for update
  to authenticated
  using (auth.uid() is not null and public.mokstudio_is_admin())
  with check (auth.uid() is not null and public.mokstudio_is_admin());

drop policy if exists mokstudio_templates_delete on public.mokstudio_templates;
create policy mokstudio_templates_delete
  on public.mokstudio_templates
  for delete
  to authenticated
  using (auth.uid() is not null and public.mokstudio_is_admin());

-- Scene JSON: free published for all; pro published requires entitlement (or admin).
drop policy if exists mokstudio_template_versions_select on public.mokstudio_template_versions;
create policy mokstudio_template_versions_select
  on public.mokstudio_template_versions
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.mokstudio_templates t
      where t.id = template_id
        and (
          public.mokstudio_is_admin()
          or (
            t.status = 'published'
            and (
              t.access_tier = 'free'
              or public.mokstudio_has_pro_entitlement()
            )
          )
        )
    )
  );

drop policy if exists mokstudio_template_versions_insert on public.mokstudio_template_versions;
create policy mokstudio_template_versions_insert
  on public.mokstudio_template_versions
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.mokstudio_is_admin()
    and created_by = auth.uid()
    and exists (
      select 1 from public.mokstudio_templates t
      where t.id = template_id
    )
  );

-- No update/delete on versions — immutability.
revoke update, delete on table public.mokstudio_template_versions from authenticated;

-- ---------------------------------------------------------------------------
-- Thumbnail storage (public read of published thumbs; admin write)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'template-thumbnails',
  'template-thumbnails',
  true,
  5242880, -- 5 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists mokstudio_template_thumbs_select on storage.objects;
create policy mokstudio_template_thumbs_select
  on storage.objects
  for select
  to public
  using (bucket_id = 'template-thumbnails');

drop policy if exists mokstudio_template_thumbs_insert on storage.objects;
create policy mokstudio_template_thumbs_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'template-thumbnails'
    and auth.uid() is not null
    and public.mokstudio_is_admin()
  );

drop policy if exists mokstudio_template_thumbs_update on storage.objects;
create policy mokstudio_template_thumbs_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'template-thumbnails'
    and auth.uid() is not null
    and public.mokstudio_is_admin()
  )
  with check (
    bucket_id = 'template-thumbnails'
    and auth.uid() is not null
    and public.mokstudio_is_admin()
  );

drop policy if exists mokstudio_template_thumbs_delete on storage.objects;
create policy mokstudio_template_thumbs_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'template-thumbnails'
    and auth.uid() is not null
    and public.mokstudio_is_admin()
  );
