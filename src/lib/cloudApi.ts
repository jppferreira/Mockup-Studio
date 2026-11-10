import type { CloudLibraryStatus, CloudListRow } from './cloudLibrary';
import {
  supportsWebCloudLibrary,
  webCloudClear,
  webCloudList,
  webCloudPick,
  webCloudRead,
  webCloudRemove,
  webCloudResume,
  webCloudStatus,
  webCloudTemplatesRead,
  webCloudTemplatesWrite,
  webCloudUse,
  webCloudWrite,
  webOnCloudChanged,
} from './webCloudLibrary';

export interface CloudApi {
  cloudStatus: () => Promise<CloudLibraryStatus>;
  cloudUse: (provider: 'icloud' | 'google-drive') => Promise<{ canceled: boolean; status: CloudLibraryStatus }>;
  cloudPick: () => Promise<{ canceled: boolean; status: CloudLibraryStatus }>;
  cloudClear: () => Promise<CloudLibraryStatus>;
  /** Re-enable a remembered folder after reload (web). No-op on desktop. */
  cloudResume?: () => Promise<CloudLibraryStatus>;
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
  onCloudChanged: (handler: () => void) => () => void;
}

const webApi: CloudApi = {
  cloudStatus: webCloudStatus,
  cloudUse: webCloudUse,
  cloudPick: webCloudPick,
  cloudClear: webCloudClear,
  cloudResume: webCloudResume,
  cloudList: webCloudList,
  cloudRead: webCloudRead,
  cloudWrite: webCloudWrite,
  cloudRemove: webCloudRemove,
  cloudTemplatesRead: webCloudTemplatesRead,
  cloudTemplatesWrite: webCloudTemplatesWrite,
  onCloudChanged: webOnCloudChanged,
};

/** Desktop IPC when present; otherwise the in-browser folder library. */
export function getCloudApi(): CloudApi | null {
  const desktop = typeof window !== 'undefined' ? window.mockupDesktop : undefined;
  if (desktop?.cloudStatus && desktop.cloudWrite) {
    return {
      cloudStatus: () => desktop.cloudStatus(),
      cloudUse: (provider) => desktop.cloudUse(provider),
      cloudPick: () => desktop.cloudPick(),
      cloudClear: () => desktop.cloudClear(),
      cloudList: () => desktop.cloudList(),
      cloudRead: (filePath) => desktop.cloudRead(filePath),
      cloudWrite: (payload) => desktop.cloudWrite(payload),
      cloudRemove: (filePath) => desktop.cloudRemove(filePath),
      cloudTemplatesRead: () => desktop.cloudTemplatesRead(),
      cloudTemplatesWrite: (contents) => desktop.cloudTemplatesWrite(contents),
      onCloudChanged: (handler) => desktop.onCloudChanged(handler),
    };
  }
  if (supportsWebCloudLibrary()) return webApi;
  return null;
}

export function cloudApiAvailable() {
  return Boolean(getCloudApi());
}
