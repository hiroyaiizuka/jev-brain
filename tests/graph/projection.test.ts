import { describe, expect, it } from 'vitest';
import { Role } from 'src/Types';
import {
  BandExtents,
  Level,
  LevelHierarchy,
  Point,
  compressBands,
  extentOf,
  levelOf,
  project,
} from 'src/graph/Projection';

/**
 * docs/3d-brief.md §7 の 8 ノート。docs/3d-design.md §5 の設定（`up` を Up、`origin` を Parents、`example` を Down）。
 * 子のうち「朝のルーティン手順」は Children 領域のフィールド、「9/20 朝ランの記録」は推論リンクにして、
 * 「Up／Down 以外は地面」の枝も同じ fixture で通す。中心ノートは隣接関係を持たないので levelOf を呼ばない。
 */
type Neighbour = {
  title: string;
  role: Role;
  typeDefinition: string | undefined;
  center: Point;
  expectedLevel: Level;
};

const hierarchy: LevelHierarchy = { abstract: ['up'], concrete: ['example'] };

const centralNote: Point = { x: 0, y: 0 };
const neighbours: Neighbour[] = [
  { title: '行動デザイン', role: Role.PARENT, typeDefinition: 'up', center: { x: -120, y: -200 }, expectedLevel: 1 },
  { title: '読書メモ：習慣の本', role: Role.PARENT, typeDefinition: 'origin', center: { x: 120, y: -200 }, expectedLevel: 0 },
  { title: 'if-then プラン', role: Role.LEFT, typeDefinition: 'analogous-to', center: { x: -300, y: 0 }, expectedLevel: 0 },
  { title: '意志力で続ける', role: Role.RIGHT, typeDefinition: 'supported-by', center: { x: 300, y: 0 }, expectedLevel: 0 },
  { title: '朝のルーティン手順', role: Role.CHILD, typeDefinition: 'steps', center: { x: -150, y: 200 }, expectedLevel: 0 },
  { title: '歯磨き後に腕立て', role: Role.CHILD, typeDefinition: 'example', center: { x: 0, y: 200 }, expectedLevel: -1 },
  { title: '9/20 朝ランの記録', role: Role.CHILD, typeDefinition: undefined, center: { x: 150, y: 200 }, expectedLevel: 0 },
];

describe('levelOf', () => {
  it('gives the brief notes the levels of 3d-design §3-1 (行動デザイン +1, 読書メモ 0, 歯磨き -1)', () => {
    for (const n of neighbours) {
      expect(levelOf(n.typeDefinition, n.role, hierarchy), n.title).toBe(n.expectedLevel);
    }
  });

  it('returns 0 for an inferred link (no typeDefinition) and for an empty definition', () => {
    expect(levelOf(undefined, Role.PARENT, hierarchy)).toBe(0);
    expect(levelOf('', Role.CHILD, hierarchy)).toBe(0);
    expect(levelOf(' , ', Role.CHILD, hierarchy)).toBe(0);
  });

  it('lets one Up/Down field in a ", "-joined definition (Page.addParent/addChild) decide the level', () => {
    expect(levelOf('origin, up', Role.PARENT, hierarchy)).toBe(1);
    expect(levelOf('steps, example', Role.CHILD, hierarchy)).toBe(-1);
    expect(levelOf('origin, source', Role.PARENT, hierarchy)).toBe(0);
  });

  it('compares fields as hierarchyLowerCase stores them (already lower case, hyphenated) without re-normalising', () => {
    const spaced: LevelHierarchy = { abstract: ['part-of'], concrete: ['next-level-detail'] };
    expect(levelOf('part-of', Role.PARENT, spaced)).toBe(1);
    expect(levelOf('origin, next-level-detail', Role.CHILD, spaced)).toBe(-1);
    // 生のフィールド名は typeDefinition には現れない。現れても hierarchyLowerCase と一致しないので 0。
    expect(levelOf('Part Of', Role.PARENT, spaced)).toBe(0);
  });

  it('takes the sign from the role: a parent linked by a Down field written on the parent is still +1', () => {
    const both: LevelHierarchy = { abstract: ['up'], concrete: ['down'] };
    expect(levelOf('down', Role.PARENT, both)).toBe(1);
    expect(levelOf('up', Role.CHILD, both)).toBe(-1);
  });

  it('keeps friends on the ground even when the field is in Up/Down', () => {
    expect(levelOf('up', Role.LEFT, hierarchy)).toBe(0);
    expect(levelOf('example', Role.RIGHT, hierarchy)).toBe(0);
  });

  it('keeps folder and tag trees on the ground (their definitions are literals outside the axis)', () => {
    expect(levelOf('file-tree', Role.PARENT, hierarchy)).toBe(0);
    expect(levelOf('tag-tree', Role.CHILD, hierarchy)).toBe(0);
  });

  it('keeps siblings and unresolved (virtual) pages on the ground regardless of the field', () => {
    // 兄弟の Neighbour は親の getChildren() 由来: 兄弟が `up:: [[親]]` と書いていれば typeDefinition は 'up'。
    expect(levelOf('up', Role.CHILD, hierarchy, { isSibling: true })).toBe(0);
    expect(levelOf('up', Role.PARENT, hierarchy, { isSibling: true })).toBe(0);
    // 未解決リンクは addUnresolvedPage のあと定義済みのフィールドで結ばれる。
    expect(levelOf('up', Role.PARENT, hierarchy, { isVirtual: true })).toBe(0);
    expect(levelOf('example', Role.CHILD, hierarchy, { isVirtual: true })).toBe(0);
    expect(levelOf('up', Role.PARENT, hierarchy, { isSibling: false, isVirtual: false })).toBe(1);
  });
});

describe('project', () => {
  const params = { yawDegrees: 20, widthScale: 0.8, levelHeight: 60 };

  it('leaves x untouched at yaw 0° and widthScale 1, and lifts y by level · levelHeight', () => {
    const flat = { yawDegrees: 0, widthScale: 1, levelHeight: 60 };
    expect(project({ x: -120, y: -200 }, 0, flat)).toEqual({ x: -120, y: -200, depth: -200 });
    expect(project({ x: -120, y: -200 }, 1, flat)).toEqual({ x: -120, y: -260, depth: -200 });
    expect(project({ x: 150, y: 200 }, -1, flat)).toEqual({ x: 150, y: 260, depth: 200 });
  });

  it('scales only x with widthScale', () => {
    const flat = { yawDegrees: 0, widthScale: 0.8, levelHeight: 60 };
    const wide = project({ x: 300, y: 0 }, 0, flat);
    expect(wide.x).toBeCloseTo(240, 9);
    expect(wide.y).toBe(0);
    expect(wide.depth).toBe(0);
    expect(project({ x: 0, y: 200 }, 0, flat)).toEqual({ x: 0, y: 200, depth: 200 });
  });

  it('rotates by the yaw before scaling and lifting (north point at 20°)', () => {
    const rotated = project({ x: 0, y: -100 }, 0, { ...params, widthScale: 1 });
    expect(rotated.x).toBeCloseTo(34.2, 1);
    expect(rotated.y).toBeCloseTo(-93.97, 2);
    expect(rotated.depth).toBeCloseTo(-93.97, 2);

    const lifted = project({ x: 0, y: -100 }, 1, params);
    expect(lifted.x).toBeCloseTo(34.2 * 0.8, 1);
    expect(lifted.y).toBeCloseTo(-93.97 - 60, 2);
    expect(lifted.depth).toBeCloseTo(-93.97, 2);
  });

  it('uses the rotated y as depth, so depth does not depend on level and follows y at yaw 0°', () => {
    const sin = Math.sin((20 * Math.PI) / 180);
    const cos = Math.cos((20 * Math.PI) / 180);
    const points = [centralNote, ...neighbours.map((n) => n.center)];
    for (const p of points) {
      expect(project(p, 0, params).depth).toBeCloseTo(p.x * sin + p.y * cos, 9);
      expect(project(p, 1, params).depth).toBe(project(p, -1, params).depth);
    }
    const flat = { ...params, yawDegrees: 0 };
    const byDepth = [...points].sort((a, b) => project(a, 0, flat).depth - project(b, 0, flat).depth).map((p) => p.y);
    expect(byDepth).toEqual([...points].map((p) => p.y).sort((a, b) => a - b));
  });
});

describe('compressBands', () => {
  const nodeHeight = 40;
  // Layout の top と top + rows·rowHeight に相当する帯の範囲。
  const extents: BandExtents = {
    north: { top: -320, bottom: -200 }, // 親 3 行
    center: { top: -60, bottom: 60 }, // 中心と左右の友（3 行）
    south: { top: 180, bottom: 260 }, // 子 2 行
  };

  it('shrinks only the gap between bands to depthScale: north moves south, south moves north, centre stays', () => {
    const shifts = compressBands(extents, 0.38);
    // 北: 隙間 140 → 53.2 なので 86.8 南へ。南: 隙間 120 → 45.6 なので 74.4 北へ。
    expect(shifts.north).toBeCloseTo(86.8, 9);
    expect(shifts.south).toBeCloseTo(-74.4, 9);
    expect(extents.north.bottom + shifts.north).toBeCloseTo(extents.center.top - 140 * 0.38, 9);
    expect(extents.south.top + shifts.south).toBeCloseTo(extents.center.bottom + 120 * 0.38, 9);
  });

  it('keeps the row spacing of a 12-parent / 12-child fixture because a band moves as a whole', () => {
    const rows = (origoY: number) => [0, 1, 2, 3].flatMap((row) => [0, 1, 2].map(() => ({ y: origoY + row * nodeHeight, height: nodeHeight })));
    const parents = rows(-400);
    const children = rows(300);
    const shifts = compressBands({ north: extentOf(parents), center: { top: -20, bottom: 20 }, south: extentOf(children) }, 0.38);
    const gaps = (ys: number[]) => ys.slice(1).map((y, i) => y - ys[i]);
    const shiftedParents = parents.map((p) => p.y + shifts.north);
    const shiftedChildren = children.map((c) => c.y + shifts.south);
    expect(gaps(shiftedParents)).toEqual(gaps(parents.map((p) => p.y)));
    expect(gaps(shiftedChildren)).toEqual(gaps(children.map((c) => c.y)));
    // 潰したあとも帯は重ならない。
    expect(Math.max(...shiftedParents) + nodeHeight / 2).toBeLessThan(-20);
    expect(Math.min(...shiftedChildren) - nodeHeight / 2).toBeGreaterThan(20);
  });

  it('measures the centre band with the extent the caller gives (embedded centre)', () => {
    const shifts = compressBands({ north: { top: -120, bottom: -80 }, center: { top: 0, bottom: 300 }, south: { top: 380, bottom: 420 } }, 0.5);
    expect(shifts).toEqual({ north: 40, south: -40 });
  });

  it('is the identity at depthScale 1 (and above, and NaN) and makes the bands touch at 0 (and below)', () => {
    for (const s of [1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(compressBands(extents, s), String(s)).toEqual({ north: 0, south: 0 });
    }
    for (const s of [0, -1, Number.NEGATIVE_INFINITY]) {
      const shifts = compressBands(extents, s);
      expect(extents.north.bottom + shifts.north, String(s)).toBe(extents.center.top);
      expect(extents.south.top + shifts.south, String(s)).toBe(extents.center.bottom);
    }
  });

  it('does not move bands that already touch or overlap, nor when a band is missing', () => {
    const tight: BandExtents = { north: { top: -60, bottom: -20 }, center: { top: -20, bottom: 20 }, south: { top: 15, bottom: 55 } };
    expect(compressBands(tight, 0.38)).toEqual({ north: 0, south: 0 });
    expect(compressBands({ north: null, center: { top: -20, bottom: 20 }, south: { top: 180, bottom: 220 } }, 0.5)).toEqual({ north: 0, south: -80 });
    expect(compressBands({ north: { top: -220, bottom: -180 }, center: null, south: { top: 180, bottom: 220 } }, 0.38)).toEqual({ north: 0, south: 0 });
  });

  it('extentOf takes the outer box edges of a band and null for an empty band', () => {
    expect(extentOf([])).toBeNull();
    expect(extentOf([{ y: 0, height: 40 }])).toEqual({ top: -20, bottom: 20 });
    expect(extentOf([{ y: -40, height: 40 }, { y: 0, height: 40 }, { y: 40, height: 40 }])).toEqual({ top: -60, bottom: 60 });
    expect(extentOf([{ y: 150, height: 300 }, { y: 0, height: 40 }])).toEqual({ top: -20, bottom: 300 });
  });
});
