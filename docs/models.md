# Licensed device models

Device `.glb` files are **not** stored in git and are **not** shipped inside the app bundle.

They live in a **private** Supabase Storage bucket (`device-models`) and are downloaded **on demand** when a user places or previews that device. The client stores an encrypted opaque blob in IndexedDB (not a plaintext `.glb` on disk).

## Local setup

1. Copy `.env.example` → `.env.local` and set:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_MODEL_APP_SECRET=...   # same value as Edge Function secret MODEL_APP_SECRET
```

2. Keep licensed meshes in `.model-library/models/` (gitignored). Never put them back under `public/models/` or Vite will ship them in `dist/`.

3. Deploy / update the Edge Function:

```bash
supabase functions deploy device-model-url --no-verify-jwt
supabase secrets set MODEL_APP_SECRET=...
```

4. Upload meshes (service role; never commit this key):

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/upload-device-models.mjs
```

## Runtime flow

1. App asks `device-model-url` for one `deviceId` with `x-mockup-model-secret`.
2. Function returns a short-lived signed URL for that single object.
3. App downloads once, encrypts into IndexedDB, loads via a temporary `blob:` URL.

## Rights

Do not publish the GLBs on GitHub, in public buckets, or as release assets. Customer installs only receive models they actually use, through the gated signed-URL path.
