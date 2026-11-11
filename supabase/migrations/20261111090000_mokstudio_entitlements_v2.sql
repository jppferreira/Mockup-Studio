-- Unified licensing: plans/status/provider refs, device seats, audit events.
-- Extends mokstudio_entitlements; clients remain SELECT-only.

-- Widen source / add commercial plan + status fields.
alter table public.mokstudio_entitlements
  drop constraint if exists mokstudio_entitlements_source_check;

alter table public.mokstudio_entitlements
  add constraint mokstudio_entitlements_source_check
  check (source in ('none', 'key', 'stripe', 'mas', 'lemon', 'paddle', 'manual'));

alter table public.mokstudio_entitlements
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'trial', 'monthly', 'yearly', 'lifetime', 'pro', 'pro_max', 'update_pass')),
  add column if not exists status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired', 'revoked')),
  add column if not exists provider text
    check (provider is null or provider in ('key', 'stripe', 'mas', 'lemon', 'paddle', 'manual')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists apple_original_transaction_id text,
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists max_devices integer not null default 1
    check (max_devices >= 0 and max_devices <= 16),
  add column if not exists offline_token_version integer not null default 1;

comment on column public.mokstudio_entitlements.plan is
  'Commercial SKU. Legacy one-time Pro maps to plan=pro / lifetime semantics via status + period_end null.';
comment on column public.mokstudio_entitlements.status is
  'Entitlement lifecycle. canceled keeps access until period_end when set.';
comment on column public.mokstudio_entitlements.max_devices is
  'Active desktop seats for direct-download builds. MAS builds ignore seat caps.';

-- Backfill plan/provider from legacy tier + source.
update public.mokstudio_entitlements
set
  plan = case
    when tier = 'pro_max' then 'pro_max'
    when tier = 'pro' then 'pro'
    else 'free'
  end,
  provider = case
    when source = 'none' then null
    when source = 'key' then 'key'
    when source = 'stripe' then 'stripe'
    else source
  end,
  max_devices = case when tier = 'pro_max' then 2 else 1 end,
  status = 'active'
where plan = 'free' and tier in ('pro', 'pro_max');

create unique index if not exists mokstudio_entitlements_stripe_customer_uidx
  on public.mokstudio_entitlements (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists mokstudio_entitlements_stripe_sub_uidx
  on public.mokstudio_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists mokstudio_entitlements_apple_txn_uidx
  on public.mokstudio_entitlements (apple_original_transaction_id)
  where apple_original_transaction_id is not null;

-- Device seats (direct-download Mac). Mutations via Edge Functions only.
create table if not exists public.mokstudio_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_fingerprint text not null
    check (char_length(device_fingerprint) >= 16 and char_length(device_fingerprint) <= 128),
  label text,
  platform text not null default 'mac_direct'
    check (platform in ('mac_direct', 'mac_mas', 'web')),
  bound_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint mokstudio_devices_user_fp_unique unique (user_id, device_fingerprint)
);

comment on table public.mokstudio_devices is
  'Privacy-conscious install identifiers for direct-download seat management.';

create index if not exists mokstudio_devices_user_active_idx
  on public.mokstudio_devices (user_id)
  where revoked_at is null;

alter table public.mokstudio_devices enable row level security;
alter table public.mokstudio_devices force row level security;

revoke all on table public.mokstudio_devices from public, anon, authenticated;
grant select on table public.mokstudio_devices to authenticated;

drop policy if exists mokstudio_devices_select on public.mokstudio_devices;
create policy mokstudio_devices_select
  on public.mokstudio_devices
  for select
  to authenticated
  using (auth.uid() is not null and user_id = auth.uid());

-- Audit / idempotency ledger for payment + licence mutations.
create table if not exists public.mokstudio_entitlement_events (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  actor text not null,
  event_type text not null,
  provider text,
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.mokstudio_entitlement_events is
  'Append-only grant/revoke/bind audit trail. external_id is used for webhook idempotency.';

create unique index if not exists mokstudio_entitlement_events_provider_external_uidx
  on public.mokstudio_entitlement_events (provider, external_id)
  where external_id is not null;

create index if not exists mokstudio_entitlement_events_user_idx
  on public.mokstudio_entitlement_events (user_id, created_at desc);

alter table public.mokstudio_entitlement_events enable row level security;
alter table public.mokstudio_entitlement_events force row level security;

revoke all on table public.mokstudio_entitlement_events from public, anon, authenticated;
grant select on table public.mokstudio_entitlement_events to authenticated;

drop policy if exists mokstudio_entitlement_events_select on public.mokstudio_entitlement_events;
create policy mokstudio_entitlement_events_select
  on public.mokstudio_entitlement_events
  for select
  to authenticated
  using (auth.uid() is not null and user_id = auth.uid());
