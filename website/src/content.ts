export const HEADLINE_OPTIONS = [
  {
    id: 'calm',
    label: 'Calm',
    headline: 'Make device shots without the fuss.',
    lede: 'Place a screenshot on a lit phone, nudge the angle, and export a still or a short clip — all on your Mac.',
  },
  {
    id: 'simple',
    label: 'Simple',
    headline: 'Screenshots, in a quiet 3D scene.',
    lede: 'Open a project, drop your UI onto a device, and save a clean mockup when it feels right.',
  },
  {
    id: 'local',
    label: 'Local',
    headline: 'A small studio that stays on your Mac.',
    lede: 'Compose with real devices, soft light, and optional motion. Nothing uploads; projects live as local files.',
  },
  {
    id: 'craft',
    label: 'Craft',
    headline: 'From screenshot to finished mockup.',
    lede: 'Angle the phone, tune the reflections, then export PNG or video for the next post or store listing.',
  },
  {
    id: 'soft',
    label: 'Soft',
    headline: 'Gentle lighting for your next app shot.',
    lede: 'A local mockup desk for iPhone, Pixel, and Galaxy — built for designers who prefer calm tools.',
  },
] as const;

export const FEATURES = [
  {
    icon: 'devices' as const,
    title: 'Real devices, real light',
    copy: 'Compose iPhone, Pixel, and Galaxy models with glass reflections, finishes, and studio lighting that hold up in App Store shots.',
    detail:
      'Built-in device library covers current iPhone, Pixel, and Galaxy models. Tune glass reflection, body finish, and studio lighting until the frame feels finished — without hunting for stock mockups.',
  },
  {
    icon: 'motion' as const,
    title: 'Stills and motion',
    copy: 'Keyframe rotation, position, and scale. Export crisp PNG frames or MP4 / GIF motion from the same scene.',
    detail:
      'One scene can become a quiet still or a short orbit. The timeline keeps motion simple: rotate, move, scale, ease, then export PNG, MP4, or GIF at the aspect you need.',
  },
  {
    icon: 'templates' as const,
    title: 'Templates & scenes',
    copy: 'Start from device layouts and scenic presets instead of a blank canvas every time.',
    detail:
      'Jump into single or multi-device compositions, soft studio backdrops, and prop-friendly scenes. Swap the screenshot and keep the lighting you already like.',
  },
  {
    icon: 'lighting' as const,
    title: 'Light & reflections',
    copy: 'Soft studio light, glass highlights, and reflection maps you can nudge until the phone feels real.',
    detail:
      'Dial reflection strength, environment maps, and fill so screenshots sit in the device instead of floating on a flat PNG.',
  },
  {
    icon: 'export' as const,
    title: 'Export that fits',
    copy: 'Ship PNG, MP4, or GIF sized for TikTok, Reels, YouTube, Instagram, App Store, and Play.',
    detail:
      'Pick an aspect and resolution once, then export a still or short motion clip without re-framing the whole scene.',
  },
  {
    icon: 'local' as const,
    title: 'Local by design',
    copy: 'Screenshots and projects stay on your Mac. No account, no cloud upload, no waiting on someone else’s render queue.',
    detail:
      'Projects save as local files. There is no login wall and no remote render step — useful when the UI is still under NDA.',
  },
] as const;

export const STEPS = [
  {
    n: '01',
    title: 'Drop a screenshot',
    copy: 'PNG, JPG, or WebP onto the screen. Templates get you composing in seconds.',
    detail:
      'Drag media onto the device screen or pick a file. Start from a template if you want a layout already framed for store or social sizes.',
  },
  {
    n: '02',
    title: 'Shape the scene',
    copy: 'Frame, light, reflect, and animate. Add props or a second device when the story needs it.',
    detail:
      'Nudge camera angle, reflection strength, and background. Add a second phone or a quiet prop when the composition needs more context.',
  },
  {
    n: '03',
    title: 'Export and ship',
    copy: 'TikTok, Reels, YouTube, Instagram, Apple App Store, and Google Play sizes — stills or video, ready for the next post.',
    detail:
      'Choose aspect and resolution, then export a still or motion clip. Keep the project file if you want to revisit the same setup later.',
  },
] as const;

export const PRIVACY_POINTS = [
  {
    title: 'No account required',
    copy: 'Open the app and start working. There is no signup, trial wall, or cloud profile attached to your projects.',
  },
  {
    title: 'Files stay local',
    copy: 'Screenshots, custom devices, and .mockup projects live on disk. Closing the app does not sync anything elsewhere.',
  },
  {
    title: 'No remote render queue',
    copy: 'Preview and export run on your Mac’s GPU. You are not waiting on someone else’s servers to finish a shot.',
  },
  {
    title: 'Optional fonts only',
    copy: 'The marketing site and app may load Google Fonts when online. The core editor does not phone home with project contents.',
  },
] as const;
