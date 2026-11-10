-- Phase 3: account-bound entitlements (grandfathered license keys + future Stripe).
-- Clients may SELECT their own row; writes go through Edge Functions (service role).

create table if not exists public.mokstudio_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null default 'free'
    check (tier in ('free', 'pro', 'pro_max')),
  source text not null default 'none'
    check (source in ('none', 'key', 'stripe')),
  -- SHA-256 hex of the bound MS-PRO / MS-PROMAX key (unique across users).
  license_key_hash text
    check (license_key_hash is null or char_length(license_key_hash) = 64),
  license_prefix text
    check (license_prefix is null or license_prefix in ('MS-PRO', 'MS-PROMAX')),
  updates_until timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mokstudio_entitlements_hash_unique unique (license_key_hash)
);

comment on table public.mokstudio_entitlements is
  'Per-auth-user Pro entitlement. Bound offline keys are hashed; raw keys are never stored.';

create or replace function public.mokstudio_entitlements_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mokstudio_entitlements_updated_at on public.mokstudio_entitlements;
create trigger mokstudio_entitlements_updated_at
  before update on public.mokstudio_entitlements
  for each row
  execute function public.mokstudio_entitlements_set_updated_at();

alter table public.mokstudio_entitlements enable row level security;
alter table public.mokstudio_entitlements force row level security;

revoke all on table public.mokstudio_entitlements from public, anon, authenticated;
grant select on table public.mokstudio_entitlements to authenticated;

drop policy if exists mokstudio_entitlements_select on public.mokstudio_entitlements;
create policy mokstudio_entitlements_select
  on public.mokstudio_entitlements
  for select
  to authenticated
  using (auth.uid() is not null and user_id = auth.uid());

revoke all on function public.mokstudio_entitlements_set_updated_at() from public, anon, authenticated;
