-- Master downloadable template catalog.
-- Dev admin publishes; every authenticated user can read.
-- My Templates are NOT stored here — they stay on-device / local only.

create table if not exists public.mokstudio_template_catalog (
  id text primary key default 'master'
    check (id = 'master'),
  -- Shipped pack payload: kind/version/updatedAt/removedIds/templates.
  payload jsonb not null default '{}'::jsonb
    check (pg_column_size(payload) <= 8_000_000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.mokstudio_template_catalog is
  'Shared master template pack. Authenticated users read; Dev admin email writes. Not My Templates.';

create or replace function public.mokstudio_template_catalog_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists mokstudio_template_catalog_updated_at on public.mokstudio_template_catalog;
create trigger mokstudio_template_catalog_updated_at
  before insert or update on public.mokstudio_template_catalog
  for each row
  execute function public.mokstudio_template_catalog_set_updated_at();

alter table public.mokstudio_template_catalog enable row level security;
alter table public.mokstudio_template_catalog force row level security;

revoke all on table public.mokstudio_template_catalog from public, anon, authenticated;
grant select on table public.mokstudio_template_catalog to authenticated;
grant insert, update, delete on table public.mokstudio_template_catalog to authenticated;

-- Anyone signed in can browse / download the master catalog.
drop policy if exists mokstudio_template_catalog_select on public.mokstudio_template_catalog;
create policy mokstudio_template_catalog_select
  on public.mokstudio_template_catalog
  for select
  to authenticated
  using (auth.uid() is not null);

-- Writes limited to Dev admin (matches DEV_ACCESS_EMAILS in the app).
drop policy if exists mokstudio_template_catalog_write on public.mokstudio_template_catalog;
create policy mokstudio_template_catalog_write
  on public.mokstudio_template_catalog
  for all
  to authenticated
  using (
    auth.uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'hello@jppferreira.com'
  )
  with check (
    auth.uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'hello@jppferreira.com'
  );

revoke all on function public.mokstudio_template_catalog_set_updated_at() from public, anon, authenticated;

insert into public.mokstudio_template_catalog (id, payload)
values ('master', jsonb_build_object(
  'kind', 'mockup-studio-templates',
  'version', 1,
  'updatedAt', (extract(epoch from now()) * 1000)::bigint,
  'removedIds', '[]'::jsonb,
  'templates', '[]'::jsonb
))
on conflict (id) do nothing;
