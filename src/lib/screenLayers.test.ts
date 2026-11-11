import { describe, expect, it } from 'vitest';
import { isTopLevelContainerPlate, planIncrementalExtrusion } from './screenLayers';

function plate(
  id: string,
  name: string,
  layerType?: string,
  extrusionGroup?: string,
) {
  return {
    id,
    name,
    dataUrl: 'data:image/png;base64,aaa',
    ...(layerType ? { layerType } : {}),
    ...(extrusionGroup ? { extrusionGroup } : {}),
  };
}

describe('planIncrementalExtrusion', () => {
  it('never thickens unlabeled top-level containers', () => {
    const planned = planIncrementalExtrusion([
      plate('bg', 'Fill', 'RECTANGLE'),
      plate('header', 'Header', 'FRAME'),
      plate('icon', 'Icon', 'VECTOR'),
      plate('label', 'Label', 'TEXT'),
    ], 1);

    expect(planned.find((p) => p.id === 'header')?.extrusionScale).toBe(0);
    expect(planned.find((p) => p.id === 'header')?.extrusionGroup).toBe('container');
    expect(planned.find((p) => p.id === 'icon')?.extrusionScale).toBeGreaterThan(0);
  });

  it('treats FRAME pieces with an expansion group as extrudable subgroups', () => {
    const planned = planIncrementalExtrusion([
      plate('row1', 'Row', 'FRAME', 'Header'),
      plate('icon', 'Icon', 'VECTOR', 'Header'),
      plate('card', 'Card', 'FRAME', 'Body'),
      plate('cta', 'CTA', 'TEXT', 'Body'),
    ], 1);

    expect(planned.every((p) => (p.extrusionScale ?? 0) > 0)).toBe(true);
    expect(planned[0].extrusionGroup).toBe('Header');
    expect(planned[2].extrusionGroup).toBe('Body');
    expect(planned[0].extrusionScale).toBeLessThan(planned[2].extrusionScale!);
  });

  it('steps ungrouped pieces in buckets of two', () => {
    const planned = planIncrementalExtrusion([
      plate('a', 'A', 'RECTANGLE'),
      plate('b', 'B', 'VECTOR'),
      plate('c', 'C', 'TEXT'),
      plate('d', 'D', 'ELLIPSE'),
    ], 1);

    expect(planned.map((p) => p.extrusionScale)).toEqual([0.5, 0.5, 1, 1]);
  });
});

describe('isTopLevelContainerPlate', () => {
  it('treats FRAME/GROUP as containers unless they carry an expansion group', () => {
    expect(isTopLevelContainerPlate({ layerType: 'FRAME' })).toBe(true);
    expect(isTopLevelContainerPlate({ layerType: 'FRAME', extrusionGroup: 'Header' })).toBe(false);
    expect(isTopLevelContainerPlate({ layerType: 'TEXT' })).toBe(false);
  });
});
