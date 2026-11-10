-- Phase 2: revision tracking, soft delete/restore, content-addressed project assets.

alter table public.mokstudio_projects
  add column if not exists revision integer not null default 1
    check (revision >= 1),
  add column if not exists deleted_at timestamptz,
  add column if not exists preview_hash text
    check (preview_hash is null or char_length(preview_hash) between 8 and 128);

comment on column public.mokstudio_projects.revision is
  'Monotonic document revision from the client SceneDocument; used for conflict detection.';
comment on column public.mokstudio_projects.deleted_at is
  'Soft delete timestamp. Null means active. Restore clears this field.';
comment on column public.mokstudio_projects.preview_hash is
  'SHA-256 (or similar) of the preview blob for deduplicated storage uploads.';

-- Allow storage-relative preview keys as well as https signed/public URLs.
alter table public.mokstudio_projects
  drop constraint if exists mokstudio_projects_preview_url_check;

alter table public.mokstudio_projects
  add constraint mokstudio_projects_preview_url_check
  check (
    preview_url is null
    or (
      char_length(preview_url) <= 2_048
      and (
        preview_url ~* '^https://'
        or preview_url ~* '^project-assets/'
      )
    )
  );

create index if not exists mokstudio_projects_user_active_updated_idx
  on public.mokstudio_projects (user_id, updated_at desc)
  where deleted_at is null;

create index if not exists mokstudio_projects_user_deleted_idx
  on public.mokstudio_projects (user_id, deleted_at desc)
  where deleted_at is not null;

-- Private per-user project media (screenshots, previews). Paths: {auth.uid()}/{hash}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets',
  'project-assets',
  false,
  26214400, -- 25 MiB
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists mokstudio_project_assets_select on storage.objects;
create policy mokstudio_project_assets_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-assets'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists mokstudio_project_assets_insert on storage.objects;
create policy mokstudio_project_assets_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-assets'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists mokstudio_project_assets_update on storage.objects;
create policy mokstudio_project_assets_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'project-assets'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'project-assets'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists mokstudio_project_assets_delete on storage.objects;
create policy mokstudio_project_assets_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-assets'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );
