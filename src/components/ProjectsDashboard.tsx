import { useEffect, useMemo, useState } from 'react';
import { hasAnimation } from '../lib/animation';
import {
  DEVICE_CATEGORY_TABS,
  categoryOfDevice,
  filterDevicesByCategory,
  type DeviceCategoryFilter,
  type DeviceModel,
} from '../lib/devices';
import { isDesktopApp } from '../lib/phoneMirror';
import type { RecentProjectEntry } from '../lib/recentProjects';
import type { RecentScreenshot } from '../lib/recentScreenshots';
import {
  templatesByCategory,
  type CompositionTemplate,
  type TemplateCategory,
} from '../lib/templates';
import type { LicenseState } from '../lib/license';
import { planLabel } from '../lib/license';
import TemplatePreview from './TemplatePreview';
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

const THUMB_GRADIENT: Record<string, string> = {
  phones: 'linear-gradient(90deg, #e0cbe8, #baa9cf)',
  tablets: 'linear-gradient(90deg, #c5d0e4, #8ea0bf)',
  laptops: 'linear-gradient(90deg, #f3c5d6, #d489aa)',
  watches: 'linear-gradient(90deg, #b1d2cb, #7ca69d)',
  headphones: 'linear-gradient(90deg, #d8c7f0, #9a84c6)',
  spatial: 'linear-gradient(90deg, #c9c6ef, #7e79b8)',
};

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

function projectMeta(entry: RecentProjectEntry) {
  const edited = editedPhrase(entry.updatedAt);
  const clip = entry.project.animation;
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
  onOpenProject,
  onRemoveProject,
  onNewProject,
  onOpenFile,
  onStartTemplate,
  onStartDevice,
  onExplorePro,
  onFeedback,
  deviceUnlocked,
}: {
  recentProjects: RecentProjectEntry[];
  recentScreenshots: RecentScreenshot[];
  devices: DeviceModel[];
  license: LicenseState;
  licensingDisabled: boolean;
  onOpenProject: (entry: RecentProjectEntry) => void;
  onRemoveProject: (id: string) => void;
  onNewProject: () => void;
  onOpenFile: () => void;
  onStartTemplate: (template: CompositionTemplate) => void;
  onStartDevice: (deviceId: string) => void;
  onExplorePro: () => void;
  onFeedback: () => void;
  deviceUnlocked: (deviceId: string) => boolean;
}) {
  const [section, setSection] = useState<DashSection>('projects');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('edited');
  const [sortOpen, setSortOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceCategoryFilter>('all');
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('devices');
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

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = recentProjects.filter((entry) => (
      !needle || entry.name.toLowerCase().includes(needle)
    ));
    return [...filtered].sort((a, b) => (
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : b.updatedAt - a.updatedAt
    ));
  }, [recentProjects, query, sort]);

  const visibleDevices = useMemo(
    () => filterDevicesByCategory(devices, deviceFilter),
    [devices, deviceFilter],
  );
  const visibleTemplates = templatesByCategory(templateCategory);

  const heading = section === 'projects'
    ? { kicker: 'Workspace', title: 'Your projects', sub: 'Open a project or create something new.' }
    : section === 'models'
      ? { kicker: 'Library', title: '3D models', sub: 'Pick a device and start a scene with it.' }
      : section === 'templates'
        ? { kicker: 'Library', title: 'Templates', sub: 'Start from a device layout or a pre-built scene.' }
        : section === 'assets'
          ? { kicker: 'Library', title: 'My assets', sub: 'Screenshots saved from recent scenes.' }
          : { kicker: 'Workspace', title: 'Settings', sub: 'License, project files, and feedback.' };

  return (
    <div className={`projects-dash ${desktop ? 'is-desktop' : ''}`}>
      <header className="dash-header">
        <div className="dash-brand">
          <span className="dash-logo" aria-hidden>
            <i />
            <i />
          </span>
          <strong>MOKERO</strong>
        </div>
        <span className="dash-header-rule" aria-hidden />
        <span className="dash-header-label">Your workspace</span>
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
                <button type="button" className="dash-new" onClick={onNewProject}>
                  <img src={iconPlus} alt="" width={20} height={20} />
                  New project
                </button>
              </div>
            )}
          </div>
          <p className="dash-sub">{heading.sub}</p>
          <div className="dash-divider" />

          {section === 'projects' && (
            <>
              <div className="dash-section-row">
                <h2>Recent projects</h2>
                <span>{projects.length === 1 ? '1 project' : `${projects.length} projects`}</span>
              </div>
              <div className="dash-grid">
                <button type="button" className="dash-card dash-card-create" onClick={onNewProject}>
                  <span className="dash-card-art">
                    <img src={newProjectArt} alt="" width={381} height={180} />
                  </span>
                  <span className="dash-card-copy">
                    <strong>New project</strong>
                    <span>Start with a device or a blank scene</span>
                    <img className="dash-card-chevron" src={iconChevron} alt="" width={21} height={21} />
                  </span>
                </button>

                {projects.map((entry) => {
                  const category = categoryOfDevice({ id: entry.deviceId });
                  return (
                    <article key={entry.id} className="dash-card">
                      <button
                        type="button"
                        className="dash-card-open"
                        onClick={() => onOpenProject(entry)}
                        title={`Open ${entry.name}`}
                      >
                        <span
                          className="dash-card-thumb"
                          style={{ background: THUMB_GRADIENT[category] ?? THUMB_GRADIENT.phones }}
                        >
                          {entry.preview ? <img src={entry.preview} alt="" /> : <span className="dash-device-glyph" />}
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
                          aria-expanded={menuId === entry.id}
                          onClick={() => setMenuId((current) => (current === entry.id ? null : entry.id))}
                        >
                          <img src={iconDots} alt="" width={19} height={19} />
                        </button>
                        {menuId === entry.id && (
                          <div className="dash-pop dash-pop-card">
                            <button type="button" onClick={() => { setMenuId(null); onOpenProject(entry); }}>Open</button>
                            <button type="button" onClick={() => { setMenuId(null); onRemoveProject(entry.id); }}>Remove from recent</button>
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
                {DEVICE_CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={deviceFilter === tab.id}
                    className={deviceFilter === tab.id ? 'is-active' : ''}
                    onClick={() => setDeviceFilter(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="dash-grid dash-grid-models">
                {visibleDevices.map((device) => {
                  const unlocked = deviceUnlocked(device.id);
                  const category = categoryOfDevice(device);
                  return (
                    <button
                      key={device.id}
                      type="button"
                      className="dash-card dash-model-card"
                      onClick={() => onStartDevice(device.id)}
                      title={unlocked ? `Start with ${device.label}` : `${device.label} is a Pro model`}
                    >
                      <span
                        className="dash-card-thumb"
                        style={{ background: THUMB_GRADIENT[category] ?? THUMB_GRADIENT.phones }}
                      >
                        <span className={`dash-device-glyph kind-${category}`} />
                      </span>
                      <span className="dash-card-copy">
                        <strong>{device.label}</strong>
                        <span>{unlocked ? device.subtitle : 'Pro model'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {section === 'templates' && (
            <>
              <div className="dash-chips" role="tablist" aria-label="Template type">
                <button type="button" role="tab" aria-selected={templateCategory === 'devices'} className={templateCategory === 'devices' ? 'is-active' : ''} onClick={() => setTemplateCategory('devices')}>
                  Device layouts
                </button>
                <button type="button" role="tab" aria-selected={templateCategory === 'scenes'} className={templateCategory === 'scenes' ? 'is-active' : ''} onClick={() => setTemplateCategory('scenes')}>
                  Pre-compositions
                </button>
              </div>
              <div className="dash-grid">
                {visibleTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="dash-card dash-template-card"
                    onClick={() => onStartTemplate(template)}
                  >
                    <span className="dash-card-thumb dash-template-thumb">
                      <TemplatePreview layout={template.preview} />
                    </span>
                    <span className="dash-card-copy">
                      <strong>{template.label}</strong>
                      <span>{template.description}</span>
                    </span>
                  </button>
                ))}
              </div>
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
                <strong>Plan</strong>
                <span>{licensingDisabled ? 'Pro Max (this build)' : planLabel(license.tier)}</span>
              </div>
              <button type="button" className="dash-setting" onClick={onOpenFile}>
                <strong>Open a project file</strong>
                <span>Load a composition you saved earlier</span>
              </button>
              <button type="button" className="dash-setting" onClick={onExplorePro}>
                <strong>Explore Pro</strong>
                <span>Devices, video export, and higher resolutions</span>
              </button>
              <button type="button" className="dash-setting" onClick={onFeedback}>
                <strong>Send feedback</strong>
                <span>Tell us what the studio should do next</span>
              </button>
            </div>
          )}

          <p className="dash-footer">All changes saved automatically</p>
        </main>
      </div>
    </div>
  );
}
