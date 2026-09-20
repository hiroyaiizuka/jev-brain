import { describe, expect, it } from 'vitest';
import { Role } from 'src/Types';
import {
  BandItem,
  Bands,
  Level,
  LevelHierarchy,
  compressBands,
  levelOf,
  normalizeFieldName,
  project,
  splitTypeDefinition,
} from 'src/graph/Projection';

/**
 * docs/3d-brief.md §7 の 8 ノート。docs/3d-design.md §5 の設定（`up` を Up、`origin` を Parents、`example` を Down）。
 * 子のうち「朝のルーティン手順」は Children 領域のフィールド、「9/20 朝ランの記録」は推論リンクにして、
 * 「Up／Down 以外は地面」の枝も同じ fixture で通す。中心（`typeDefinition` なし、`role` なし）は定義上 0。
 */
type Note = {
  title: string;
  role: Role | null;
  typeDefinition: string | undefined;
  center: { x: number; y: number };
  expectedLevel: Level;
};

const hierarchy: LevelHierarchy = { abstract: ['up'], concrete: ['example'] };

const notes: Note[] = [
  { title: '習慣はトリガー固定で続く', role: null, typeDefinition: undefined, center: { x: 0, y: 0 }, expectedLevel: 0 },
  { title: '行動デザイン', role: Role.PARENT, typeDefinition: 'up', center: { x: -120, y: -200 }, expectedLevel: 1 },
  { title: '読書メモ：習慣の本', role: Role.PARENT, typeDefinition: 'origin', center: { x: 120, y: -200 }, expectedLevel: 0 },
  { title: 'if-then プラン', role: Role.LEFT, typeDefinition: 'analogous-to', center: { x: -300, y: 0 }, expectedLevel: 0 },
  { title: '意志力で続ける', role: Role.RIGHT, typeDefinition: 'supported-by', center: { x: 300, y: 0 }, expectedLevel: 0 },
  { title: '朝のルーティン手順', role: Role.CHILD, typeDefinition: 'steps', center: { x: -150, y: 200 }, expectedLevel: 0 },
  { title: '歯磨き後に腕立て', role: Role.CHILD, typeDefinition: 'example', center: { x: 0, y: 200 }, expectedLevel: -1 },
  { title: '9/20 朝ランの記録', role: Role.CHILD, typeDefinition: undefined, center: { x: 150, y: 200 }, expectedLevel: 0 },
];

const levelOfNote = (note: Note): Level =>
  note.role === null ? 0 : levelOf(note.typeDefinition, note.role, hierarchy);

describe('levelOf', () => {
  it('gives the 8 brief notes the levels of 3d-design §3-1 (行動デザイン +1, 読書メモ 0, 歯磨き -1)', () => {
    const levels = Object.fromEntries(notes.map((note): [string, Level] => [note.title, levelOfNote(note)]));
    expect(levels).toEqual(Object.fromEntries(notes.map((note): [string, Level] => [note.title, note.expectedLevel])));
    expect(levels['行動デザイン']).toBe(1);
    expect(levels['読書メモ：習慣の本']).toBe(0);
    expect(levels['歯磨き後に腕立て']).toBe(-1);
  });

  it('returns 0 for an inferred link (no typeDefinition) and for an empty definition', () => {
    expect(levelOf(undefined, Role.PARENT, hierarchy)).toBe(0);
    expect(levelOf('', Role.CHILD, hierarchy)).toBe(0);
    expect(levelOf(' , ', Role.CHILD, hierarchy)).toBe(0);
  });

  it('lets one Up/Down field in a comma-separated definition decide the level', () => {
    expect(levelOf('origin, up', Role.PARENT, hierarchy)).toBe(1);
    expect(levelOf('steps, example', Role.CHILD, hierarchy)).toBe(-1);
    expect(levelOf('origin, source', Role.PARENT, hierarchy)).toBe(0);
  });

  it('normalises the definition like hierarchyLowerCase (trim, lower case, space → hyphen)', () => {
    const spaced: LevelHierarchy = { abstract: ['part-of'], concrete: ['next-level-detail'] };
    expect(levelOf(' Part Of ', Role.PARENT, spaced)).toBe(1);
    expect(levelOf('Next Level Detail', Role.CHILD, spaced)).toBe(-1);
    expect(normalizeFieldName('  Part Of ')).toBe('part-of');
    expect(splitTypeDefinition(' Part Of ,up,, ')).toEqual(['part-of', 'up']);
  });

  it('takes the sign from the role: a parent linked by a Down field written on the parent is still +1', () => {
    const both: LevelHierarchy = { abstract: ['up'], concrete: ['down'] };
    expect(levelOf('down', Role.PARENT, both)).toBe(1);
    expect(levelOf('up', Role.CHILD, both)).toBe(-1);
  });

  it('keeps friends and file/tag trees on the ground even when the field is in Up/Down', () => {
    expect(levelOf('up', Role.LEFT, hierarchy)).toBe(0);
    expect(levelOf('example', Role.RIGHT, hierarchy)).toBe(0);
    expect(levelOf('file-tree', Role.PARENT, hierarchy)).toBe(0);
    expect(levelOf('tag-tree', Role.CHILD, hierarchy)).toBe(0);
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

  it('orders depth north → centre band → south for the 8 notes, independent of level', () => {
    const projected = notes.map((note) => ({
      title: note.title,
      band: note.center.y < 0 ? 'north' : note.center.y > 0 ? 'south' : 'center',
      ...project(note.center, levelOfNote(note), params),
    }));
    const bandsInDepthOrder = [...projected].sort((a, b) => a.depth - b.depth).map((p) => p.band);
    expect(bandsInDepthOrder).toEqual(['north', 'north', 'center', 'center', 'center', 'south', 'south', 'south']);

    for (const note of notes) {
      const levels: Level[] = [-1, 0, 1];
      const depths = levels.map((level) => project(note.center, level, params).depth);
      expect(depths[0]).toBe(depths[1]);
      expect(depths[1]).toBe(depths[2]);
    }
  });
});

describe('compressBands', () => {
  const nodeHeight = 40;
  const item = (y: number, height = nodeHeight): BandItem => ({ y, height });
  const bands = (): Bands<BandItem> => ({
    north: [item(-300), item(-260), item(-220)],
    center: [item(0), item(-40), item(0), item(40)],
    south: [item(200), item(240)],
  });
  const ys = (items: BandItem[]) => items.map((i) => i.y);
  const rowGaps = (items: BandItem[]) => ys(items).slice(1).map((y, i) => y - ys(items)[i]);
  // 帯をずらすと浮動小数の丸めが行ごとに変わりうるので、行間は許容誤差つきで比べる。
  const expectSameGaps = (actual: BandItem[], expected: BandItem[]) => {
    expect(rowGaps(actual).length).toBe(rowGaps(expected).length);
    rowGaps(actual).forEach((gap, i) => expect(gap).toBeCloseTo(rowGaps(expected)[i], 9));
  };

  it('shrinks only the gap between bands to depthScale and keeps the row spacing inside a band', () => {
    const out = compressBands(bands(), 0.38);

    // 北: 最下端 -200、中心の最上端 -60 → 隙間 140 → 53.2 に。帯全体を 86.8 下げる。
    expect(ys(out.north)[0]).toBeCloseTo(-213.2, 6);
    expect(ys(out.north)[1]).toBeCloseTo(-173.2, 6);
    expect(ys(out.north)[2]).toBeCloseTo(-133.2, 6);
    // 南: 中心の最下端 60、南の最上端 180 → 隙間 120 → 45.6 に。帯全体を 74.4 上げる。
    expect(ys(out.south)[0]).toBeCloseTo(125.6, 6);
    expect(ys(out.south)[1]).toBeCloseTo(165.6, 6);
    // 中心の帯はそのまま。
    expect(ys(out.center)).toEqual([0, -40, 0, 40]);

    expectSameGaps(out.north, bands().north);
    expectSameGaps(out.south, bands().south);
    rowGaps(out.north).forEach((gap) => expect(gap).toBeCloseTo(nodeHeight, 9));
  });

  it('keeps the row spacing of a 12-parent / 12-child fixture (4 rows each, 3 columns)', () => {
    const rows = (origoY: number) => [0, 1, 2, 3].flatMap((row) => [0, 1, 2].map(() => item(origoY + row * nodeHeight)));
    const input: Bands<BandItem> = { north: rows(-400), center: [item(0)], south: rows(300) };
    const out = compressBands(input, 0.38);
    expectSameGaps(out.north, input.north);
    expectSameGaps(out.south, input.south);
    // 潰したあとも帯は重ならない: 北の最下端 < 中心の最上端 < 中心の最下端 < 南の最上端
    const northBottom = Math.max(...ys(out.north)) + nodeHeight / 2;
    const southTop = Math.min(...ys(out.south)) - nodeHeight / 2;
    expect(northBottom).toBeLessThan(-nodeHeight / 2);
    expect(southTop).toBeGreaterThan(nodeHeight / 2);
  });

  it('measures the centre band with its own box height (embedded centre)', () => {
    const out = compressBands({ north: [item(-100)], center: [item(150, 300)], south: [item(400)] }, 0.5);
    // 中心の箱は 0〜300。北の最下端 -80 → 隙間 80 → 40 に。南の最上端 380 → 隙間 80 → 40 に。
    expect(ys(out.north)).toEqual([-60]);
    expect(ys(out.south)).toEqual([360]);
  });

  it('is the identity at depthScale 1 and makes the bands touch at depthScale 0', () => {
    expect(compressBands(bands(), 1)).toEqual(bands());
    const touching = compressBands(bands(), 0);
    expect(Math.max(...ys(touching.north)) + nodeHeight / 2).toBeCloseTo(-60, 6);
    expect(Math.min(...ys(touching.south)) - nodeHeight / 2).toBeCloseTo(60, 6);
  });

  it('clamps depthScale outside 0..1 and ignores NaN', () => {
    expect(compressBands(bands(), 1.5)).toEqual(bands());
    expect(compressBands(bands(), Number.NaN)).toEqual(bands());
    expect(compressBands(bands(), -1)).toEqual(compressBands(bands(), 0));
  });

  it('does not move bands that already touch or overlap, nor when a band is empty', () => {
    const tight: Bands<BandItem> = { north: [item(-40)], center: [item(0)], south: [item(30)] };
    expect(compressBands(tight, 0.38)).toEqual(tight);
    const noNorth: Bands<BandItem> = { north: [], center: [item(0)], south: [item(200)] };
    expect(ys(compressBands(noNorth, 0.5).south)).toEqual([120]);
    const noCenter: Bands<BandItem> = { north: [item(-200)], center: [], south: [item(200)] };
    expect(compressBands(noCenter, 0.38)).toEqual(noCenter);
  });

  it('returns new arrays, keeps extra properties, and leaves the input untouched', () => {
    type Tagged = BandItem & { title: string };
    const input: Bands<Tagged> = {
      north: [{ y: -300, height: nodeHeight, title: '行動デザイン' }],
      center: [{ y: 0, height: nodeHeight, title: '習慣はトリガー固定で続く' }],
      south: [{ y: 300, height: nodeHeight, title: '歯磨き後に腕立て' }],
    };
    const snapshot = JSON.stringify(input);
    const out = compressBands(input, 0.5);
    expect(out.north[0].title).toBe('行動デザイン');
    expect(out.north[0].y).toBe(-170);
    expect(out.south[0].title).toBe('歯磨き後に腕立て');
    expect(out.south[0].y).toBe(170);
    expect(out.north).not.toBe(input.north);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
