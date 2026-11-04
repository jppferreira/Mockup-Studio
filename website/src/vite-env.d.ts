/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHECKOUT_PRO_URL?: string;
  readonly VITE_CHECKOUT_PRO_MAX_URL?: string;
  readonly VITE_CHECKOUT_UPDATE_PASS_URL?: string;
  readonly VITE_DOWNLOAD_MAC_URL?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_SALES_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
