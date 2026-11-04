import { placeholderForDevice } from './demo';
import {
  DEFAULT_GRADIENT, DEFAULT_PROJECT, createDefaultAnimation,
  type MockupProject,
} from '../types';

export const MAX_PROJECT_TABS = 8;

export interface ProjectTab {
  id: string;
  project: MockupProject;
  animTime: number;
  animPlaying: boolean;
  timelineOpen: boolean;
}

export function createProjectTabId() {
  return `tab-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBlankProject(name?: string): MockupProject {
  const shot = placeholderForDevice(DEFAULT_PROJECT.deviceId);
  const primary = {
    ...DEFAULT_PROJECT.devices[0],
    screenshot: shot,
    deviceColor: DEFAULT_PROJECT.deviceColor,
    clayMode: DEFAULT_PROJECT.clayMode,
  };
  return {
    ...DEFAULT_PROJECT,
    name: name ?? 'Untitled composition',
    gradientColors: { ...DEFAULT_GRADIENT },
    screenshot: shot,
    publishTarget: 'ios',
    linkSplitTransform: true,
    devices: [primary],
    animation: createDefaultAnimation(),
  };
}

export function createProjectTab(project?: MockupProject, partial?: Partial<Omit<ProjectTab, 'id' | 'project'>>): ProjectTab {
  return {
    id: createProjectTabId(),
    project: project ?? createBlankProject(),
    animTime: partial?.animTime ?? 0,
    animPlaying: partial?.animPlaying ?? false,
    timelineOpen: partial?.timelineOpen ?? false,
  };
}

export function nextUntitledName(tabs: ProjectTab[]) {
  const used = new Set(tabs.map((tab) => tab.project.name.trim().toLowerCase()));
  if (!used.has('untitled composition')) return 'Untitled composition';
  for (let i = 2; i < 100; i += 1) {
    const name = `Untitled composition ${i}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `Untitled composition ${Date.now()}`;
}

export function tabLabel(project: MockupProject) {
  const name = project.name.trim() || 'Untitled';
  return name.length > 22 ? `${name.slice(0, 20)}…` : name;
}
