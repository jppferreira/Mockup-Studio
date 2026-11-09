-- Applied after the initial table: store an explicit consent record.
-- Visitors cannot insert a row unless consent is true.
-- consented_at and privacy_version are set by the database, not the browser.

alter table public.mokstudio_beta_signups
  add column if not exists consent boolean not null default false,
  add column if not exists consented_at timestamptz,
  add column if not exists privacy_version text;

alter table public.mokstudio_beta_signups
  drop constraint if exists mokstudio_beta_signups_consent_required;

alter table public.mokstudio_beta_signups
  add constraint mokstudio_beta_signups_consent_required check (consent is true);

create or replace function public.mokstudio_normalize_beta_email()
returns trigger
language plpgsql
as $$
begin
  if new.consent is not true then
    raise exception 'Beta signup requires consent';
  end if;
  new.email := lower(btrim(new.email));
  if new.source is not null then
    new.source := left(btrim(new.source), 80);
  end if;
  new.consented_at := now();
  new.privacy_version := '2026-11-09';
  return new;
end;
$$;

drop policy if exists mokstudio_beta_signups_insert on public.mokstudio_beta_signups;
create policy mokstudio_beta_signups_insert
  on public.mokstudio_beta_signups
  for insert
  to anon, authenticated
  with check (consent is true and char_length(email) between 5 and 320);
