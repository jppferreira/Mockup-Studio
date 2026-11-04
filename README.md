# Mockup Studio

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
- Four device finishes, five background presets, lighting adjustment
- High-resolution WebGL PNG export: TikTok/Shorts, Reels, Instagram Feed, YouTube, Apple App Store, Google Play sizes
- Save/open local `.mockup.json` project, including screenshot image data
- Native macOS open/save dialogs in Electron; browser-download fallback
- Keyboard shortcuts: Cmd/Ctrl+S, Cmd/Ctrl+O, Cmd/Ctrl+E

## Important limitations

- The phone is an **original procedural generic smartphone**, not a licensed manufacturer 3D model. No external assets are bundled.
- This MVP supports one smartphone per scene. Multi-device layouts, tablets, laptops, text overlays and video output are follow-up work.
- Open/save projects use embedded data URLs; large screenshots can result in large JSON files. For production, switch to a packaged project format with separate assets.
- The live preview and image export require an operational WebGL GPU. Maximum export dimensions depend on the GPU.
- Export is PNG only. Background gradients and transparent PNG are supported.
- Fonts fall back to system fonts when offline.
- No login, cloud services, external API, subscription or payments are required.
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
- Licensed GLB/GLTF device library with material/UV maps
- Multiple devices, layers, templates and text overlays
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

Configure the store’s success URL to `/thanks?plan=pro` (or `pro_max`). Deliver license keys as `MS-PRO-…` / `MS-PROMAX-…` so the desktop app can activate them. Until checkout URLs are set, Buy buttons fall back to `mailto:` via `VITE_SALES_EMAIL`. Until `VITE_DOWNLOAD_MAC_URL` is set, Download buttons scroll to the landing `#download` section.

## Privacy and licensing

Your imported screenshots and project files remain local. The app does not make API requests itself. The optional Google Fonts stylesheet downloads fonts when online; remove the CSS `@import` if you want absolutely zero network font requests. Dependence on npm packages means their respective open-source licences apply.
