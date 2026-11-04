/** Third-party 3D model attribution — website Credits page + CREDITS.md stay in sync. */

export interface ModelCredit {
  file: string;
  model: string;
  author: string;
  authorUrl?: string;
  license: string;
  licenseUrl?: string;
  sourceLabel: string;
  sourceUrl: string;
  note?: string;
}

export const MODEL_CREDITS: ModelCredit[] = [
  {
    file: 'public/models/iphone_15_pro_max.glb',
    model: 'iPhone 15 Pro',
    author: 'Sketcher (@jnanbr07)',
    authorUrl: 'https://sketchfab.com/jnanbr07',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/iphone-15-pro-9e045e469d514fea9dda2ccd161f5fa3',
  },
  {
    file: 'public/models/iphone_16_pro_max.glb',
    model: 'iPhone 16 Pro Max',
    author: 'MajdyModels (@MG990)',
    authorUrl: 'https://sketchfab.com/MG990',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/iphone-16-pro-max-41a071ae12794b668502f58d1e0fd1a3',
  },
  {
    file: 'public/models/iphone_17_pro.glb',
    model: 'iPhone 17 Pro',
    author: 'Ranguel',
    authorUrl: 'https://sketchfab.com/Ranguel',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec',
  },
  {
    file: 'public/models/iphone_17_pro_max.glb',
    model: 'iPhone 17 Pro Max',
    author: 'MajdyModels (@MG990)',
    authorUrl: 'https://sketchfab.com/MG990',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/iphone-17-pro-max-87fc1df741384124a8ce0226d2b2058d',
  },
  {
    file: 'public/models/iphone_duo.glb',
    model: 'Apple iPhone Duo Fold Star White 2026 (Animated)',
    author: 'Sketchfab download (fan visualization)',
    license: 'See Sketchfab listing',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/apple-iphone-duo-fold-star-white-2026-animated',
    note: 'Confirm the live Sketchfab license before redistributing this mesh outside the app.',
  },
  {
    file: 'public/models/galaxy_s25_ultra.glb',
    model: 'Samsung Galaxy S25 Ultra',
    author: 'Bundled via Phone Mockup Studio',
    authorUrl: 'https://github.com/AxadXhabanTech/phone-mockup-studio',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Upstream CREDITS',
    sourceUrl: 'https://github.com/AxadXhabanTech/phone-mockup-studio',
  },
  {
    file: 'public/models/pixel_9.glb',
    model: 'Google Pixel 6 (stand-in mesh)',
    author: 'Martin3D (@MartinCapkovic)',
    authorUrl: 'https://sketchfab.com/MartinCapkovic',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-6-01f4c735e9824d58813646d9167d5c42',
  },
  {
    file: 'public/models/pixel_9_pro.glb',
    model: 'Google Pixel 6 Pro (stand-in mesh)',
    author: 'DatSketch',
    authorUrl: 'https://sketchfab.com/DatSketch',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-6-pro-b9b58ca40c254f8dafd8370869af74fb',
  },
  {
    file: 'public/models/pixel_10_pro.glb',
    model: 'Google Pixel 6 Pro (stand-in mesh for Pixel 10 Pro)',
    author: 'DatSketch',
    authorUrl: 'https://sketchfab.com/DatSketch',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-6-pro-b9b58ca40c254f8dafd8370869af74fb',
  },
  {
    file: 'public/models/pixel_9_pro_xl.glb',
    model: 'Google Pixel 7 Pro (stand-in mesh)',
    author: 'Imaginequad',
    authorUrl: 'https://sketchfab.com/Imaginequad',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceLabel: 'Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-7-pro-3d5d6ad9b86c462f94bf1d0b08295b30',
  },
];

export const CREDITS_INTRO =
  'The 3D device models shipped with Mockup Studio are third-party assets, mostly from Sketchfab under Creative Commons Attribution 4.0 (CC BY 4.0). They are not covered by the app’s proprietary license — reuse them under their own terms and keep attribution.';

export const CREDITS_DISCLAIMER =
  'These models are fan-made visualizations and are not official manufacturer assets. “iPhone” is a trademark of Apple Inc. “Galaxy” is a trademark of Samsung Electronics. “Pixel” is a trademark of Google LLC. Mockup Studio is not affiliated with or endorsed by Apple Inc., Samsung Electronics, or Google LLC.';
