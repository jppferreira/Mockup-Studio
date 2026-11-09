# Device library IP / branding audit

**Date:** 2026-11-09  
**Scope:** Rotato-style naming, logo hiding, disclaimers, model licensing flags.  
**Important:** Removing logos and adding disclaimers does **not** eliminate trademark, registered design, copyright, or licensing risk. This report is an engineering checklist, not legal advice.

## Changes shipped

### Device naming
- Kept descriptive product names (e.g. iPhone 16 Pro Max, Galaxy S26 Ultra, Pixel 9 Pro).
- Removed author / “Official”-looking subtitle fragments (e.g. Vision Pro no longer shows `DextonOfficial`).
- Renamed library label `Apple HomeView` → `HomeView` (descriptive, less manufacturer-led).
- No “Official / Certified / Partner” marketing phrases in the library.
- Added **Generic** category with brand-free procedural **Smartphone**, **Tablet**, and **Laptop**.

### Manufacturer logos
- Centralised detection in `src/lib/brandMarks.ts` (nodes + materials).
- Applied in the main renderer (`DeviceCanvas`) and animation preset thumbs (`AnimationPresetsPanel`).
- Expanded `hideNodes` for Galaxy S21 Ultra, Pixel 9/10 Pro, JBL Tour One M3; kept existing Apple / iPad / HomeView hides.
- Removed JBL logo materials from `glassMats` so marks are not boosted as glass.

### Legal copy
- Shared strings in `shared/legal.ts`:
  - Non-affiliation disclaimer
  - Export / usage notice
  - Model licensing notice
- Surfaced in **Settings → Legal**, **About**, dashboard **Settings**, export modal (concise notice), License modal, website **Terms**, and **Credits** disclaimer.

### Model licensing
- Added `licenseClarity` / `licenseNote` on `DeviceModel`.
- Commercial DCC-pack meshes flagged `needs_review` (do not treat “redistribution OK” notes as SaaS clearance).
- Procedural generics marked `procedural`.
- Original GLB source downloads remain gated / not offered to end users (`docs/models.md` flow unchanged).

## Logo audit (geometry / materials)

| Device / file | Logo evidence | Mitigation |
| --- | --- | --- |
| `iphone_16_pro_max` | `Cube.014_apple logo…`, mat `apple_logo.001` | `hideNodes` + auto-hide |
| `iphone_13_pro_max` | `Apple Logo*` | `hideNodes` + auto-hide |
| `iphone_18_pro` / `_max` | node `Apple` | `hideNodes` + auto-hide |
| `ipad_mini_6` | `…BaseColorLogo…` | `hideNodes` + auto-hide |
| `apple_homeview` | `logo`, `logo.001`, `logo.002` | `hideNodes` + auto-hide |
| `galaxy_s21_ultra` | `Logo`, `Logo_BodyFrame_0` | **added** `hideNodes` + auto-hide |
| `pixel_9_pro` / `pixel_10_pro` | `BackBody..001_Logo_0`, mat `Logo` | **added** `hideNodes` + auto-hide |
| `pixel_9_pro_xl` | mat `Google.002` on `Object_10` | material-name auto-hide |
| `jbl_tour_one_m3` | `JBL_Logo_*`, `Button_Logo_*` | **added** `hideNodes`; removed from glass |
| Most MacBooks / iPhones with hashed names | No named logo nodes | **Residual risk:** emboss / albedo logos in textures |

## Models requiring legal review (`needs_review`)

| Id | Reason |
| --- | --- |
| `pixel_fold` | Commercial pack GLB |
| `galaxy_z_flip8` | Commercial pack GLB |
| `galaxy_z_fold8` | Commercial pack GLB |
| `galaxy_z_fold8_ultra` | Commercial pack GLB |
| `apple_watch_series_12` | Element 3D / C4D pack |
| `pixel_watch_7` | Commercial pack FBX |
| `ipad_pro_m5` | Apple Products 2026 pack |
| `macbook_pro_m5` | Apple Products 2026 pack |
| `imac_24` | iMac colors pack |
| `imac_m4` | Apple Products 2026 pack |
| `apple_homeview` | Commercial pack FBX + textures |

CC BY Sketchfab assets still require attribution (see Credits) and do not clear trademark / design-rights issues for photoreal device lookalikes.

## Remaining IP risks (counsel)

1. **Trade dress / registered design** — accurate device silhouettes remain recognisable even without logos.
2. **Texture-baked logos** — several Sketchfab meshes may still show logos in albedo/normal maps where there is no separate logo mesh (notably some MacBooks and `iphone_15_pro_max`).
3. **Static PNG thumbs** (`public/device-thumbs`) — may still depict logos until regenerated from logo-hidden renders.
4. **Trademark use in UI** — product names are used descriptively; counsel should review jurisdiction-specific nominative fair use.
5. **Commercial pack licence scope** — confirm each pack permits use inside a paid SaaS / desktop mockup generator and customer commercial exports.
6. **CC BY obligations** — ensure Credits remain accessible; some jurisdictions still limit trademark implications of CC BY meshes.
7. **Export liability** — usage notice shifts responsibility to the user but does not immunise the product for contributory claims.

## Validation checklist

- [x] Named logo nodes/materials audited across `.model-library/models`
- [x] Auto-hide wired into renderer + animation thumbs
- [x] Legal / About / export / Terms copy present
- [x] Generic alternatives available and free
- [ ] Visual QA: spot-check back of iPhone / Pixel / MacBook / JBL in studio + PNG/MP4 export
- [ ] Regenerate device thumbs that still show logos
- [ ] Counsel review of `needs_review` packs before commercial release
