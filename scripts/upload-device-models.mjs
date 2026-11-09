#!/usr/bin/env node
/**
 * Upload licensed device GLBs to the private Supabase `device-models` bucket.
 *
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/upload-device-models.mjs [sourceDir]
 *
 * Default sourceDir: .model-library/models (local only; gitignored)
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sourceDir = path.resolve(process.argv[2] || '.model-library/models');

if (!url || !serviceKey) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const entries = (await readdir(sourceDir)).filter((name) => name.toLowerCase().endsWith('.glb'));
if (entries.length === 0) {
  console.error(`No .glb files in ${sourceDir}`);
  process.exit(1);
}

let ok = 0;
let fail = 0;
for (const name of entries) {
  const filePath = path.join(sourceDir, name);
  const body = await readFile(filePath);
  const dest = `${url}/storage/v1/object/device-models/${name}`;
  const response = await fetch(dest, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'model/gltf-binary',
      'x-upsert': 'true',
    },
    body,
  });
  if (!response.ok) {
    const put = await fetch(dest, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'model/gltf-binary',
        'x-upsert': 'true',
      },
      body,
    });
    if (!put.ok) {
      console.error(`FAIL ${name}: ${put.status} ${await put.text()}`);
      fail += 1;
      continue;
    }
  }
  console.log(`OK ${name} (${Math.round(body.byteLength / 1024)}KB)`);
  ok += 1;
}

console.log(`Done ok=${ok} fail=${fail}`);
process.exit(fail ? 1 : 0);
