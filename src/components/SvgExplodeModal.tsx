import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Box, ChevronDown, ChevronRight, FileCode2, Layers3, Loader2, Search, Square, UnfoldVertical, X,
} from 'lucide-react';
import {
  buildSvgExplodePlates, compositeSvgExplode, exportFullSvgPng, exportSvgLayerPng,
  findSvgLayer, svgExplodeCandidates,
  type SvgDocumentModel, type SvgLayerNode,
} from '../lib/svgLayers';

interface Props {
  open: boolean;
  model: SvgDocumentModel | null;
  onClose: () => void;
  onApply: (dataUrl: string, layerName: string) => void;
  /** Place top-level plates as Rotato-style 3D exploded layers on the device. */
  onApplyExplosion?: (
    plates: { id: string; name: string; dataUrl: string }[],
    amount: number,
    label: string,
  ) => void;
  onNotify: (message: string) => void;
}

type ExplodePlate = { id: string; name: string; tag: string; dataUrl: string };

function matchesQuery(node: SvgLayerNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q) || node.tag.toLowerCase().includes(q)) return true;
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
  node: SvgLayerNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  query: string;
  onToggle: (id: string) => void;
  onSelect: (node: SvgLayerNode) => void;
}) {
  if (!matchesQuery(node, query)) return null;
  const hasChildren = node.children.length > 0;
  const isOpen = query ? true : expanded.has(node.id);
  const selected = selectedId === node.id;

  return (
    <div className="figma-layer-branch">
      <button
        type="button"
        className={`figma-layer-row ${selected ? 'is-selected' : ''} is-applyable`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node)}
      >
        <span
          className={`figma-layer-twist ${hasChildren ? '' : 'is-empty'}`}
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            onToggle(node.id);
          }}
        >
          {hasChildren ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </span>
        <span className="figma-layer-icon">{hasChildren ? <Box size={13} /> : <Square size={13} />}</span>
        <span className="figma-layer-name">{node.name}</span>
        <span className="figma-layer-meta">{node.tag}</span>
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
    <div className="figma-explode-stage" aria-label="Exploded SVG layers">
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

export default function SvgExplodeModal({
  open, model, onClose, onApply, onApplyExplosion, onNotify,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'tree' | 'explode'>('tree');
  const [plates, setPlates] = useState<ExplodePlate[]>([]);
  const [explodeAmount, setExplodeAmount] = useState(0.65);
  const [activePlateId, setActivePlateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !model) return;
    setSelectedId(model.layers[0]?.id ?? null);
    setExpanded(new Set(model.layers[0] ? [model.layers[0].id] : []));
    setMode('tree');
    setPlates([]);
    setQuery('');
    setError(null);
  }, [open, model]);

  const selected = useMemo(
    () => (model && selectedId ? findSvgLayer(model.layers, selectedId) : null),
    [model, selectedId],
  );

  if (!open || !model) return null;

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyLayer = async (layerId: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await exportSvgLayerPng(model, layerId, 2);
      onApply(dataUrl, name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export layer');
    } finally {
      setBusy(false);
    }
  };

  const applyFull = async () => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await exportFullSvgPng(model, 2);
      onApply(dataUrl, model.fileName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export SVG');
    } finally {
      setBusy(false);
    }
  };

  const openExplode = async () => {
    if (!selected) return;
    const candidates = svgExplodeCandidates(selected);
    if (!candidates.length) {
      // Explode root if selected leaf's parent isn't set — explode whole doc layers
      const rootCandidates = model.layers;
      if (rootCandidates.length < 2 && !selected.children.length) {
        setError('Need a group with multiple children to explode. Export from Figma as SVG (layers as groups).');
        return;
      }
    }

    const parent = selected.children.length ? selected : {
      id: 'root',
      name: model.fileName,
      tag: 'svg',
      children: model.layers,
    };

    setBusy(true);
    setError(null);
    try {
      const next = await buildSvgExplodePlates(model, parent);
      if (!next.length) throw new Error('Could not rasterize SVG layers for explode view.');
      setPlates(next);
      setActivePlateId(next[next.length - 1]?.id ?? null);
      setMode('explode');
      onNotify(`Exploded ${next.length} SVG layers`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not explode SVG');
    } finally {
      setBusy(false);
    }
  };

  const applyExplodedComposite = async () => {
    if (!plates.length || !model) return;
    setBusy(true);
    setError(null);
    try {
      if (onApplyExplosion) {
        onApplyExplosion(
          plates.map((plate) => ({ id: plate.id, name: plate.name, dataUrl: plate.dataUrl })),
          explodeAmount,
          model.fileName,
        );
        onClose();
        return;
      }
      const dataUrl = await compositeSvgExplode(
        plates.map((plate) => ({ dataUrl: plate.dataUrl, name: plate.name })),
        explodeAmount,
      );
      onApply(dataUrl, `${model.fileName} explode`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not composite explode view');
    } finally {
      setBusy(false);
    }
  };

  let panelBody: ReactNode;
  if (mode === 'explode' && plates.length) {
    panelBody = (
      <>
        <div className="figma-explore-toolbar">
          <div className="figma-explore-file">
            <UnfoldVertical size={14} />
            <div>
              <strong>Explode · {selected?.name ?? model.fileName}</strong>
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
              disabled={busy || !activePlateId}
              onClick={() => {
                const plate = plates.find((item) => item.id === activePlateId);
                if (plate) void applyLayer(plate.id, plate.name);
              }}
            >
              Use selected layer
            </button>
            <button
              type="button"
              className="button primary-button"
              disabled={busy}
              onClick={() => void applyExplodedComposite()}
            >
              {onApplyExplosion ? 'Place on device in 3D' : 'Use exploded stack'}
            </button>
          </div>
        </div>
      </>
    );
  } else {
    panelBody = (
      <>
        <div className="figma-explore-toolbar">
          <div className="figma-explore-file">
            <Layers3 size={14} />
            <div>
              <strong>{model.fileName}</strong>
              <span>{model.width} × {model.height} · {model.layers.length} top layers</span>
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
        <div className="figma-layer-tree" role="tree" aria-label="SVG layers">
          {model.layers.map((node) => (
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
                <FileCode2 size={13} />
                <div>
                  <strong>{selected.name}</strong>
                  <span>
                    {selected.tag}
                    {selected.children.length ? ` · ${selected.children.length} children` : ''}
                  </span>
                </div>
              </div>
              <div className="figma-selection-actions">
                <button
                  type="button"
                  className="button secondary-button"
                  disabled={busy}
                  onClick={() => void openExplode()}
                >
                  {busy ? 'Exploding…' : 'Explode view'}
                </button>
                <button
                  type="button"
                  className="button primary-button"
                  disabled={busy}
                  onClick={() => void applyLayer(selected.id, selected.name)}
                >
                  Use layer
                </button>
              </div>
            </>
          ) : (
            <p>Select a group or shape, then explode or place it on the phone.</p>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="export-modal export-modal-wide figma-explore-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="svg-explode-title"
      >
        <div className="modal-head">
          <div className="modal-icon"><FileCode2 size={20} /></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <h2 id="svg-explode-title">SVG explode view</h2>
        <p>
          SVG keeps groups as real layers — export from Figma as SVG, import here, then pull layers apart.
          No token needed.
        </p>

        {error && <p className="figma-explore-error" role="alert">{error}</p>}

        <div className={`figma-explore-panel ${mode === 'explode' ? 'is-explode' : ''}`}>
          {panelBody}
        </div>

        <div className="export-modal-actions">
          <button type="button" className="button subtle-button" onClick={onClose}>Close</button>
          <button type="button" className="button secondary-button" disabled={busy} onClick={() => void applyFull()}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            Use full SVG
          </button>
        </div>
      </div>
    </div>
  );
}
