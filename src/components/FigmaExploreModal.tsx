import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  Box, ChevronDown, ChevronRight, Component, Eye, EyeOff, Frame, Layers3,
  LayoutTemplate, Loader2, Search, Square, Type, UnfoldVertical, X,
} from 'lucide-react';
import {
  canApplyFigmaLayer, compositeExplodeStack, explodeCandidates, exportFigmaNodeAsDataUrl,
  exportFigmaNodesAsDataUrls, fetchFigmaFile, formatFigmaSize, loadFigmaToken, parseFigmaUrl,
  saveFigmaToken,
  type FigmaFileSummary, type FigmaLayerNode, type FigmaNodeType,
} from '../lib/figma';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (dataUrl: string, layerName: string) => void;
  onNotify: (message: string) => void;
  /** Prefill the Figma URL field when opening from Assets. */
  initialUrl?: string;
}

type ExplodePlate = {
  id: string;
  name: string;
  type: FigmaNodeType;
  dataUrl: string;
};

function LayerIcon({ type }: { type: FigmaNodeType }) {
  const props = { size: 13, strokeWidth: 1.9 } as const;
  switch (type) {
    case 'CANVAS':
      return <LayoutTemplate {...props} />;
    case 'FRAME':
    case 'SECTION':
      return <Frame {...props} />;
    case 'COMPONENT':
    case 'COMPONENT_SET':
    case 'INSTANCE':
      return <Component {...props} />;
    case 'GROUP':
      return <Box {...props} />;
    case 'TEXT':
      return <Type {...props} />;
    default:
      return <Square {...props} />;
  }
}

function matchesQuery(node: FigmaLayerNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q) || node.type.toLowerCase().includes(q)) return true;
  return node.children.some((child) => matchesQuery(child, query));
}

function LayerRow({
  node,
  depth,
  selectedId,
  expanded,
  query,
  onToggle,
  onSelect,
}: {
  node: FigmaLayerNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  query: string;
  onToggle: (id: string) => void;
  onSelect: (node: FigmaLayerNode) => void;
}) {
  if (!matchesQuery(node, query)) return null;

  const hasChildren = node.children.length > 0;
  const isOpen = query ? true : expanded.has(node.id);
  const selected = selectedId === node.id;
  const applyable = canApplyFigmaLayer(node.type);
  const size = formatFigmaSize(node.width, node.height);

  return (
    <div className="figma-layer-branch">
      <button
        type="button"
        className={`figma-layer-row ${selected ? 'is-selected' : ''} ${applyable ? 'is-applyable' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node)}
        title={applyable ? 'Select to explode or use as phone screen' : node.type}
      >
        <span
          className={`figma-layer-twist ${hasChildren ? '' : 'is-empty'}`}
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            onToggle(node.id);
          }}
          aria-hidden={!hasChildren}
        >
          {hasChildren ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </span>
        <span className="figma-layer-icon"><LayerIcon type={node.type} /></span>
        <span className="figma-layer-name">{node.name}</span>
        {!node.visible && <EyeOff size={11} className="figma-layer-hidden" aria-label="Hidden" />}
        <span className="figma-layer-meta">{size ?? node.type.toLowerCase()}</span>
      </button>
      {hasChildren && isOpen && (
        <div className="figma-layer-children">
          {node.children.map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              query={query}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function findNode(nodes: FigmaLayerNode[], id: string): FigmaLayerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

function collectExpandPath(nodes: FigmaLayerNode[], targetId: string, path: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return path;
    const nested = collectExpandPath(node.children, targetId, [...path, node.id]);
    if (nested) return nested;
  }
  return null;
}

function ExplodeStage({
  plates,
  amount,
  activeId,
  onSelect,
}: {
  plates: ExplodePlate[];
  amount: number;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const count = plates.length;
  return (
    <div className="figma-explode-stage" aria-label="Exploded layers">
      <div className="figma-explode-orbit">
        {plates.map((plate, index) => {
          const t = count <= 1 ? 0 : index / (count - 1);
          const lift = t * (36 + amount * 78);
          const slide = t * (18 + amount * 42);
          const scale = 0.92 + t * 0.08;
          const style: CSSProperties = {
            transform: `translate3d(${slide}px, ${-lift}px, 0) rotateX(12deg) rotateZ(-4deg) scale(${scale})`,
            zIndex: index + 1,
          };
          return (
            <button
              key={plate.id}
              type="button"
              className={`figma-explode-plate ${activeId === plate.id ? 'is-active' : ''}`}
              style={style}
              onClick={() => onSelect(plate.id)}
              title={plate.name}
            >
              <img src={plate.dataUrl} alt="" draggable={false} />
              <span>{plate.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FigmaExploreModal({ open, onClose, onApply, onNotify, initialUrl }: Props) {
  const [urlDraft, setUrlDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState(() => loadFigmaToken());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exploding, setExploding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<FigmaFileSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'tree' | 'explode'>('tree');
  const [plates, setPlates] = useState<ExplodePlate[]>([]);
  const [explodeRootId, setExplodeRootId] = useState<string | null>(null);
  const [explodeAmount, setExplodeAmount] = useState(0.65);
  const [activePlateId, setActivePlateId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTokenDraft(loadFigmaToken());
    setError(null);
    if (initialUrl?.trim()) setUrlDraft(initialUrl.trim());
  }, [open, initialUrl]);

  const selected = useMemo(
    () => (file && selectedId ? findNode(file.layers, selectedId) : null),
    [file, selectedId],
  );

  if (!open) return null;

  const loadFile = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    const parsed = parseFigmaUrl(urlDraft);
    if (!parsed) {
      setError('Paste a Figma design URL (figma.com/design/…) or file key.');
      return;
    }
    const token = tokenDraft.trim();
    if (!token) {
      setError('Add a Figma personal access token (Account → Settings → Security).');
      return;
    }

    setLoading(true);
    try {
      saveFigmaToken(token);
      const summary = await fetchFigmaFile(parsed.fileKey, token);
      setFile(summary);
      setMode('tree');
      setPlates([]);
      setExplodeRootId(null);

      const expandIds = new Set<string>();
      if (summary.layers[0]) expandIds.add(summary.layers[0].id);

      if (parsed.nodeId) {
        const path = collectExpandPath(summary.layers, parsed.nodeId);
        path?.forEach((id) => expandIds.add(id));
        setSelectedId(parsed.nodeId);
      } else {
        setSelectedId(null);
      }
      setExpanded(expandIds);
      onNotify(`Loaded “${summary.name}”`);
    } catch (err) {
      setFile(null);
      setSelectedId(null);
      setError(err instanceof Error ? err.message : 'Could not load Figma file');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applySelected = async () => {
    if (!file || !selected) return;
    if (!canApplyFigmaLayer(selected.type)) {
      setError('Pick a frame, component, instance, or group to use as the phone screen.');
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const { dataUrl } = await exportFigmaNodeAsDataUrl(file.fileKey, selected.id, tokenDraft, 2);
      onApply(dataUrl, selected.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export layer');
    } finally {
      setExporting(false);
    }
  };

  const openExplode = async () => {
    if (!file || !selected) return;
    const candidates = explodeCandidates(selected);
    if (!candidates.length) {
      setError('That layer has no child layers to explode. Pick a frame that contains UI stacks.');
      return;
    }

    setExploding(true);
    setError(null);
    try {
      const ids = candidates.map((child) => child.id);
      const images = await exportFigmaNodesAsDataUrls(file.fileKey, ids, tokenDraft, 1.5);
      const nextPlates: ExplodePlate[] = [];
      for (const child of candidates) {
        const dataUrl = images.get(child.id);
        if (!dataUrl) continue;
        nextPlates.push({
          id: child.id,
          name: child.name,
          type: child.type,
          dataUrl,
        });
      }
      if (!nextPlates.length) {
        throw new Error('Figma could not export the child layers for explode view.');
      }
      setPlates(nextPlates);
      setExplodeRootId(selected.id);
      setActivePlateId(nextPlates[nextPlates.length - 1]?.id ?? null);
      setMode('explode');
      onNotify(`Exploded ${nextPlates.length} layers from “${selected.name}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build explode view');
    } finally {
      setExploding(false);
    }
  };

  const applyActivePlate = async () => {
    if (!file || !activePlateId) return;
    const plate = plates.find((item) => item.id === activePlateId);
    if (!plate) return;
    setExporting(true);
    setError(null);
    try {
      // Re-export at higher scale for the phone screen
      const { dataUrl } = await exportFigmaNodeAsDataUrl(file.fileKey, plate.id, tokenDraft, 2);
      onApply(dataUrl, plate.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export layer');
    } finally {
      setExporting(false);
    }
  };

  const applyExplodedComposite = async () => {
    if (!plates.length || !selected) return;
    setExporting(true);
    setError(null);
    try {
      const dataUrl = await compositeExplodeStack(
        plates.map((plate) => ({ dataUrl: plate.dataUrl, name: plate.name })),
        explodeAmount,
      );
      onApply(dataUrl, `${selected.name} explode`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not composite explode view');
    } finally {
      setExporting(false);
    }
  };

  let panelBody: ReactNode;
  if (loading) {
    panelBody = (
      <div className="figma-explore-empty">
        <Loader2 size={22} className="spin" />
        <strong>Loading layers…</strong>
        <span>Fetching the Figma document tree</span>
      </div>
    );
  } else if (file && mode === 'explode' && plates.length) {
    panelBody = (
      <>
        <div className="figma-explore-toolbar">
          <div className="figma-explore-file">
            <UnfoldVertical size={14} />
            <div>
              <strong>Explode · {selected?.name ?? 'Frame'}</strong>
              <span>{plates.length} layers pulled apart</span>
            </div>
          </div>
          <button type="button" className="button subtle-button" onClick={() => setMode('tree')}>
            Back to tree
          </button>
        </div>
        <ExplodeStage
          plates={plates}
          amount={explodeAmount}
          activeId={activePlateId}
          onSelect={setActivePlateId}
        />
        <div className="figma-explode-controls">
          <label className="figma-explode-amount">
            <span>Spread</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explodeAmount}
              onChange={(e) => setExplodeAmount(Number(e.target.value))}
            />
          </label>
          <div className="figma-explode-actions">
            <button
              type="button"
              className="button secondary-button"
              disabled={exporting || !activePlateId}
              onClick={() => void applyActivePlate()}
            >
              {exporting ? 'Exporting…' : 'Use selected layer'}
            </button>
            <button
              type="button"
              className="button primary-button"
              disabled={exporting}
              onClick={() => void applyExplodedComposite()}
            >
              Use exploded stack
            </button>
          </div>
        </div>
      </>
    );
  } else if (file) {
    panelBody = (
      <>
        <div className="figma-explore-toolbar">
          <div className="figma-explore-file">
            <Layers3 size={14} />
            <div>
              <strong>{file.name}</strong>
              <span>{file.layers.length} page{file.layers.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <label className="figma-explore-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter layers"
              aria-label="Filter layers"
            />
          </label>
        </div>
        <div className="figma-layer-tree" role="tree" aria-label="Figma layers">
          {file.layers.map((node) => (
            <LayerRow
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              expanded={expanded}
              query={query.trim()}
              onToggle={toggleExpanded}
              onSelect={(layer) => setSelectedId(layer.id)}
            />
          ))}
        </div>
        <div className="figma-explore-selection">
          {selected ? (
            <>
              <div className="figma-selection-preview">
                <LayerIcon type={selected.type} />
                <div>
                  <strong>{selected.name}</strong>
                  <span>
                    {selected.type.toLowerCase()}
                    {formatFigmaSize(selected.width, selected.height)
                      ? ` · ${formatFigmaSize(selected.width, selected.height)}`
                      : ''}
                    {explodeCandidates(selected).length
                      ? ` · ${explodeCandidates(selected).length} child layers`
                      : ''}
                  </span>
                </div>
                {selected.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </div>
              <div className="figma-selection-actions">
                <button
                  type="button"
                  className="button secondary-button"
                  disabled={exploding || !explodeCandidates(selected).length}
                  onClick={() => void openExplode()}
                >
                  {exploding ? 'Exploding…' : 'Explode view'}
                </button>
                <button
                  type="button"
                  className="button primary-button"
                  disabled={exporting || !canApplyFigmaLayer(selected.type)}
                  onClick={() => void applySelected()}
                >
                  {exporting ? 'Exporting…' : 'Use flat'}
                </button>
              </div>
            </>
          ) : (
            <p>Select a frame, then open Explode view to pull its layers apart.</p>
          )}
        </div>
      </>
    );
  } else {
    panelBody = (
      <div className="figma-explore-empty">
        <UnfoldVertical size={22} />
        <strong>Explode Figma layers</strong>
        <span>
          Load a file, pick a frame, then explode its children into a depth stack —
          paste alone stays flat because PNG has no layers.
        </span>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="export-modal export-modal-wide figma-explore-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="figma-explore-title"
      >
        <div className="modal-head">
          <div className="modal-icon"><UnfoldVertical size={20} /></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <h2 id="figma-explore-title">Explode view</h2>
        <p>
          Paste still gives a flat image. Explode pulls real Figma child layers apart in space
          so you can pick one plate — or drop the whole stack onto the phone.
        </p>

        <form className="figma-explore-form" onSubmit={(e) => void loadFile(e)}>
          <label className="field-stack">
            <span>Figma URL</span>
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://www.figma.com/design/…"
              autoFocus
              spellCheck={false}
            />
          </label>
          <label className="field-stack">
            <span>Personal access token</span>
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="figd_…"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="button secondary-button" disabled={loading}>
            {loading ? 'Loading…' : file ? 'Reload file' : 'Load layers'}
          </button>
        </form>

        {error && <p className="figma-explore-error" role="alert">{error}</p>}

        <div className={`figma-explore-panel ${mode === 'explode' ? 'is-explode' : ''}`}>
          {panelBody}
        </div>

        <div className="export-modal-actions">
          <button type="button" className="button subtle-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
