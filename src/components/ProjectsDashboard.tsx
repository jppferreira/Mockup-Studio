import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cuboid, Glasses, Headphones, Laptop, LayoutGrid, Monitor, Smartphone, Tablet, UserRound, Watch, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hasAnimation } from '../lib/animation';
import {
  DEVICE_CATEGORY_ICON,
  DEVICE_CATEGORY_TABS,
  filterDevicesByCategory,
  type DeviceCategoryFilter,
  type DeviceCategoryIconKey,
  type DeviceModel,
} from '../lib/devices';
import {
  APP_ABOUT_SUMMARY,
  EXPORT_USAGE_NOTICE,
  MODEL_LICENSING_NOTICE,
  NON_AFFILIATION_DISCLAIMER,
} from '@shared/legal';
import { getCheckoutConfig } from '@shared/checkout';

const DEVICE_CATEGORY_LUCIDE: Record<DeviceCategoryIconKey, LucideIcon> = {
  'layout-grid': LayoutGrid,
  smartphone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  monitor: Monitor,
  watch: Watch,
  headphones: Headphones,
  glasses: Glasses,
  cuboid: Cuboid,
};
import AccentThemePicker from './AccentThemePicker';
import CloudSyncPanel, { type CloudTarget } from './CloudSyncPanel';
import CloudAccountPanel from './CloudAccountPanel';
import type { CloudLibraryStatus, CloudProjectEntry } from '../lib/cloudLibrary';
import { syncButtonLabel } from '../lib/cloudLibrary';
import { isDesktopApp } from '../lib/phoneMirror';
import type { RecentProjectEntry } from '../lib/recentProjects';
import type { RecentScreenshot } from '../lib/recentScreenshots';
import {
  templatesByCategory,
  type CompositionTemplate,
  type TemplateCategory,
} from '../lib/templates';
import type { MockupProject } from '../types';
import type { LicenseState } from '../lib/license';
import { isFreeDevice, planLabel } from '../lib/license';
import DeviceModelThumb from './DeviceModelThumb';
import TemplateThumb, { ProjectThumb } from './TemplateThumb';
import newProjectArt from '../assets/dashboard/new-project.svg';
import iconGrid from '../assets/dashboard/icon-grid.svg';
import iconCube from '../assets/dashboard/icon-cube.svg';
import iconLayers from '../assets/dashboard/icon-layers.svg';
import iconImage from '../assets/dashboard/icon-image.svg';
import iconSettings from '../assets/dashboard/icon-settings.svg';
import iconCubeAccent from '../assets/dashboard/icon-cube-accent.svg';
import iconSearch from '../assets/dashboard/icon-search.svg';
import iconDown from '../assets/dashboard/icon-down.svg';
import iconPlus from '../assets/dashboard/icon-plus.svg';
import iconChevron from '../assets/dashboard/icon-chevron.svg';
import iconDots from '../assets/dashboard/icon-dots.svg';

type DashSection = 'projects' | 'models' | 'templates' | 'assets' | 'settings';
type SortMode = 'edited' | 'name';

const NAV: { id: DashSection; label: string; icon: string }[] = [
  { id: 'projects', label: 'Projects', icon: iconGrid },
  { id: 'models', label: '3D models', icon: iconCube },
  { id: 'templates', label: 'Templates', icon: iconLayers },
  { id: 'assets', label: 'My assets', icon: iconImage },
  { id: 'settings', label: 'Settings', icon: iconSettings },
];

function editedPhrase(timestamp: number) {
  const startOf = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const day = 86_400_000;
  const diff = startOf(Date.now()) - startOf(timestamp);
  if (diff <= 0) return 'Edited today';
  if (diff < day * 1.5) return 'Edited yesterday';
  const days = Math.round(diff / day);
  if (days < 7) return `Edited ${days} days ago`;
  if (days < 14) return 'Edited last week';
  return `Edited ${new Date(timestamp).toLocaleDateString()}`;
}

type ListedProject = {
  key: string;
  name: string;
  updatedAt: number;
  deviceId: string;
  project: MockupProject | null;
  preview: string | null;
  filePath?: string;
  recent?: RecentProjectEntry;
};

function projectMeta(entry: { updatedAt: number; project: MockupProject | null }) {
  const edited = editedPhrase(entry.updatedAt);
  const clip = entry.project?.animation;
  if (clip && hasAnimation(clip)) {
    const seconds = Math.max(1, Math.round(clip.duration));
    return `${edited} · ${seconds}s animation`;
  }
  return `${edited} · Draft`;
}

export default function ProjectsDashboard({
  recentProjects,
  recentScreenshots,
  devices,
  license,
  licensingDisabled,
  cloud,
  cloudBusy,
  cloudProjects,
  onCloudUse,
  onCloudStop,
  onOpenCloudProject,
  onRemoveCloudProject,
  onOpenProject,
  onRemoveProject,
  onNewProject,
  onBlankFile,
  onOpenFile,
  onStartTemplate,
  onStartDevice,
  onDeleteSavedTemplate,
  onDeleteShippedTemplate,
  onDuplicateTemplate,
  onRenameTemplate,
  onAddShippedTemplate,
  savedCompositions,
  toolsetSwitchAvailable,
  isDeveloperToolset,
  onSetToolset,
  onExplorePro,
  onFeedback,
  onShowOnboarding,
  onShowStudioTour,
  onMergeCloudProjects,
  deviceUnlocked,
}: {
  recentProjects: RecentProjectEntry[];
  recentScreenshots: RecentScreenshot[];
  devices: DeviceModel[];
  license: LicenseState;
  licensingDisabled: boolean;
  cloud: CloudLibraryStatus | null;
  cloudBusy: boolean;
  cloudProjects: CloudProjectEntry[];
  onCloudUse: (target: CloudTarget) => void;
  onCloudStop: () => void;
  onOpenCloudProject: (filePath: string) => void;
  onRemoveCloudProject: (filePath: string) => void;
  onOpenProject: (entry: RecentProjectEntry) => void;
  onRemoveProject: (id: string) => void;
  onNewProject: () => void;
  onBlankFile?: () => void;
  onOpenFile: () => void;
  onStartTemplate: (template: CompositionTemplate) => void;
  onStartDevice: (deviceId: string) => void;
  onDeleteSavedTemplate: (id: string) => void;
  onDeleteShippedTemplate?: (template: CompositionTemplate) => void;
  onDuplicateTemplate: (template: CompositionTemplate) => void;
  onRenameTemplate?: (template: CompositionTemplate) => void;
  onAddShippedTemplate?: (category: 'devices' | 'scenes') => void;
  savedCompositions: CompositionTemplate[];
  toolsetSwitchAvailable?: boolean;
  isDeveloperToolset?: boolean;
  onSetToolset?: (toolset: 'developer' | 'user') => void;
  onExplorePro: () => void;
  onFeedback: () => void;
  onShowOnboarding?: () => void;
  onShowStudioTour?: () => void;
  onMergeCloudProjects: (entries: RecentProjectEntry[]) => void;
  deviceUnlocked: (deviceId: string) => boolean;
}) {
  const [section, setSection] = useState<DashSection>('projects');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('edited');
  const [sortOpen, setSortOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState<DeviceCategoryFilter>('all');
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('devices');
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const desktop = isDesktopApp();

  useEffect(() => {
    if (!sortOpen && !menuId) return;
    const close = () => {
      setSortOpen(false);
      setMenuId(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [sortOpen, menuId]);

  useEffect(() => {
    if (!syncMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!syncMenuRef.current?.contains(event.target as Node)) setSyncMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [syncMenuOpen]);

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cloudNames = new Set(cloudProjects.map((entry) => entry.name.trim().toLowerCase()));
    const synced: ListedProject[] = cloud?.configured
      ? cloudProjects.map((entry) => ({
        key: entry.path,
        name: entry.name,
        updatedAt: entry.updatedAt,
        deviceId: entry.deviceId,
        project: entry.project,
        preview: entry.preview,
        filePath: entry.path,
      }))
      : [];
    const local: ListedProject[] = recentProjects
      .filter((entry) => !cloud?.configured || !cloudNames.has(entry.name.trim().toLowerCase()))
      .map((entry) => ({
        key: entry.id,
        name: entry.name,
        updatedAt: entry.updatedAt,
        deviceId: entry.deviceId,
        project: entry.project,
        preview: entry.preview,
        recent: entry,
      }));
    return [...synced, ...local]
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
      .sort((a, b) => (
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : b.updatedAt - a.updatedAt
      ));
  }, [recentProjects, cloudProjects, cloud?.configured, query, sort]);

  const visibleDevices = useMemo(
    () => filterDevicesByCategory(devices, deviceFilter),
    [devices, deviceFilter],
  );
  const visibleTemplates = templateCategory === 'saved'
    ? savedCompositions
    : templatesByCategory(templateCategory);

  const heading = section === 'projects'
    ? { kicker: 'Workspace', title: 'Your projects', sub: 'Open a project or create something new.' }
    : section === 'models'
      ? { kicker: 'Library', title: '3D models', sub: 'Pick a device and start a scene with it.' }
      : section === 'templates'
        ? {
          kicker: 'Library',
          title: toolsetSwitchAvailable
            ? (isDeveloperToolset ? 'Templates · Dev' : 'Templates · User')
            : 'Templates',
          sub: toolsetSwitchAvailable
            ? 'Home library — add, rename, duplicate, or delete Device layouts & Compositions from the cards.'
            : 'Start from a device layout, a pre-built scene, or a template you saved.',
        }
        : section === 'assets'
          ? { kicker: 'Library', title: 'My assets', sub: 'Screenshots saved from recent scenes.' }
          : { kicker: 'Workspace', title: 'Settings', sub: 'Theme, license, project files, and feedback.' };

  return (
    <div className={`projects-dash ${desktop ? 'is-desktop' : ''}`}>
      <header className="dash-header">
        <div className="dash-brand">
          <img className="dash-logo" src="./splash/logo.png" alt="" width={28} height={28} />
          <strong>mokstudio</strong>
          <span className="dash-beta-badge" aria-label="Beta">Beta</span>
        </div>
        <span className="dash-header-rule" aria-hidden />
        <span className="dash-header-label">Your workspace</span>
        <div className="dash-header-actions">
          {toolsetSwitchAvailable && onSetToolset && (
            <div
              className={`workspace-view-toggle dash-header-view-toggle${isDeveloperToolset ? ' is-dev' : ' is-user'}`}
              role="group"
              aria-label="Workspace view"
            >
              <button
                type="button"
                className={isDeveloperToolset ? 'is-active' : ''}
                aria-pressed={Boolean(isDeveloperToolset)}
                title="Dev view — templates & compositions open in edit mode"
                onClick={() => {
                  onSetToolset('developer');
                  setSection('templates');
                  setTemplateCategory('scenes');
                }}
              >
                <Wrench size={12} strokeWidth={2.2} aria-hidden />
                Dev
              </button>
              <button
                type="button"
                className={!isDeveloperToolset ? 'is-active' : ''}
                aria-pressed={!isDeveloperToolset}
                title="User view — browse the customer template library"
                onClick={() => onSetToolset('user')}
              >
                <UserRound size={12} strokeWidth={2.2} aria-hidden />
                User view
              </button>
            </div>
          )}
          <div className="sync-menu-wrap dash-sync-menu" ref={syncMenuRef}>
            <button
              type="button"
              className={`sync-status ${cloud?.configured && !cloud.missing ? 'is-on' : ''}`}
              aria-expanded={syncMenuOpen}
              aria-haspopup="dialog"
              title={cloud?.configured
                ? `Saving to ${cloud.folderLabel || cloud.label}`
                : 'Save to iCloud Drive or Google Drive'}
              onClick={() => setSyncMenuOpen((open) => !open)}
            >
              {syncButtonLabel(cloud)}
            </button>
            {syncMenuOpen && (
              <CloudSyncPanel
                cloud={cloud}
                busy={cloudBusy}
                variant="menu"
                onUse={(target) => {
                  onCloudUse(target);
                  setSyncMenuOpen(false);
                }}
                onStop={() => {
                  onCloudStop();
                  setSyncMenuOpen(false);
                }}
              />
            )}
          </div>
        </div>
      </header>

      <div className="dash-body">
        <nav className="dash-nav" aria-label="Workspace">
          <div className="dash-nav-list" role="tablist">
            {NAV.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`dash-nav-item ${active ? 'is-active' : ''}`}
                  onClick={() => setSection(item.id)}
                >
                  <img src={item.icon} alt="" width={19} height={19} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="dash-upgrade">
            <img src={iconCubeAccent} alt="" width={22} height={22} />
            <strong>Your creative studio</strong>
            <p>All your scenes in one place</p>
            <button type="button" className="dash-upgrade-action" onClick={onExplorePro}>
              Explore Pro
            </button>
          </div>
        </nav>

        <main className="dash-main">
          <p className="dash-kicker">{heading.kicker}</p>
          <div className="dash-title-row">
            <h1>{heading.title}</h1>
            {section === 'templates' && toolsetSwitchAvailable && onSetToolset && (
              <div
                className={`workspace-view-toggle dash-template-view-toggle${isDeveloperToolset ? ' is-dev' : ' is-user'}`}
                role="group"
                aria-label="Templates and compositions view"
              >
                <button
                  type="button"
                  className={isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={Boolean(isDeveloperToolset)}
                  title="Dev view — edit Device layouts & Pre-compositions"
                  onClick={() => onSetToolset('developer')}
                >
                  <Wrench size={12} strokeWidth={2.2} aria-hidden />
                  Dev
                </button>
                <button
                  type="button"
                  className={!isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={!isDeveloperToolset}
                  title="User view — browse as customers see them"
                  onClick={() => onSetToolset('user')}
                >
                  <UserRound size={12} strokeWidth={2.2} aria-hidden />
                  User view
                </button>
              </div>
            )}
            {section === 'projects' && (
              <div className="dash-tools">
                <label className="dash-search">
                  <img src={iconSearch} alt="" width={19} height={19} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search projects"
                    aria-label="Search projects"
                  />
                </label>
                <div
                  className="dash-sort-wrap"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="dash-sort"
                    aria-haspopup="listbox"
                    aria-expanded={sortOpen}
                    onClick={() => setSortOpen((open) => !open)}
                  >
                    {sort === 'edited' ? 'Last edited' : 'Name'}
                    <img src={iconDown} alt="" width={17} height={17} />
                  </button>
                  {sortOpen && (
                    <div className="dash-pop" role="listbox" aria-label="Sort projects">
                      <button type="button" role="option" aria-selected={sort === 'edited'} onClick={() => { setSort('edited'); setSortOpen(false); }}>
                        Last edited
                      </button>
                      <button type="button" role="option" aria-selected={sort === 'name'} onClick={() => { setSort('name'); setSortOpen(false); }}>
                        Name
                      </button>
                    </div>
                  )}
                </div>
                <button type="button" className="dash-new" onClick={onBlankFile ?? onNewProject} title="Blank file">
                  <img src={iconPlus} alt="" width={20} height={20} />
                  Blank file
                </button>
                <button type="button" className="dash-new" onClick={onNewProject} title="New from template">
                  <img src={iconLayers} alt="" width={18} height={18} />
                  Template
                </button>
              </div>
            )}
          </div>
          <p className="dash-sub">{heading.sub}</p>
          <div className="dash-divider" />

          {section === 'projects' && (
            <>
              <div className="dash-section-row">
                <h2>{cloud?.configured ? 'Synced projects' : 'Recent projects'}</h2>
                <span>{projects.length === 1 ? '1 project' : `${projects.length} projects`}</span>
              </div>
              <div className="dash-grid">
                <button type="button" className="dash-card dash-card-create" onClick={onNewProject}>
                  <span className="dash-card-art">
                    <img src={newProjectArt} alt="" width={381} height={180} />
                  </span>
                  <span className="dash-card-copy">
                    <strong>New from template</strong>
                    <span>Start with a device layout or pre-composition</span>
                    <img className="dash-card-chevron" src={iconChevron} alt="" width={21} height={21} />
                  </span>
                </button>

                {projects.map((entry) => {
                  const openEntry = () => {
                    if (entry.filePath) onOpenCloudProject(entry.filePath);
                    else if (entry.recent) onOpenProject(entry.recent);
                  };
                  return (
                    <article
                      key={entry.key}
                      className={`dash-card${menuId === entry.key ? ' is-menu-open' : ''}`}
                    >
                      <button
                        type="button"
                        className="dash-card-open"
                        onClick={openEntry}
                        title={`Open ${entry.name}`}
                      >
                        <span className="dash-card-thumb">
                          {entry.project ? (
                            <ProjectThumb
                              project={entry.project}
                              cacheKey={`${entry.key}:${entry.updatedAt}`}
                            />
                          ) : entry.preview ? (
                            <img className="dash-cloud-preview" src={entry.preview} alt="" />
                          ) : null}
                        </span>
                        <span className="dash-card-copy">
                          <strong>{entry.name}</strong>
                          <span>{projectMeta(entry)}</span>
                        </span>
                      </button>
                      <div
                        className="dash-card-menu"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="dash-card-more"
                          aria-label={`Actions for ${entry.name}`}
                          aria-expanded={menuId === entry.key}
                          onClick={() => setMenuId((current) => (current === entry.key ? null : entry.key))}
                        >
                          <img src={iconDots} alt="" width={19} height={19} />
                        </button>
                        {menuId === entry.key && (
                          <div className="dash-pop dash-pop-card">
                            <button type="button" onClick={() => { setMenuId(null); openEntry(); }}>Open</button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuId(null);
                                if (entry.filePath) onRemoveCloudProject(entry.filePath);
                                else if (entry.recent) onRemoveProject(entry.recent.id);
                              }}
                            >
                              {entry.filePath ? `Remove from ${cloud?.label || 'sync'}` : 'Remove from recent'}
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {query.trim() && projects.length === 0 && (
                <p className="dash-empty">No projects match “{query.trim()}”.</p>
              )}
            </>
          )}

          {section === 'models' && (
            <>
              <div className="dash-chips" role="tablist" aria-label="Device category">
                {DEVICE_CATEGORY_TABS.map((tab) => {
                  const Icon = DEVICE_CATEGORY_LUCIDE[DEVICE_CATEGORY_ICON[tab.id]];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={deviceFilter === tab.id}
                      className={deviceFilter === tab.id ? 'is-active' : ''}
                      onClick={() => setDeviceFilter(tab.id)}
                    >
                      <Icon size={15} strokeWidth={1.8} aria-hidden />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <div className="dash-grid dash-grid-models">
                {visibleDevices.map((device) => {
                  const unlocked = deviceUnlocked(device.id);
                  const proFeature = !isFreeDevice(device.id);
                  return (
                    <button
                      key={device.id}
                      type="button"
                      className={`dash-card dash-model-card ${unlocked ? '' : 'is-locked'} ${proFeature ? 'is-pro-feature' : ''}`}
                      onClick={() => onStartDevice(device.id)}
                      title={unlocked ? `Start with ${device.label}` : `${device.label} is a Pro model`}
                    >
                      {!unlocked ? <span className="pro-feature-tag" aria-label="Locked">Locked</span> : null}
                      <span className="dash-card-thumb dash-model-thumb">
                        <DeviceModelThumb deviceId={device.id} />
                      </span>
                      <span className="dash-card-copy">
                        <strong>{device.label}</strong>
                        <span>{device.subtitle}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {section === 'templates' && (
            <>
              <div className="dash-templates-toolbar">
                <div className="dash-chips" role="tablist" aria-label="Template type">
                  <button type="button" role="tab" aria-selected={templateCategory === 'devices'} className={templateCategory === 'devices' ? 'is-active' : ''} onClick={() => setTemplateCategory('devices')}>
                    Device layouts
                  </button>
                  <button type="button" role="tab" aria-selected={templateCategory === 'scenes'} className={templateCategory === 'scenes' ? 'is-active' : ''} onClick={() => setTemplateCategory('scenes')}>
                    {toolsetSwitchAvailable ? 'Compositions' : 'Pre-compositions'}
                  </button>
                  <button type="button" role="tab" aria-selected={templateCategory === 'saved'} className={templateCategory === 'saved' ? 'is-active' : ''} onClick={() => setTemplateCategory('saved')}>
                    Your templates
                  </button>
                </div>
                {toolsetSwitchAvailable && templateCategory !== 'saved' && onAddShippedTemplate && (
                  <button
                    type="button"
                    className="dash-new dash-template-add"
                    onClick={() => {
                      if (!isDeveloperToolset) onSetToolset?.('developer');
                      onAddShippedTemplate(templateCategory === 'scenes' ? 'scenes' : 'devices');
                    }}
                  >
                    <img src={iconPlus} alt="" width={20} height={20} />
                    {templateCategory === 'scenes' ? 'New composition' : 'New layout'}
                  </button>
                )}
              </div>
              {templateCategory === 'saved' && visibleTemplates.length === 0 ? (
                <p className="dash-empty">Save as template from the File menu or Transform while a project is open. With sync on, templates also live in your iCloud or Drive folder.</p>
              ) : (
              <div className="dash-grid">
                {toolsetSwitchAvailable && templateCategory !== 'saved' && onAddShippedTemplate && (
                  <button
                    type="button"
                    className="dash-template-create"
                    title={templateCategory === 'scenes' ? 'New composition' : 'New layout'}
                    aria-label={templateCategory === 'scenes' ? 'New composition' : 'New layout'}
                    onClick={() => {
                      if (!isDeveloperToolset) onSetToolset?.('developer');
                      onAddShippedTemplate(templateCategory === 'scenes' ? 'scenes' : 'devices');
                    }}
                  >
                    <img src={iconPlus} alt="" width={28} height={28} />
                    <strong>
                      {templateCategory === 'scenes' ? 'New composition' : 'New layout'}
                    </strong>
                  </button>
                )}
                {visibleTemplates.map((template) => {
                  const menuKey = `template:${template.id}`;
                  const canManageShipped = Boolean(toolsetSwitchAvailable) && templateCategory !== 'saved';
                  const canDelete = templateCategory === 'saved' || canManageShipped;
                  const canRename = templateCategory === 'saved' || canManageShipped;
                  return (
                    <article
                      key={template.id}
                      className={`dash-card dash-template-card${canManageShipped ? ' is-dev-editable' : ''}${menuId === menuKey ? ' is-menu-open' : ''}`}
                    >
                      <button type="button" className="dash-card-open" onClick={() => onStartTemplate(template)}>
                        <span className="dash-card-thumb dash-template-thumb">
                          <TemplateThumb template={template} />
                        </span>
                        <span className="dash-card-copy">
                          <strong>{template.label}</strong>
                          <span>
                            {canManageShipped
                              ? 'Home library · ⋯ to rename, duplicate, or delete'
                              : template.description}
                          </span>
                        </span>
                      </button>
                      <div
                        className="dash-card-menu"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="dash-card-more"
                          aria-label={`Actions for ${template.label}`}
                          aria-expanded={menuId === menuKey}
                          onClick={() => setMenuId((current) => (current === menuKey ? null : menuKey))}
                        >
                          <img src={iconDots} alt="" width={19} height={19} />
                        </button>
                        {menuId === menuKey && (
                          <div className="dash-pop dash-pop-card">
                            <button
                              type="button"
                              onClick={() => {
                                setMenuId(null);
                                if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                onStartTemplate(template);
                              }}
                            >
                              {canManageShipped ? 'Edit' : 'Open'}
                            </button>
                            {canRename && onRenameTemplate && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuId(null);
                                  if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                  onRenameTemplate(template);
                                }}
                              >
                                Rename
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMenuId(null);
                                if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                onDuplicateTemplate(template);
                              }}
                            >
                              {templateCategory === 'saved' || canManageShipped
                                ? 'Duplicate'
                                : 'Duplicate to Yours'}
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                className="is-danger"
                                onClick={() => {
                                  setMenuId(null);
                                  if (templateCategory === 'saved') onDeleteSavedTemplate(template.id);
                                  else {
                                    if (!isDeveloperToolset) onSetToolset?.('developer');
                                    onDeleteShippedTemplate?.(template);
                                  }
                                }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              )}
            </>
          )}

          {section === 'assets' && (
            recentScreenshots.length === 0 ? (
              <p className="dash-empty">Screenshots you drop into a scene show up here.</p>
            ) : (
              <div className="dash-grid">
                {recentScreenshots.map((shot) => (
                  <article key={shot.id} className="dash-card dash-asset-card">
                    <span className="dash-card-thumb">
                      <img src={shot.dataUrl} alt="" />
                    </span>
                    <span className="dash-card-copy">
                      <strong>{shot.name}</strong>
                      <span>{editedPhrase(shot.addedAt)}</span>
                    </span>
                  </article>
                ))}
              </div>
            )
          )}

          {section === 'settings' && (
            <div className="dash-settings">
              <div className="dash-setting">
                <AccentThemePicker />
              </div>
              <CloudAccountPanel
                recentProjects={recentProjects}
                onMergeCloudProjects={onMergeCloudProjects}
              />
              <CloudSyncPanel
                cloud={cloud}
                busy={cloudBusy}
                variant="settings"
                onUse={onCloudUse}
                onStop={onCloudStop}
              />
              <div className="dash-setting">
                <strong>Plan</strong>
                <span>{licensingDisabled ? 'Pro Max (this build)' : planLabel(license.tier)}</span>
              </div>
              <button type="button" className="dash-setting" onClick={onOpenFile}>
                <strong>Open a project file</strong>
                <span>Load a template you saved earlier</span>
              </button>
              <button type="button" className="dash-setting" onClick={onExplorePro}>
                <strong>Explore Pro</strong>
                <span>Devices, video export, and higher resolutions</span>
              </button>
              <button type="button" className="dash-setting" onClick={onFeedback}>
                <strong>Send feedback</strong>
                <span>Tell us what the studio should do next</span>
              </button>
              {onShowOnboarding && (
                <button type="button" className="dash-setting" onClick={onShowOnboarding}>
                  <strong>Replay onboarding</strong>
                  <span>Intro screens, then the in-app tool walkthrough</span>
                </button>
              )}
              {onShowStudioTour && (
                <button type="button" className="dash-setting" onClick={onShowStudioTour}>
                  <strong>Replay tool walkthrough</strong>
                  <span>Highlight each workspace section again</span>
                </button>
              )}

              <div className="dash-setting dash-legal" id="settings-about">
                <strong>About</strong>
                <span>{APP_ABOUT_SUMMARY}</span>
                <span className="dash-legal-meta">mokstudio · 0.1.0</span>
              </div>

              <div className="dash-setting dash-legal" id="settings-legal">
                <strong>Legal</strong>
                <span>{NON_AFFILIATION_DISCLAIMER}</span>
                <span>{EXPORT_USAGE_NOTICE}</span>
                <span>{MODEL_LICENSING_NOTICE}</span>
                <div className="dash-legal-links">
                  {([
                    ['Terms', '/terms'],
                    ['Privacy', '/privacy'],
                    ['Credits', '/credits'],
                  ] as const).map(([label, path]) => (
                    <button
                      key={path}
                      type="button"
                      className="dash-legal-link"
                      onClick={() => {
                        const url = `${getCheckoutConfig().siteUrl}${path}`;
                        void (async () => {
                          try {
                            if (window.mockupDesktop?.openExternal) {
                              await window.mockupDesktop.openExternal(url);
                              return;
                            }
                          } catch {
                            /* fall through */
                          }
                          window.open(url, '_blank', 'noopener,noreferrer');
                        })();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <p className="dash-footer">
            {cloud?.configured && !cloud.missing
              ? `Saving to ${cloud.folderLabel} automatically`
              : 'All changes saved automatically'}
          </p>
        </main>
      </div>
    </div>
  );
}
