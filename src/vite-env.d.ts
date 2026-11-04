/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

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

interface Window {
  mockupDesktop?: {
    saveProject: (contents: string, proposedName: string) => Promise<{ canceled: boolean; path?: string }>;
    openProject: () => Promise<{ canceled: boolean; contents?: string }>;
    saveImage: (dataUrl: string, proposedName: string) => Promise<{ canceled: boolean; path?: string }>;
    saveMedia: (
      dataBase64: string,
      proposedName: string,
      extension: string,
      mimeType: string,
    ) => Promise<{ canceled: boolean; path?: string }>;
    openExternal: (url: string) => Promise<{ ok: boolean }>;
  };
}
