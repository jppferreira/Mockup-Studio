import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Copy, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import {
  PUBLISH_CATEGORY_LABELS,
  PUBLISH_TEMPLATE_CATEGORIES,
  deletePublishedTemplate,
  duplicatePublishedTemplate,
  listPublishedTemplates,
  loadTemplateWithScene,
  setTemplateStatus,
  toCompositionTemplate,
  type PublishTemplateCategory,
  type PublishedTemplateRecord,
  type TemplatePublishStatus,
} from '../lib/publishedTemplates';
import type { CompositionTemplate } from '../lib/templates';

interface Props {
  active: boolean;
  onNotify: (message: string) => void;
  onEditInStudio: (template: CompositionTemplate, published: PublishedTemplateRecord) => void;
  onRepublish: (published: PublishedTemplateRecord) => void;
}

export default function AdminPublishedTemplatesPanel({
  active,
  onNotify,
  onEditInStudio,
  onRepublish,
}: Props) {
  const [items, setItems] = useState<PublishedTemplateRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TemplatePublishStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<PublishTemplateCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listPublishedTemplates({
        includeAdmin: true,
        force: true,
        status: statusFilter,
        category: categoryFilter,
        search,
      });
      if (!result.ok) {
        onNotify(result.error || 'Could not load published templates');
        setItems([]);
        return;
      }
      setItems(result.templates);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, search, onNotify]);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  const counts = useMemo(() => {
    const all = { draft: 0, published: 0, archived: 0 };
    for (const item of items) {
      all[item.status] += 1;
    }
    return all;
  }, [items]);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try {
      await action();
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (!active) return null;

  return (
    <section className="dash-template-block admin-published-panel" aria-labelledby="admin-published-heading">
      <div className="dash-template-block-head">
        <h2 id="admin-published-heading">Admin · Published library</h2>
        <button type="button" className="dash-new dash-template-add" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : null}
          Refresh
        </button>
      </div>
      <p className="admin-published-copy">
        Draft, publish, archive, and version global templates. Customers only see published rows;
        opening a template always creates their own editable copy.
      </p>

      <div className="admin-published-filters">
        <input
          className="text-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or tag"
          aria-label="Search templates"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TemplatePublishStatus | 'all')}
          aria-label="Filter by status"
        >
          <option value="all">All statuses ({items.length})</option>
          <option value="draft">Draft ({counts.draft})</option>
          <option value="published">Published ({counts.published})</option>
          <option value="archived">Archived ({counts.archived})</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as PublishTemplateCategory | 'all')}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {PUBLISH_TEMPLATE_CATEGORIES.map((id) => (
            <option key={id} value={id}>{PUBLISH_CATEGORY_LABELS[id]}</option>
          ))}
        </select>
      </div>

      {loading && items.length === 0 ? (
        <p className="dash-empty">Loading templates…</p>
      ) : items.length === 0 ? (
        <p className="dash-empty">No templates yet. Open a scene and use Publish as Template.</p>
      ) : (
        <div className="admin-published-list" role="list">
          {items.map((item) => {
            const busy = busyId === item.id;
            return (
              <article key={item.id} className="admin-published-row" role="listitem">
                <div className={`admin-published-thumb${item.thumbnailUrl ? '' : ' is-empty'}`}>
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" />
                  ) : (
                    <span>No preview</span>
                  )}
                </div>
                <div className="admin-published-meta">
                  <strong>{item.title}</strong>
                  <span>
                    {PUBLISH_CATEGORY_LABELS[item.category]}
                    {' · '}
                    {item.accessTier === 'pro' ? 'Pro' : 'Free'}
                    {' · '}
                    <em className={`admin-status is-${item.status}`}>{item.status}</em>
                  </span>
                  {item.description ? <p>{item.description}</p> : null}
                </div>
                <div className="admin-published-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void run(item.id, async () => {
                      const loaded = await loadTemplateWithScene(item.id);
                      if (!loaded.ok || !loaded.template) {
                        onNotify(loaded.error || 'Could not open template');
                        return;
                      }
                      onEditInStudio(toCompositionTemplate(loaded.template), loaded.template);
                    })}
                  >
                    Edit in studio
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => onRepublish(item)}
                  >
                    Republish…
                  </button>
                  {item.status !== 'published' && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => void run(item.id, async () => {
                        const result = await setTemplateStatus(item.id, 'published');
                        onNotify(result.ok ? `Published “${item.title}”` : (result.error || 'Publish failed'));
                      })}
                    >
                      Publish
                    </button>
                  )}
                  {item.status === 'published' && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => void run(item.id, async () => {
                        const result = await setTemplateStatus(item.id, 'archived');
                        onNotify(result.ok ? `Archived “${item.title}”` : (result.error || 'Archive failed'));
                      })}
                    >
                      <Archive size={13} /> Archive
                    </button>
                  )}
                  {item.status === 'archived' && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => void run(item.id, async () => {
                        const result = await setTemplateStatus(item.id, 'draft');
                        onNotify(result.ok ? `Restored “${item.title}” as draft` : (result.error || 'Restore failed'));
                      })}
                    >
                      <RotateCcw size={13} /> Restore
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void run(item.id, async () => {
                      const result = await duplicatePublishedTemplate(item.id);
                      onNotify(result.ok
                        ? `Duplicated as “${result.template?.title}”`
                        : (result.error || 'Duplicate failed'));
                    })}
                  >
                    <Copy size={13} /> Duplicate
                  </button>
                  {confirmDeleteId === item.id ? (
                    <>
                      <button
                        type="button"
                        className="text-button is-danger"
                        disabled={busy}
                        onClick={() => void run(item.id, async () => {
                          const result = await deletePublishedTemplate(item.id);
                          setConfirmDeleteId(null);
                          onNotify(result.ok ? `Deleted “${item.title}”` : (result.error || 'Delete failed'));
                        })}
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="text-button is-danger"
                      disabled={busy}
                      onClick={() => setConfirmDeleteId(item.id)}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
