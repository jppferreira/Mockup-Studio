import { validateProject } from './project';
import type { MockupProject } from '../types';

export type CloudProvider = 'icloud' | 'google-drive' | 'folder';

export interface CloudPlace {
  available: boolean;
  detail: string;
  /** False when the drive is installed but macOS hides the folder until the user picks it. */
  readable?: boolean;
}

export interface CloudLibraryStatus {
  configured: boolean;
  provider: CloudProvider | null;
  label: string | null;
  folderLabel: string | null;
  path: string | null;
  missing: boolean;
  icloud: CloudPlace;
  googleDrive: CloudPlace;
}

export interface CloudProjectEntry {
  path: string;
  name: string;
  updatedAt: number;
  deviceId: string;
  deviceCount: number;
  preview: string | null;
  project: MockupProject | null;
}

export interface CloudListRow {
  path: string;
  name: string;
  updatedAt: number;
  deviceId: string;
  deviceCount: number;
  preview: string | null;
  slim: string | null;
}

export function canonicalProjectJson(project: MockupProject) {
  try {
    return JSON.stringify(validateProject(JSON.parse(JSON.stringify(project)) as unknown));
  } catch {
    return JSON.stringify(project);
  }
}

export function isPathInsideLibrary(filePath: string, libraryPath: string) {
  const root = libraryPath.replace(/[/\\]+$/, '');
  return filePath === root || filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`);
}

export function projectFromCloudRow(row: CloudListRow): CloudProjectEntry {
  let project: MockupProject | null = null;
  if (row.slim) {
    try {
      project = validateProject(JSON.parse(row.slim) as unknown);
    } catch {
      project = null;
    }
  }
  return {
    path: row.path,
    name: project?.name?.trim() || row.name,
    updatedAt: row.updatedAt,
    deviceId: project?.deviceId || row.deviceId,
    deviceCount: project?.devices?.length || row.deviceCount,
    preview: row.preview,
    project,
  };
}

export function syncButtonLabel(status: CloudLibraryStatus | null) {
  if (!status?.configured) return 'Sync';
  if (status.missing) return 'Sync off';
  if (status.provider === 'icloud') return 'iCloud';
  if (status.provider === 'google-drive') return 'Drive';
  return 'Synced';
}
