import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Box, ChevronDown, ChevronRight, Component, Eye, EyeOff, Frame, Layers3,
  LayoutTemplate, Loader2, Search, Square, Type, UnfoldVertical, X,
} from 'lucide-react';
import {
  buildFigmaNodeUrl, canApplyFigmaLayer, compositeExplodeStack, explodeCandidates,
  explodeSubgroupCandidates,
  exportFigmaDirectChildPlates, exportFigmaNodeAsDataUrl, exportFigmaNodesAsDataUrls, fetchFigmaFile,
  formatFigmaSize, hasFigmaToken, isFigmaAuthError, loadFigmaToken, onFigmaTokenChange, parseFigmaUrl,
  type FigmaFileSummary, type FigmaLayerNode, type FigmaNodeType,
} from '../lib/figma';
import type { FigmaScreenSource } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (dataUrl: string, layerName: string, source?: FigmaScreenSource) => void;
  /** Place top-level plates as Rotato-style 3D exploded layers on the device. */
  onApplyExplosion?: (
    plates: {
      id: string;
      name: string;
      dataUrl: string;
      layerType?: string;
      type?: string;
      extrusionGroup?: string;
    }[],
    amount: number,
    label: string,
    extrusion?: number,
    source?: FigmaScreenSource,
  ) => void;
  onNotify: (message: string) => void;
  /** Prefill the Figma URL field when opening from Assets. */
  initialUrl?: string;
  /** Called when the user chooses to connect a Figma token. */
  onNeedToken?: () => void;
  /** Parent-authoritative connected flag (must also have a live token in memory). */
  tokenConnected?: boolean;
}

type ExplodePlate = {
  id: string;
  name: string;
  type: FigmaNodeType;
  dataUrl: string;
  extrusionGroup?: string;
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

export default function FigmaExploreModal({
  open, onClose, onApply, onApplyExplosion, onNotify, initialUrl, onNeedToken,
  tokenConnected: tokenConnectedProp,
}: Props) {
  const [urlDraft, setUrlDraft] = useState('');
  const [tokenLive, setTokenLive] = useState(() => hasFigmaToken());
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
  const [explodeExtrusion, setExplodeExtrusion] = useState(0.35);
  const [explodePieceCount, setExplodePieceCount] = useState(8);
  const [activePlateId, setActivePlateId] = useState<string | null>(null);
  const openRef = useRef(open);
  const applyGenerationRef = useRef(0);

  useEffect(() => {
    openRef.current = open;
    if (!open) applyGenerationRef.current += 1;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTokenLive(hasFigmaToken());
    if (initialUrl?.trim()) setUrlDraft(initialUrl.trim());
  }, [open, initialUrl]);

  useEffect(() => {
    if (!open) return;
    return onFigmaTokenChange((connected) => setTokenLive(connected));
  }, [open]);

  /** Link field only after a real token is linked. */
  const hasLinkedToken = Boolean(
    (tokenConnectedProp !== false)
    && (tokenConnectedProp === true || tokenLive)
    && hasFigmaToken()
    && loadFigmaToken().trim(),
  );

  const selected = useMemo(
    () => (file && selectedId ? findNode(file.layers, selectedId) : null),
    [file, selectedId],
  );

  /** Bottom → top subset controlled by the Pieces slider. */
  const activePlates = useMemo(() => {
    const count = Math.min(plates.length, Math.max(2, explodePieceCount));
    return plates.slice(0, count);
  }, [plates, explodePieceCount]);

  // Defer heavy explode-stage work so Size/Pieces/Extrude sliders stay responsive.
  const deferredAmount = useDeferredValue(explodeAmount);
  const deferredPlates = useDeferredValue(activePlates);
  const deferredExtrusion = useDeferredValue(explodeExtrusion);

  if (!open) return null;

  const loadFile = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    if (!hasLinkedToken) {
      onNeedToken?.();
      setError('Connect to Figma before pasting a frame link.');
      return;
    }
    const parsed = parseFigmaUrl(urlDraft);
    if (!parsed) {
      setError('Paste a Figma design URL (figma.com/design/…) or file key.');
      return;
    }
    const token = loadFigmaToken().trim();
    if (!token) {
      onNeedToken?.();
      setError('Connect to Figma before pasting a frame link.');
      return;
    }

    setLoading(true);
    try {
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
      if (isFigmaAuthError(err)) onNeedToken?.();
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

  const figmaSourceFor = (
    nodeId: string,
    rootName: string,
    layered: boolean,
    lastModified?: string,
  ): FigmaScreenSource => ({
    url: buildFigmaNodeUrl(file!.fileKey, nodeId),
    fileKey: file!.fileKey,
    nodeId,
    lastModified: lastModified || file?.lastModified || new Date().toISOString(),
    rootName,
    layered,
  });

  /** Default apply: one plate per direct child; nested groups stay inside their parent raster. */
  const applySelected = async (mode: 'layered' | 'flat' = 'layered') => {
    if (!file || !selected) return;
    if (!canApplyFigmaLayer(selected.type)) {
      setError('Pick a frame, component, instance, or group to use as the phone screen.');
      return;
    }
    const generation = ++applyGenerationRef.current;
    setExporting(true);
    setError(null);
    try {
      if (mode === 'layered' && onApplyExplosion) {
        const layered = await exportFigmaDirectChildPlates(
          file.fileKey,
          selected.id,
          loadFigmaToken(),
          1.5,
          { layers: file.layers, lastModified: file.lastModified },
        );
        if (generation !== applyGenerationRef.current || !openRef.current) return;
        if (layered.plates.length >= 2) {
          onApplyExplosion(
            layered.plates,
            0,
            layered.rootName || selected.name,
            0,
            figmaSourceFor(selected.id, layered.rootName || selected.name, true, layered.lastModified),
          );
          onClose();
          return;
        }
      }
      const { dataUrl } = await exportFigmaNodeAsDataUrl(file.fileKey, selected.id, loadFigmaToken(), 2);
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      onApply(
        dataUrl,
        selected.name,
        figmaSourceFor(selected.id, selected.name, false, file.lastModified),
      );
      onClose();
    } catch (err) {
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not export layer');
    } finally {
      if (generation === applyGenerationRef.current) setExporting(false);
    }
  };

  const openExplode = async () => {
    if (!file || !selected) return;
    // Prefer depth-accurate subgroup export so frames expand into child plates.
    const generation = ++applyGenerationRef.current;
    setExploding(true);
    setError(null);
    try {
      const layered = await exportFigmaDirectChildPlates(
        file.fileKey,
        selected.id,
        loadFigmaToken(),
        1.5,
        { layers: file.layers, lastModified: file.lastModified },
      );
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      let nextPlates: ExplodePlate[] = layered.plates.map((plate) => ({
        id: plate.id,
        name: plate.name,
        type: (plate.layerType || 'FRAME') as FigmaNodeType,
        dataUrl: plate.dataUrl,
        ...(plate.extrusionGroup ? { extrusionGroup: plate.extrusionGroup } : {}),
      }));

      // Local tree fallback when the nodes API returns too few plates.
      if (nextPlates.length < 2) {
        const local = explodeSubgroupCandidates(selected);
        if (!local.length) {
          const direct = explodeCandidates(selected);
          if (!direct.length) {
            if (generation !== applyGenerationRef.current || !openRef.current) return;
            setError('That layer has no child layers to explode. Pick a frame that contains UI stacks.');
            return;
          }
        }
        const candidates = local.length >= 2 ? local : explodeCandidates(selected).map((node) => ({ node }));
        const images = await exportFigmaNodesAsDataUrls(
          file.fileKey,
          candidates.map((entry) => entry.node.id),
          loadFigmaToken(),
          1.5,
        );
        if (generation !== applyGenerationRef.current || !openRef.current) return;
        nextPlates = [];
        for (const entry of candidates) {
          const dataUrl = images.get(entry.node.id);
          if (!dataUrl) continue;
          const groupName = 'groupName' in entry && typeof entry.groupName === 'string'
            ? entry.groupName
            : 'groupId' in entry && typeof entry.groupId === 'string'
              ? entry.groupId
              : '';
          nextPlates.push({
            id: entry.node.id,
            name: entry.node.name,
            type: entry.node.type,
            dataUrl,
            ...(groupName ? { extrusionGroup: groupName } : {}),
          });
        }
      }

      if (nextPlates.length < 2) {
        throw new Error('Need at least two subgroup layers to explode. Pick a frame with nested UI stacks.');
      }
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      setPlates(nextPlates);
      setExplodePieceCount(nextPlates.length);
      setExplodeRootId(selected.id);
      setActivePlateId(nextPlates[nextPlates.length - 1]?.id ?? null);
      setMode('explode');
      onNotify(`Exploded ${nextPlates.length} subgroup layers from “${selected.name}”`);
    } catch (err) {
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not build explode view');
    } finally {
      if (generation === applyGenerationRef.current) setExploding(false);
    }
  };

  const applyActivePlate = async () => {
    if (!file || !activePlateId) return;
    const plate = plates.find((item) => item.id === activePlateId);
    if (!plate) return;
    const generation = ++applyGenerationRef.current;
    setExporting(true);
    setError(null);
    try {
      // Re-export at higher scale for the phone screen
      const { dataUrl } = await exportFigmaNodeAsDataUrl(file.fileKey, plate.id, loadFigmaToken(), 2);
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      onApply(dataUrl, plate.name);
      onClose();
    } catch (err) {
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not export layer');
    } finally {
      if (generation === applyGenerationRef.current) setExporting(false);
    }
  };

  const applyExplodedComposite = async () => {
    if (!activePlates.length || !selected) return;
    const generation = ++applyGenerationRef.current;
    setExporting(true);
    setError(null);
    try {
      if (onApplyExplosion) {
        if (generation !== applyGenerationRef.current || !openRef.current) return;
        onApplyExplosion(
          activePlates.map((plate) => ({
            id: plate.id,
            name: plate.name,
            dataUrl: plate.dataUrl,
            layerType: plate.type,
            type: plate.type,
            ...(plate.extrusionGroup ? { extrusionGroup: plate.extrusionGroup } : {}),
          })),
          explodeAmount,
          selected.name,
          explodeExtrusion,
          figmaSourceFor(
            explodeRootId || selected.id,
            selected.name,
            true,
            file?.lastModified,
          ),
        );
        onClose();
        return;
      }
      const dataUrl = await compositeExplodeStack(
        activePlates.map((plate) => ({ dataUrl: plate.dataUrl, name: plate.name })),
        explodeAmount,
      );
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      onApply(dataUrl, `${selected.name} explode`);
      onClose();
    } catch (err) {
      if (generation !== applyGenerationRef.current || !openRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not composite explode view');
    } finally {
      if (generation === applyGenerationRef.current) setExporting(false);
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
    const maxPieces = plates.length;
    const pieceCount = Math.min(maxPieces, Math.max(2, explodePieceCount));
    panelBody = (
      <>
        <div className="figma-explore-toolbar">
          <div className="figma-explore-file">
            <UnfoldVertical size={14} />
            <div>
              <strong>Explode · {selected?.name ?? 'Frame'}</strong>
              <span>
                {pieceCount} of {maxPieces} layer{maxPieces === 1 ? '' : 's'} in the explosion
              </span>
            </div>
          </div>
          <button type="button" className="button subtle-button" onClick={() => setMode('tree')}>
            Back to tree
          </button>
        </div>
        <ExplodeStage
          plates={deferredPlates}
          amount={deferredAmount}
          activeId={activePlateId}
          onSelect={setActivePlateId}
        />
        <div className="figma-explode-controls">
          <label className="figma-explode-amount">
            <span>Size</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explodeAmount}
              onChange={(e) => setExplodeAmount(Number(e.target.value))}
              aria-valuetext={`${Math.round(explodeAmount * 100)}% explosion size`}
            />
          </label>
          <label className="figma-explode-amount">
            <span>Pieces · {pieceCount}</span>
            <input
              type="range"
              min={2}
              max={maxPieces}
              step={1}
              value={pieceCount}
              disabled={maxPieces <= 2}
              onChange={(e) => {
                const next = Number(e.target.value);
                setExplodePieceCount(next);
                const subset = plates.slice(0, next);
                if (activePlateId && !subset.some((plate) => plate.id === activePlateId)) {
                  setActivePlateId(subset[subset.length - 1]?.id ?? null);
                }
              }}
            />
          </label>
          {onApplyExplosion ? (
            <label className="figma-explode-amount">
              <span>Extrude{deferredExtrusion > 0.001 ? ` · ${Math.round(deferredExtrusion * 100)}%` : ''}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={explodeExtrusion}
                onChange={(e) => setExplodeExtrusion(Number(e.target.value))}
              />
            </label>
          ) : null}
          <div className="figma-explode-actions">
            <button
              type="button"
              className="button secondary-button"
              disabled={exporting || !activePlateId || !activePlates.some((plate) => plate.id === activePlateId)}
              onClick={() => void applyActivePlate()}
            >
              {exporting ? 'Exporting…' : 'Use selected layer'}
            </button>
            <button
              type="button"
              className="button primary-button"
              disabled={exporting || activePlates.length < 2}
              onClick={() => void applyExplodedComposite()}
            >
              {onApplyExplosion
                ? (explodeExtrusion > 0.001 ? 'Place as 3D cards' : 'Place on device in 3D')
                : 'Use exploded stack'}
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
                {explodeCandidates(selected).length >= 2 && onApplyExplosion ? (
                  <button
                    type="button"
                    className="button primary-button"
                    disabled={exporting || !canApplyFigmaLayer(selected.type)}
                    onClick={() => void applySelected('layered')}
                  >
                    {exporting ? 'Exporting…' : 'Place layers'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={explodeCandidates(selected).length >= 2 && onApplyExplosion
                    ? 'button secondary-button'
                    : 'button primary-button'}
                  disabled={exporting || !canApplyFigmaLayer(selected.type)}
                  onClick={() => void applySelected('flat')}
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
          Load a file, pick a frame, then explode its top-level children into real 3D plates on the device —
          like Rotato. Paste alone stays flat because PNG has no layers.
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
          {hasLinkedToken
            ? 'Paste a Figma frame link, load layers, then explode top-level plates onto the device.'
            : 'Connect to Figma first. The frame-link field appears only after your access token is saved.'}
        </p>

        {hasLinkedToken ? (
          <form className="figma-explore-form" onSubmit={(e) => void loadFile(e)}>
            <label className="field-stack figma-explore-url-field">
              <span>Paste Figma frame link</span>
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://www.figma.com/design/…"
                autoFocus
                spellCheck={false}
              />
            </label>
            <div className="figma-explore-form-actions">
              <button type="submit" className="button primary-button" disabled={loading || !urlDraft.trim()}>
                {loading ? 'Loading…' : file ? 'Reload' : 'Open'}
              </button>
            </div>
          </form>
        ) : (
          <div className="figma-explore-connect-prompt">
            <p>Do you want to connect to Figma?</p>
            <button
              type="button"
              className="button primary-button"
              onClick={() => onNeedToken?.()}
            >
              Connect Figma token
            </button>
          </div>
        )}

        {error && <p className="figma-explore-error" role="alert">{error}</p>}

        {hasLinkedToken ? (
          <div className={`figma-explore-panel ${mode === 'explode' ? 'is-explode' : ''}`}>
            {panelBody}
          </div>
        ) : null}

        <div className="export-modal-actions">
          <button type="button" className="button subtle-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
