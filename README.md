# mokstudio

A local-first **Electron + React + Three.js** 3D smartphone mockup editor for macOS. This is a runnable starter/MVP (source code), **not** a signed or notarised macOS binary.

## Run in Cursor on your Mac

Requirements: Node.js 20.19+ (22 recommended), npm, macOS.

```bash
npm install
npm run dev
```

The Electron app opens after Vite starts. For a browser-only preview, use `npm run dev:web` and open http://localhost:5173.

## Build a Mac application

From **macOS**, run:

```bash
npm install
npm run dist:mac
```

The output will be under `release/`, including an Apple Silicon `.dmg` and a `.zip`. The default build is unsigned and unnotarised; macOS Gatekeeper may warn. Distribution to other people generally requires an Apple Developer ID certificate and notarisation. This zip contains **source code only**, not the compiled `.dmg`.

## What's implemented

- Attractive three-panel editor, with an original example screenshot at startup
- Procedurally modelled smartphone with metallic frame, camera details and screen cutout
- Interactive 3D orbit and zoom; camera presets and rotation/scale sliders
- Screenshot replacement from PNG/JPG/WebP via file picker or drag/drop
- iPhone / iPad USB screen Mirror (macOS camera capture) with Snapshot onto the 3D device
- Android USB Mirror prototype via ADB screencap (Pixel & Samsung preferred) with full-res Snapshot
- Four device finishes, five background presets, lighting adjustment
- High-resolution WebGL PNG export: TikTok/Shorts, Reels, Instagram Feed, YouTube, Apple App Store, Google Play sizes
- Save/open local `.mockup` project files (gzip-compressed JSON; still opens legacy `.mockup.json`), including screenshot image data
- Native macOS open/save dialogs in Electron; browser-download fallback
- Keyboard shortcuts: Cmd/Ctrl+S, Cmd/Ctrl+O, Cmd/Ctrl+E

## Important limitations

- Device meshes in `public/models/` are **third-party CC BY (and similar) Sketchfab assets** — see `CREDITS.md` and the website `/credits` page. They are fan-made visualizations, not official manufacturer models.
- Free plan limits devices, resolution, and video; Pro / Pro Max unlock via signed license keys (see Licensing below).
- Open/save projects use embedded data URLs; large screenshots can result in large JSON files. For production, switch to a packaged project format with separate assets.
- The live preview and image export require an operational WebGL GPU. Maximum export dimensions depend on the GPU.
- Fonts fall back to system fonts when offline.
- No account or cloud upload is required. Optional checkout uses Lemon Squeezy / Paddle / Stripe payment links when configured.
- Dependencies must be installed with `npm install`; builds were not compiled in this delivery environment.

## Structure

```text
mockup-studio/
  electron/
    main.cjs        Native windows and file dialogs
    preload.cjs     Secure Electron API bridge
  src/
    App.tsx         App UI, state, import, export, projects
    components/
      DeviceCanvas.tsx  Three.js device model and export renderer
    lib/
      demo.ts       Original sample screenshot
      project.ts    Validation and browser file downloads
    styles.css      Desktop app design system
    types.ts        Project types and presets
  index.html
  package.json
  vite.config.ts
  tsconfig.json
```

## Next improvements

- Unit/UI tests and a signed/notarised release pipeline
- Mac App Store build with StoreKit unlocks mapped to the same tiers
- Better aspect-aware camera composition and crop controls
- Automated project recovery / autosave

## Pricing & checkout

Plans and “what you get” live in `shared/pricing.ts` (Free £0 · Pro £49 · Pro Max £99 · Update Pass £29/yr). Website and app both import that file.

To take payments, copy `.env.example` to `.env.local` (and `website/.env.local`) and set Lemon Squeezy / Paddle / Stripe Payment Link URLs:

```bash
cp .env.example .env.local
cp .env.example website/.env.local
# fill VITE_CHECKOUT_PRO_URL, VITE_CHECKOUT_PRO_MAX_URL, VITE_CHECKOUT_UPDATE_PASS_URL
# fill VITE_DOWNLOAD_MAC_URL with the public .dmg link after npm run dist:mac
```

Configure the store’s success URL to `/thanks?plan=pro` (or `pro_max`). For production, run the fulfillment server (`npm run fulfill:dev` / see `server/README.md`) so Lemon/Paddle webhooks mint a signed key and email it via Resend. Manual keys: `npm run license:issue -- pro`. Until checkout URLs are set, Buy buttons fall back to `mailto:` via `VITE_SALES_EMAIL`. Until `VITE_DOWNLOAD_MAC_URL` is set, Download buttons scroll to the landing `#download` section.

## Licensing

- **App code / binaries:** proprietary — see root [`LICENSE`](LICENSE). `package.json` declares `"license": "UNLICENSED"`.
- **Buyer terms:** website [`/terms`](website/src/pages/TermsPage.tsx) (personal vs commercial, updates, Dual-Mac policy, future Mac App Store note).
- **Device models:** CC BY / Sketchfab terms — [`CREDITS.md`](CREDITS.md) and website `/credits`.
- **License keys (direct download):** Ed25519-signed offline keys, format `MS-PRO.<payload>.<sig>` / `MS-PROMAX.…` / `MS-UPDATE.…`. Generate with:

```bash
# once per machine / rotation
node scripts/issue-license.mjs --init   # writes gitignored private key + public key module
npm run license:issue -- pro
npm run license:issue -- pro_max
npm run license:issue -- update_pass
```

Entitlements are always driven by `LicenseTier` in `shared/pricing.ts`, so a future Mac App Store / StoreKit build can set the same tiers without a second feature matrix.

## Privacy

Your imported screenshots and project files remain local. The desktop app does not upload project contents. The marketing site may load Google Fonts when online. npm dependencies keep their own open-source licences.
