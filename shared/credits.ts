/** Third-party 3D model attribution — website Credits page + CREDITS.md stay in sync. */

export type CreditSectionId =
  | 'macbooks'
  | 'shipped'
  | 'phone-candidates'
  | 'pending-sketchfab';

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
  /** Groups rows on /credits (MacBooks listed first so they’re easy to find). */
  section?: CreditSectionId;
}

export interface CreditSection {
  id: CreditSectionId;
  title: string;
  intro?: string;
}

export const CREDIT_SECTIONS: CreditSection[] = [
  {
    id: 'macbooks',
    title: 'MacBook Pro & MacBook Air',
    intro: 'CC BY 4.0 Sketchfab MacBooks that passed visual QA — now bundled under public/models/.',
  },
  {
    id: 'shipped',
    title: 'Shipped device models',
    intro: 'Meshes currently included under public/models/.',
  },
  {
    id: 'phone-candidates',
    title: 'Newer phones',
    intro: 'CC BY 4.0 iPhone 18 / Galaxy S26 Ultra models — now bundled.',
  },
  {
    id: 'pending-sketchfab',
    title: 'Vision Pro & Watch Ultra',
    intro: 'Vision Pro and Apple Watch Ultra 2 — bundled with CC BY attribution.',
  },
];

const CC_BY = 'CC BY 4.0';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';

export const MODEL_CREDITS: ModelCredit[] = [
  // —— MacBooks ——
  {
    file: 'public/models/macbook_pro_m3_16.glb',
    model: 'MacBook Pro M3 16" (2024)',
    author: 'jackbaeten',
    authorUrl: 'https://sketchfab.com/jackbaeten',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/8e34fc2b303144f78490007d91ff57c4',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'macbooks',
  },
  {
    file: 'public/models/macbook_pro_m3_space_black.glb',
    model: 'MacBook Pro M3 Space Black 16"',
    author: 'EV_car2013',
    authorUrl: 'https://sketchfab.com/EV_car2013',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/6b46aa09dc4d4e90a79ea06f1d0aa719',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'macbooks',
  },
  {
    file: 'public/models/macbook_pro_16_2021.glb',
    model: 'Apple MacBook Pro 16" (2021)',
    author: 'jasperchui2007',
    authorUrl: 'https://sketchfab.com/jasperchui2007',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/6a42b31bac064b00a91fbfebec07c852',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'macbooks',
  },
  {
    file: 'public/models/macbook_pro_touchbar.glb',
    model: 'MacBook Pro (Touch Bar era)',
    author: 'jasperchui2007',
    authorUrl: 'https://sketchfab.com/jasperchui2007',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/a2158f4d07c24861b268b170cb24c6d8',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'macbooks',
  },
  {
    file: 'public/models/macbook_pro_13_2020.glb',
    model: 'MacBook Pro 13" (2020)',
    author: 'timblewee',
    authorUrl: 'https://sketchfab.com/timblewee',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/macbook-pro-13-inch-2020-efab224280fd4c3993c808107f7c0b38',
    note: 'Bundled via SceneView mirror of the same Sketchfab CC BY source.',
    section: 'macbooks',
  },
  {
    file: 'public/models/macbook_air_13_2023.glb',
    model: 'Apple MacBook Air 13" Space Gray (2023)',
    author: 'akshatmittal',
    authorUrl: 'https://sketchfab.com/akshatmittal',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/907bf1c943f248399e93a613eedf4897',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'macbooks',
  },

  // —— Shipped phone / tablet meshes ——
  {
    file: 'public/models/iphone_15_pro_max.glb',
    model: 'Apple iPhone 15 Pro Max Black',
    author: 'polyman (@Polyman_3D)',
    authorUrl: 'https://sketchfab.com/Polyman_3D',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/apple-iphone-15-pro-max-black-df17520841214c1792fb8a44c6783ee7',
    note: 'Attribution taken from embedded GLB extras (matches the shipped mesh).',
    section: 'shipped',
  },
  {
    file: 'public/models/iphone_16_pro_max.glb',
    model: 'iPhone 16 Pro Max',
    author: 'MajdyModels (@MG990)',
    authorUrl: 'https://sketchfab.com/MG990',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/iphone-16-pro-max-41a071ae12794b668502f58d1e0fd1a3',
    section: 'shipped',
  },
  {
    file: 'public/models/iphone_17_pro.glb',
    model: 'iPhone 17 Pro',
    author: 'Ranguel',
    authorUrl: 'https://sketchfab.com/Ranguel',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec',
    section: 'shipped',
  },
  {
    file: 'public/models/iphone_17_pro_max.glb',
    model: 'iPhone 17 Pro Max',
    author: 'MajdyModels (@MG990)',
    authorUrl: 'https://sketchfab.com/MG990',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/iphone-17-pro-max-87fc1df741384124a8ce0226d2b2058d',
    section: 'shipped',
  },
  {
    file: 'public/models/iphone_13_pro_max.glb',
    model: 'iPhone 13 Pro Max',
    author: 'DatSketch',
    authorUrl: 'https://sketchfab.com/DatSketch',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/apple-iphone-13-pro-max-4328dea00e47497dbeac73c556121bc9',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/galaxy_s21_ultra.glb',
    model: 'Samsung Galaxy S21 Ultra',
    author: 'DatSketch',
    authorUrl: 'https://sketchfab.com/DatSketch',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/samsung-galaxy-s21-ultra-cd962832be7744efb6b37fe0ee2027e7',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/pixel_9.glb',
    model: 'Google Pixel 6 (stand-in mesh)',
    author: 'Martin3D (@MartinCapkovic)',
    authorUrl: 'https://sketchfab.com/MartinCapkovic',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-6-01f4c735e9824d58813646d9167d5c42',
    section: 'shipped',
  },
  {
    file: 'public/models/pixel_9_pro.glb',
    model: 'Google Pixel 6 Pro (stand-in mesh)',
    author: 'DatSketch',
    authorUrl: 'https://sketchfab.com/DatSketch',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-6-pro-b9b58ca40c254f8dafd8370869af74fb',
    section: 'shipped',
  },
  {
    file: 'public/models/pixel_10_pro.glb',
    model: 'Google Pixel 6 Pro (stand-in mesh for Pixel 10 Pro)',
    author: 'DatSketch',
    authorUrl: 'https://sketchfab.com/DatSketch',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-6-pro-b9b58ca40c254f8dafd8370869af74fb',
    section: 'shipped',
  },
  {
    file: 'public/models/pixel_9_pro_xl.glb',
    model: 'Google Pixel 7 Pro (stand-in mesh)',
    author: 'Imaginequad',
    authorUrl: 'https://sketchfab.com/Imaginequad',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/google-pixel-7-pro-3d5d6ad9b86c462f94bf1d0b08295b30',
    section: 'shipped',
  },
  {
    file: 'public/models/ipad_mini_6.glb',
    model: 'iPad mini 6',
    author: 'DatSketch',
    authorUrl: 'https://sketchfab.com/DatSketch',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/ipad-mini-6-2021-f363c2b1c74a462588db184bd4fb024e',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/apple_watch_series_7.glb',
    model: 'Apple Watch Series 7',
    author: 'SDC PERFORMANCE™',
    authorUrl: 'https://sketchfab.com/SDCPERFORMANCE',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/apple-watch-series-7-free-watch-face-sdctm-cf15ecbf159f42a28df5e56bdfa666bb',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/chronograph_watch.glb',
    model: 'Chronograph Watch',
    author: 'Darmstadt Graphics Group GmbH (Eric Chadwick)',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Khronos glTF Sample Assets',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ChronographWatch',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/rolex_watch.glb',
    model: 'Rolex Luxury Watch',
    author: 'sudo-self',
    authorUrl: 'https://sketchfab.com/sudo-self',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/rolex-watch-0fde5c5f56d841cda53ae4a01f66dfaf',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/airpods_pro.glb',
    model: 'AirPods Pro',
    author: 'JY_JY_',
    authorUrl: 'https://sketchfab.com/JY_JY_',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/airpods-pro-4478dddbfa244f6f9b93eebbd027a73b',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/sony_mdr_7506.glb',
    model: 'Sony MDR-7506 headphones',
    author: 'AndreiVNK',
    authorUrl: 'https://sketchfab.com/AndreiVNK',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/sony-mdr-7506-headphones-05735b74d3524f00b648231138122a28',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/skullcandy_crusher.glb',
    model: 'Skullcandy Crusher headphones',
    author: 'Ankledot',
    authorUrl: 'https://sketchfab.com/Ankledot',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/headphones-skullcandy-crusher-wireless-4e902017e4624547b440da0a6658a689',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  {
    file: 'public/models/jbl_tour_one_m3.glb',
    model: 'JBL Tour One M3 Headphones',
    author: 'cubemodelex',
    authorUrl: 'https://sketchfab.com/cubemodelex',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/jbl-tour-one-m3-black-45f0b3ccbee84492a05998d5daecff16',
    note: 'Bundled via SceneView assets-v1 mirror.',
    section: 'shipped',
  },
  // —— Newer phone candidates (CC BY; credit when bundled) ——
  {
    file: 'public/models/iphone_18_pro_max.glb',
    model: 'iPhone 18 Pro Max',
    author: 'Adreamyouvehadbefore',
    authorUrl: 'https://sketchfab.com/Adreamyouvehadbefore',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/e6b0f5abdfd74de29f347805fb724e5b',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'phone-candidates',
  },
  {
    file: 'public/models/iphone_18_pro.glb',
    model: 'iPhone 18 Pro',
    author: 'DUOPlyer',
    authorUrl: 'https://sketchfab.com/DUOPlyer',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/4a61ee52c29140449ee3d0a4368e5747',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'phone-candidates',
  },
  {
    file: 'public/models/galaxy_s26_ultra.glb',
    model: 'Samsung Galaxy S26 Ultra',
    author: 'AbrasiveFowl4870',
    authorUrl: 'https://sketchfab.com/AbrasiveFowl4870',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/8c7727ebe83f46d1878ada94863875ca',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'phone-candidates',
  },

  // —— Vision Pro & Watch Ultra ——
  {
    file: 'public/models/apple_vision_pro.glb',
    model: 'Apple Vision Pro',
    author: 'DextonOfficial',
    authorUrl: 'https://sketchfab.com/DextonOfficial',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/apple-vision-pro-3341d1f3f75e41b59fcedd1f46f03d56',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'pending-sketchfab',
  },
  {
    file: 'public/models/apple_watch_ultra_2.glb',
    model: 'Apple Watch Ultra 2',
    author: 'Polyman_3D',
    authorUrl: 'https://sketchfab.com/Polyman_3D',
    license: CC_BY,
    licenseUrl: CC_BY_URL,
    sourceLabel: 'Open on Sketchfab',
    sourceUrl: 'https://sketchfab.com/3d-models/apple-watch-ultra-2-f33263c457664b43909200c5ed5e6fa2',
    note: 'Bundled from Sketchfab CC BY download.',
    section: 'pending-sketchfab',
  },
];

export const CREDITS_INTRO =
  'The 3D device models shipped with Mockup Studio are third-party assets, mostly from Sketchfab under Creative Commons Attribution 4.0 (CC BY 4.0). They are not covered by the app’s proprietary license — reuse them under their own terms and keep attribution.';

export const CREDITS_DISCLAIMER =
  'These models are fan-made visualizations and are not official manufacturer assets. “iPhone”, “MacBook”, “iPad”, “AirPods”, “Apple Watch”, and “Vision Pro” are trademarks of Apple Inc. “Galaxy” is a trademark of Samsung Electronics. “Pixel” is a trademark of Google LLC. “Switch” is a trademark of Nintendo. Mockup Studio is not affiliated with or endorsed by these companies.';
