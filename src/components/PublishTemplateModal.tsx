import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, LayoutTemplate, Loader2, X } from 'lucide-react';
import {
  PUBLISH_CATEGORY_LABELS,
  PUBLISH_TEMPLATE_CATEGORIES,
  inferPublishCategory,
  parseTagInput,
  type PublishTemplateCategory,
  type PublishedTemplateRecord,
  type TemplateAccessTier,
  type TemplatePublishStatus,
} from '../lib/publishedTemplates';
import type { MockupProject } from '../types';

export interface PublishTemplateFormValues {
  templateId: string | null;
  title: string;
  description: string;
  category: PublishTemplateCategory;
  tags: string[];
  accessTier: TemplateAccessTier;
  status: Exclude<TemplatePublishStatus, 'archived'>;
  thumbnailDataUrl: string | null;
  keepThumbnail: boolean;
}

interface Props {
  open: boolean;
  project: MockupProject;
  editing?: PublishedTemplateRecord | null;
  busy?: boolean;
  error?: string | null;
  /** Capture current camera framing; return data URL. */
  onCapturePreview: () => Promise<string | null>;
  onClose: () => void;
  onSubmit: (values: PublishTemplateFormValues) => void | Promise<void>;
}

export default function PublishTemplateModal({
  open,
  project,
  editing = null,
  busy = false,
  error = null,
  onCapturePreview,
  onClose,
  onSubmit,
}: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<PublishTemplateCategory>('single-device');
  const [tagsRaw, setTagsRaw] = useState('');
  const [accessTier, setAccessTier] = useState<TemplateAccessTier>('free');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [existingThumbUrl, setExistingThumbUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const deviceCount = project.devices.length;
  const previewSrc = thumbnailDataUrl || existingThumbUrl;

  const defaults = useMemo(() => ({
    title: editing?.title || project.name || 'Untitled template',
    description: editing?.description || '',
    category: editing?.category || inferPublishCategory(project),
    tags: editing?.tags?.join(', ') || '',
    accessTier: editing?.accessTier || 'free' as TemplateAccessTier,
    status: (editing?.status === 'published' ? 'published' : 'draft') as 'draft' | 'published',
    thumb: editing?.thumbnailUrl || null,
  }), [editing, project]);

  useEffect(() => {
    if (!open) return;
    setTitle(defaults.title);
    setDescription(defaults.description);
    setCategory(defaults.category);
    setTagsRaw(defaults.tags);
    setAccessTier(defaults.accessTier);
    setStatus(defaults.status);
    setThumbnailDataUrl(null);
    setExistingThumbUrl(defaults.thumb);
    setLocalError(null);
    const t = window.setTimeout(() => nameRef.current?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, defaults, busy]);

  if (!open) return null;

  const handleCapture = async () => {
    setCapturing(true);
    setLocalError(null);
    try {
      const url = await onCapturePreview();
      if (!url) {
        setLocalError('Could not capture a preview from the canvas.');
        return;
      }
      setThumbnailDataUrl(url);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Preview capture failed.');
    } finally {
      setCapturing(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      setLocalError('Template name is required.');
      return;
    }
    if (deviceCount === 0 && status === 'published') {
      setLocalError('Add at least one device before publishing.');
      return;
    }
    setLocalError(null);
    await onSubmit({
      templateId: editing?.id ?? null,
      title: nextTitle,
      description: description.trim(),
      category,
      tags: parseTagInput(tagsRaw),
      accessTier,
      status,
      thumbnailDataUrl,
      keepThumbnail: Boolean(existingThumbUrl) && !thumbnailDataUrl,
    });
  };

  const displayError = localError || error;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="export-modal export-modal-wide publish-template-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="modal-head">
          <div className="modal-icon"><LayoutTemplate size={21} /></div>
          <button
            type="button"
            className="modal-close"
            aria-label="Close publish dialog"
            onClick={onClose}
            disabled={busy}
          >
            <X size={19} />
          </button>
        </div>

        <h2 id={titleId}>{editing ? 'Update template' : 'Publish as template'}</h2>
        <p>
          Push this scene to every signed-in user. Set status to Published to make it live;
          Draft stays admin-only. Customers always open their own editable copy.
        </p>

        <label className="modal-field-label" htmlFor="publish-template-name">
          TEMPLATE NAME
        </label>
        <input
          id="publish-template-name"
          ref={nameRef}
          className="text-input"
          value={title}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Studio hero shot"
        />

        <label className="modal-field-label" htmlFor="publish-template-description">
          DESCRIPTION
        </label>
        <textarea
          id="publish-template-description"
          className="text-input"
          rows={3}
          value={description}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short note for the template library"
        />

        <div className="modal-field-label">CATEGORY</div>
        <div className="publish-template-chips" role="group" aria-label="Template category">
          {PUBLISH_TEMPLATE_CATEGORIES.map((id) => (
            <button
              key={id}
              type="button"
              className={category === id ? 'text-button is-active' : 'text-button'}
              disabled={busy}
              onClick={() => setCategory(id)}
            >
              {PUBLISH_CATEGORY_LABELS[id]}
            </button>
          ))}
        </div>

        <label className="modal-field-label" htmlFor="publish-template-tags">
          TAGS
        </label>
        <input
          id="publish-template-tags"
          className="text-input"
          value={tagsRaw}
          disabled={busy}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="hero, phone, studio"
        />

        <div className="modal-field-label">PREVIEW IMAGE</div>
        <div className="publish-template-preview-row">
          <div className={`publish-template-preview${previewSrc ? '' : ' is-empty'}`}>
            {previewSrc ? (
              <img src={previewSrc} alt="" />
            ) : (
              <span>No preview yet</span>
            )}
          </div>
          <button
            type="button"
            className="button"
            disabled={busy || capturing || deviceCount === 0}
            onClick={() => void handleCapture()}
          >
            {capturing ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />}
            {previewSrc ? 'Regenerate preview' : 'Capture from scene'}
          </button>
        </div>

        <div className="modal-field-label">AVAILABILITY</div>
        <div className="publish-template-chips" role="group" aria-label="Access tier">
          <button
            type="button"
            className={accessTier === 'free' ? 'text-button is-active' : 'text-button'}
            disabled={busy}
            onClick={() => setAccessTier('free')}
          >
            Free
          </button>
          <button
            type="button"
            className={accessTier === 'pro' ? 'text-button is-active' : 'text-button'}
            disabled={busy}
            onClick={() => setAccessTier('pro')}
          >
            Pro
          </button>
        </div>

        <div className="modal-field-label">STATUS</div>
        <div className="publish-template-chips" role="group" aria-label="Publish status">
          <button
            type="button"
            className={status === 'draft' ? 'text-button is-active' : 'text-button'}
            disabled={busy}
            onClick={() => setStatus('draft')}
          >
            Draft
          </button>
          <button
            type="button"
            className={status === 'published' ? 'text-button is-active' : 'text-button'}
            disabled={busy}
            onClick={() => setStatus('published')}
          >
            Published
          </button>
        </div>

        {displayError && (
          <p className="publish-template-error" role="alert">{displayError}</p>
        )}

        <div className="export-modal-actions">
          <button type="button" className="button subtle-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary-button" disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {editing
              ? (status === 'published' ? 'Update & publish' : 'Save draft')
              : (status === 'published' ? 'Publish template' : 'Save draft')}
          </button>
        </div>
      </form>
    </div>
  );
}
