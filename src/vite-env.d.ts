/// <reference types="vite/client" />

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
  };
}
