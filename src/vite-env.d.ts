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
    ensureCameraAccess?: () => Promise<{ granted: boolean; status?: string; reason?: string }>;
    figmaRequest?: (apiPath: string, token: string) => Promise<{ status: number; body: string }>;
    figmaFetchImage?: (
      imageUrl: string,
      token: string,
    ) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
    androidStatus?: () => Promise<{
      ok: boolean;
      adb: string | null;
      devices: Array<{
        serial: string;
        state: string;
        manufacturer: string;
        brand?: string;
        model: string;
        product?: string;
        release?: string;
        sdk?: string;
        label: string;
        preferred: boolean;
        brandRank: number;
      }>;
      mirroringSerial: string | null;
      error?: string;
    }>;
    androidStartMirror?: (serial?: string) => Promise<{
      ok: boolean;
      device: {
        serial: string;
        label: string;
        manufacturer: string;
        model: string;
        release?: string;
        preferred: boolean;
        brandRank: number;
      };
    }>;
    androidStopMirror?: () => Promise<{ stopped: boolean; serial?: string }>;
    androidSnapshot?: (serial?: string) => Promise<{ mime: string; dataUrl: string; byteLength: number }>;
    onAndroidMirrorFrame?: (handler: (frame: {
      serial: string;
      mime: string;
      base64: string;
      width: number;
      height: number;
      sourceWidth: number;
      sourceHeight: number;
    }) => void) => () => void;
    onAndroidMirrorError?: (handler: (payload: { serial: string; message: string }) => void) => () => void;
  };
}
