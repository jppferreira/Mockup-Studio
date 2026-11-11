import { describe, expect, it } from 'vitest';
import {
  buildFigmaNodeUrl,
  explodeCandidates,
  explodeSubgroupCandidates,
  findFigmaNode,
  isFigmaTokenCredentialFailure,
  type FigmaLayerNode,
} from './figma';
import { normalizeFigmaScreenSource } from '../types';

function node(
  id: string,
  name: string,
  children: FigmaLayerNode[] = [],
  visible = true,
  type: FigmaLayerNode['type'] = 'FRAME',
): FigmaLayerNode {
  return { id, name, type, visible, children };
}

describe('explodeCandidates — direct children only', () => {
  it('returns only top-level children, never nested grandchildren', () => {
    const nested = node('g1', 'Nested group', [
      node('leaf1', 'Icon'),
      node('leaf2', 'Label'),
    ]);
    const root = node('root', 'Screen', [
      node('bg', 'Background'),
      nested,
      node('cta', 'Button'),
    ]);

    const plates = explodeCandidates(root);
    expect(plates.map((p) => p.id)).toEqual(['bg', 'g1', 'cta']);
    expect(plates.find((p) => p.id === 'g1')?.children.map((c) => c.id)).toEqual(['leaf1', 'leaf2']);
    // Nested leaves are NOT separate explode candidates of the root
    expect(plates.some((p) => p.id === 'leaf1' || p.id === 'leaf2')).toBe(false);
  });

  it('skips invisible direct children but keeps nested structure on visible plates', () => {
    const root = node('root', 'Screen', [
      node('hidden', 'Hidden', [], false),
      node('card', 'Card', [node('title', 'Title')]),
    ]);
    const plates = explodeCandidates(root);
    expect(plates.map((p) => p.id)).toEqual(['card']);
    expect(plates[0].children[0].id).toBe('title');
  });

  it('caps plate count without recursing into children', () => {
    const kids = Array.from({ length: 20 }, (_, i) => node(`c${i}`, `Layer ${i}`, [
      node(`nested-${i}`, `Nested ${i}`),
    ]));
    const plates = explodeCandidates(node('root', 'Screen', kids), 16);
    expect(plates).toHaveLength(16);
    expect(plates.every((p) => p.id.startsWith('c'))).toBe(true);
    expect(plates.some((p) => p.id.startsWith('nested-'))).toBe(false);
    // Prefer topmost (front) layers when capped.
    expect(plates[0].id).toBe('c4');
    expect(plates[15].id).toBe('c19');
  });
});

describe('explodeSubgroupCandidates — expand frames into children', () => {
  it('skips parent frames and uses their children as plates', () => {
    const root = node('root', 'Screen', [
      node('bg', 'Background', [], true, 'RECTANGLE'),
      node('header', 'Header', [
        node('logo', 'Logo', [], true, 'VECTOR'),
        node('title', 'Title', [], true, 'TEXT'),
      ]),
      node('cta', 'Button', [], true, 'RECTANGLE'),
    ]);

    const plates = explodeSubgroupCandidates(root);
    expect(plates.map((p) => p.node.id)).toEqual(['bg', 'logo', 'title', 'cta']);
    expect(plates.some((p) => p.node.id === 'header')).toBe(false);
    expect(plates.find((p) => p.node.id === 'logo')?.groupName).toBe('Header');
    expect(plates.find((p) => p.node.id === 'title')?.groupId).toBe('header');
  });

  it('keeps leaf top-level nodes as their own plates', () => {
    const root = node('root', 'Screen', [
      node('a', 'A', [], true, 'RECTANGLE'),
      node('b', 'B', [], true, 'TEXT'),
    ]);
    expect(explodeSubgroupCandidates(root).map((p) => p.node.id)).toEqual(['a', 'b']);
  });

  it('caps expanded plates to the topmost N (not the bottom)', () => {
    const kids = Array.from({ length: 20 }, (_, i) => (
      node(`c${i}`, `Layer ${i}`, [], true, 'RECTANGLE')
    ));
    const plates = explodeSubgroupCandidates(node('root', 'Screen', kids), 16);
    expect(plates).toHaveLength(16);
    expect(plates.map((p) => p.node.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `c${i + 4}`),
    );
  });
});

describe('figma source helpers', () => {
  it('builds a node URL with hyphenated node-id', () => {
    expect(buildFigmaNodeUrl('AbCdEf', '12:34')).toContain('node-id=12-34');
  });

  it('finds nested nodes without flattening the tree', () => {
    const tree = [
      node('page', 'Page', [
        node('frame', 'Frame', [node('child', 'Child')]),
      ]),
    ];
    expect(findFigmaNode(tree, 'child')?.name).toBe('Child');
    expect(findFigmaNode(tree, 'missing')).toBeNull();
  });

  it('normalizes figmaSource provenance', () => {
    expect(normalizeFigmaScreenSource({
      url: 'https://www.figma.com/design/Ab/File?node-id=1-2',
      fileKey: 'Ab',
      nodeId: '1:2',
      lastModified: '2026-11-10T12:00:00Z',
      layered: true,
      rootName: 'Home',
    })).toMatchObject({ fileKey: 'Ab', nodeId: '1:2', layered: true });
    expect(normalizeFigmaScreenSource({ fileKey: 'x' })).toBeUndefined();
  });
});

describe('revoked / invalid token detection', () => {
  it('treats Invalid token / expired / bad scopes as credential failures', () => {
    expect(isFigmaTokenCredentialFailure(403, 'Invalid token')).toBe(true);
    expect(isFigmaTokenCredentialFailure(403, 'Token expired')).toBe(true);
    expect(isFigmaTokenCredentialFailure(403, 'Invalid scope(s): file_content:read')).toBe(true);
    expect(isFigmaTokenCredentialFailure(401, null)).toBe(true);
  });

  it('does not wipe on file-access style 403s', () => {
    expect(isFigmaTokenCredentialFailure(403, 'File not exportable')).toBe(false);
    expect(isFigmaTokenCredentialFailure(403, null)).toBe(false);
    expect(isFigmaTokenCredentialFailure(404, 'Not found')).toBe(false);
  });
});
