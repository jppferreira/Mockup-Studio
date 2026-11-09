-- Marketing-site beta list. Anonymous visitors may insert an email.
-- They cannot read, update, or delete rows.

create table if not exists public.mokstudio_beta_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text,
  created_at timestamptz not null default now(),
  constraint mokstudio_beta_signups_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint mokstudio_beta_signups_email_unique unique (email)
);

create index if not exists mokstudio_beta_signups_created_at_idx
  on public.mokstudio_beta_signups (created_at desc);

create or replace function public.mokstudio_normalize_beta_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(btrim(new.email));
  if new.source is not null then
    new.source := left(btrim(new.source), 80);
  end if;
  return new;
end;
$$;

drop trigger if exists mokstudio_beta_signups_normalize on public.mokstudio_beta_signups;
create trigger mokstudio_beta_signups_normalize
  before insert or update on public.mokstudio_beta_signups
  for each row
  execute function public.mokstudio_normalize_beta_email();

alter table public.mokstudio_beta_signups enable row level security;

revoke all on table public.mokstudio_beta_signups from public, anon, authenticated;
grant insert on table public.mokstudio_beta_signups to anon, authenticated;

drop policy if exists mokstudio_beta_signups_insert on public.mokstudio_beta_signups;
create policy mokstudio_beta_signups_insert
  on public.mokstudio_beta_signups
  for insert
  to anon, authenticated
  with check (char_length(email) between 5 and 320);

revoke all on function public.mokstudio_normalize_beta_email() from public, anon, authenticated;
