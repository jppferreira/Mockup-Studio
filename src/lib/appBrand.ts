/** In-app mark / name — DEV build uses the badged logo so it is obvious vs the DMG. */
export const APP_LOGO_SRC = import.meta.env.DEV
  ? './splash/logo-dev.png'
  : './splash/logo.png';

export const APP_DISPLAY_NAME = import.meta.env.DEV ? 'mokstudio Dev' : 'mokstudio';
