/// <reference types="vite/client" />

import type { CloudLibraryStatus, CloudListRow } from './lib/cloudLibrary';

declare global {
declare const __APP_VERSION__: string;
declare const __SITE_GATE_SHA256__: string;

interface ImportMetaEnv {
  readonly VITE_CHECKOUT_PRO_URL?: string;
  readonly VITE_CHECKOUT_PRO_MAX_URL?: string;
  readonly VITE_CHECKOUT_UPDATE_PASS_URL?: string;
  readonly VITE_DOWNLOAD_MAC_URL?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_SALES_EMAIL?: string;
  /** License + feedback API base (e.g. http://127.0.0.1:8787 or https://license.mokstudio.io) */
  readonly VITE_FULFILL_API_URL?: string;
  /** Private Supabase project for on-demand device GLBs */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Must match Edge Function secret MODEL_APP_SECRET */
  readonly VITE_MODEL_APP_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  mockupDesktop?: {
    saveProject: (contents: string, proposedName: string) => Promise<{ canceled: boolean; path?: string }>;
    openProject: () => Promise<{ canceled: boolean; contents?: string; path?: string }>;
    /** Open a `.mockup` path handed over by Finder / Explorer. */
    openProjectPath?: (filePath: string) => Promise<{ contents: string; path: string }>;
    /** Consume a cold-launch open path that arrived before the renderer mounted. */
    takePendingOpen?: () => Promise<string | null>;
    onOpenFromOs?: (handler: (filePath: string) => void) => () => void;
    cloudStatus: () => Promise<CloudLibraryStatus>;
    cloudUse: (provider: 'icloud' | 'google-drive') => Promise<{ canceled: boolean; status: CloudLibraryStatus }>;
    cloudPick: () => Promise<{ canceled: boolean; status: CloudLibraryStatus }>;
    cloudClear: () => Promise<CloudLibraryStatus>;
    cloudList: () => Promise<CloudListRow[]>;
    cloudRead: (filePath: string) => Promise<{ path: string; contents: string; updatedAt: number }>;
    cloudWrite: (payload: { filePath?: string | null; contents: string; name: string }) => Promise<{
      path: string;
      updatedAt: number;
      unchanged: boolean;
    }>;
    cloudRemove: (filePath: string) => Promise<{ ok: boolean }>;
    cloudTemplatesRead: () => Promise<{
      path: string;
      contents: string | null;
      updatedAt: number;
      missing: boolean;
    }>;
    cloudTemplatesWrite: (contents: string) => Promise<{
      path: string;
      updatedAt: number;
      unchanged: boolean;
    }>;
    /** DEV-only: read src/data/shippedTemplates.json before promote so edits accumulate. */
    devReadShippedTemplates?: () => Promise<{
      ok: boolean;
      path?: string;
      contents?: string | null;
      missing?: boolean;
      reason?: string;
    }>;
    /** DEV-only: write src/data/shippedTemplates.json so templates ship with the next build. */
    devWriteShippedTemplates?: (contents: string) => Promise<{
      ok: boolean;
      path?: string;
      reason?: string;
    }>;
    onCloudChanged: (handler: () => void) => () => void;
    saveImage: (dataUrl: string, proposedName: string) => Promise<{ canceled: boolean; path?: string }>;
    saveMedia: (
      dataBase64: string,
      proposedName: string,
      extension: string,
      mimeType: string,
    ) => Promise<{ canceled: boolean; path?: string }>;
    openExternal: (url: string) => Promise<{ ok: boolean }>;
    updateStatus?: () => Promise<{
      state: 'idle' | 'downloading' | 'ready';
      version?: string | null;
      percent?: number;
    }>;
    installUpdate?: () => Promise<{ ok: boolean }>;
    onUpdateStatus?: (handler: (status: {
      state: 'idle' | 'downloading' | 'ready';
      version?: string | null;
      percent?: number;
    }) => void) => () => void;
    readClipboardImage?: () => Promise<{ ok: boolean; dataUrl?: string; name?: string }>;
    readClipboardHtml?: () => Promise<{ ok: boolean; html?: string }>;
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
    /** Desktop only: convert a .blend via local Blender into a packed GLB. */
    convertBlend?: (payload: {
      fileName: string;
      dataBase64: string;
    }) => Promise<
      | { ok: true; dataBase64: string; fileName: string }
      | { ok: false; error: string }
    >;
  };
}
}

export {};
