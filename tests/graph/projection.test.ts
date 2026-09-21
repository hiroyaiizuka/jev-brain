import { describe, expect, it } from 'vitest';
import { Role } from 'src/Types';
import { DEFAULT_VIEW_3D_SETTINGS } from 'src/constants/constants';
import {
  Level,
  LevelHierarchy,
  LevelSubject,
  Point,
  ProjectionParams,
  compareDrawOrder,
  floorOf,
  floorPlan,
  bandShift,
  friendBandShift,
  levelOf,
  FLOOR_LEVEL,
  floorDrop,
  groundGapNorthSouth,
  project,
  VerticalEntry,
  verticalRow,
  verticalSpread,
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

  it('keeps siblings on the ground regardless of the field', () => {
    // 兄弟の Neighbour は親の getChildren() 由来: 兄弟が `up:: [[親]]` と書いていれば typeDefinition は 'up'。
    expect(levelOf('up', Role.CHILD, hierarchy, { isSibling: true })).toBe(0);
    expect(levelOf('up', Role.PARENT, hierarchy, { isSibling: true })).toBe(0);
    expect(levelOf('up', Role.PARENT, hierarchy, { isSibling: false })).toBe(1);
  });

  it('gives an unresolved (virtual) page the level of its field: LevelSubject has no way to pin it to 0 (§6-5, LEV-124)', () => {
    // 未解決リンク（本人の画面の `up:: [[aaaa]]`）も Up の親。LEV-110 の「未解決は 0」は LEV-124 でやめた。
    // `Record<keyof LevelSubject, …>` なので、`isVirtual` のような逃げ道が型に戻るとこのテストがコンパイルで落ちる
    // （`Scene.addNodes` が `page.isVirtual` を渡す形も一緒に戻ってしまうため）。
    const subject: Record<keyof LevelSubject, boolean> = { isSibling: false };
    expect(levelOf('up', Role.PARENT, hierarchy, subject)).toBe(1);
    expect(levelOf('example', Role.CHILD, hierarchy, subject)).toBe(-1);
  });
});

/** 8 ノートの中心を、fixture の levelOf の結果と一緒に引く。 */
const byTitle = (title: string): Neighbour => {
  const n = neighbours.find((x) => x.title === title);
  if (!n) throw new Error(title);
  return n;
};

describe('project', () => {
  // 既定値（3d-design §6-1）と nodeHeight 60。levelHeight = 2.2 × 60 = 132。
  const nodeHeight = 60;
  const params: ProjectionParams = {
    northShearX: DEFAULT_VIEW_3D_SETTINGS.northShearX,
    northRise: DEFAULT_VIEW_3D_SETTINGS.northRise,
    upHeight: DEFAULT_VIEW_3D_SETTINGS.upHeightFactor * nodeHeight,
    downHeight: DEFAULT_VIEW_3D_SETTINGS.downHeightFactor * nodeHeight,
  };
  const upHeight = params.upHeight;
  const downHeight = params.downHeight;

  it('ships the layout the author dragged out on 2026-09-21 (3d-design §6-6, LEV-128)', () => {
    // nodeHeight 77 のとき: Up 239・Down 277・垂直軸の間隔 293・帯 300・床 547／443／116。
    expect(DEFAULT_VIEW_3D_SETTINGS).toEqual({
      northShearX: 0.4,
      northRise: 0.3,
      upHeightFactor: 3.1,
      downHeightFactor: 3.6,
      verticalGapFactor: 3.8,
      bandDistanceFactor: 3.9,
      floorNorthFactor: 7.1,
      floorSouthFactor: 5.75,
      floorMarginFactor: 1.5,
    });
  });

  it('keeps if-then プラン, the centre and 意志力で続ける on one horizontal line (same north, same level)', () => {
    const left = project(byTitle('if-then プラン').center, 0, params);
    const centre = project(centralNote, 0, params);
    const right = project(byTitle('意志力で続ける').center, 0, params);
    expect(left.y).toBe(centre.y);
    expect(right.y).toBe(centre.y);
    // 東西は水平のまま: x は 2D の横並びそのもの。
    expect([left.x, centre.x, right.x]).toEqual([-300, 0, 300]);
  });

  it('leaves the central note at the origin (the fixed point the retained embedded centre relies on)', () => {
    expect(project(centralNote, 0, params)).toEqual({ x: 0, y: 0, depth: 0 });
    expect(Object.is(project(centralNote, 0, params).depth, -0)).toBe(false);
  });

  it('sends north up-right and south down-left: a parent shears right and rises, a child shears left and sinks', () => {
    // 行動デザイン: gy −200 → north 200 → x +80, y −60。level +1 でさらに upHeight 上。
    const parent = byTitle('行動デザイン');
    expect(project(parent.center, 0, params)).toEqual({ x: -120 + 80, y: -60, depth: 200 });
    expect(project(parent.center, 1, params)).toEqual({ x: -120 + 80, y: -60 - upHeight, depth: 200 });
    // 歯磨き後に腕立て: gy 200 → north −200 → x −80, y +60。level −1 でさらに downHeight 下。
    const child = byTitle('歯磨き後に腕立て');
    expect(project(child.center, 0, params)).toEqual({ x: 0 - 80, y: 60, depth: -200 });
    expect(project(child.center, -1, params)).toEqual({ x: 0 - 80, y: 60 + downHeight, depth: -200 });
  });

  it("drops the shadows (the foot at the floor's level) of parents up-right of the east-west axis and of children down-left, whatever the floor", () => {
    for (const floor of [-1, 0] as const) {
      const axisY = project(centralNote, floor, params).y; // 中心の足元を通る東西軸
      for (const n of neighbours) {
        const foot = project(n.center, floor, params);
        const shear = foot.x - n.center.x; // 自分の 2D の x からのずれ
        if (n.role === Role.PARENT) {
          expect(shear, `${n.title} floor ${floor}`).toBeGreaterThan(0);
          expect(foot.y, `${n.title} floor ${floor}`).toBeLessThan(axisY);
        } else if (n.role === Role.CHILD) {
          expect(shear, `${n.title} floor ${floor}`).toBeLessThan(0);
          expect(foot.y, `${n.title} floor ${floor}`).toBeGreaterThan(axisY);
        } else {
          // フレンドの影は東西軸の上。
          expect(shear, `${n.title} floor ${floor}`).toBe(0);
          expect(foot.y, `${n.title} floor ${floor}`).toBe(axisY);
        }
      }
    }
  });

  it('lifts Up by upHeight and lowers Down by downHeight, straight up (LEV-128: the two are set apart)', () => {
    expect(upHeight).not.toBe(downHeight);
    for (const n of [centralNote, ...neighbours.map((x) => x.center)]) {
      const at = (level: Level) => project(n, level, params);
      expect(at(1).x).toBe(at(0).x);
      expect(at(-1).x).toBe(at(0).x);
      expect(at(0).y - at(1).y).toBeCloseTo(upHeight, 9);
      expect(at(-1).y - at(0).y).toBeCloseTo(downHeight, 9);
      expect(at(-1).y - at(1).y).toBeCloseTo(upHeight + downHeight, 9);
    }
  });

  it('uses north (−gy) as depth, independent of level, so 3D-1 fixture levels never reorder the bands', () => {
    for (const n of neighbours) {
      expect(project(n.center, n.expectedLevel, params).depth).toBe(0 - n.center.y);
      expect(project(n.center, 1, params).depth).toBe(project(n.center, -1, params).depth);
    }
  });

  it('is the identity at zero shear, zero rise and level 0, and scales linearly with the coefficients', () => {
    const flat: ProjectionParams = { northShearX: 0, northRise: 0, upHeight: 100, downHeight: 100 };
    expect(project({ x: -120, y: -200 }, 0, flat)).toEqual({ x: -120, y: 0, depth: 200 });
    expect(project({ x: -120, y: -200 }, 1, flat)).toEqual({ x: -120, y: -100, depth: 200 });
    const doubled: ProjectionParams = { ...params, northShearX: 0.8, northRise: 0.6 };
    const once = project({ x: 50, y: -100 }, 0, params);
    const twice = project({ x: 50, y: -100 }, 0, doubled);
    expect(twice.x - 50).toBeCloseTo(2 * (once.x - 50), 9);
    expect(twice.y).toBeCloseTo(2 * once.y, 9);
  });

  it('keeps the lowest possible parent row clear of the friends at the defaults and at the northRise slider minimum (0.2)', () => {
    // 2D の Layout の下限（lParents の bottom = −2·nodeHeight、最下行の中心は −3·nodeHeight）。3D ではこの上に
    // `bandShift` が「中心から最低 bandDistance」を課すので、帯はこれより中心に近づかない（LEV-128）。
    // 箱の高さは nodeHeight/2（nodeHeight = 2·(文字の高さ + 2·padding)）。友は中心と同じ y（friendBandShift 後）。
    const box = nodeHeight / 2;
    for (const northRise of [DEFAULT_VIEW_3D_SETTINGS.northRise, 0.2]) {
      const p: ProjectionParams = { ...params, northRise };
      const lowestParent = project({ x: 0, y: -3 * nodeHeight }, 0, p);
      const friend = project({ x: 0, y: 0 }, 0, p);
      expect(lowestParent.y + box / 2, String(northRise)).toBeLessThan(friend.y - box / 2);
    }
  });

  it('projects the real 2D coordinates of artifacts/3d1-e2e (nodeHeight 76) with the defaults as the design describes', () => {
    // 2D の中心（b-2d.json）。中心の行は上流の Layout の癖で半行ぶん上にずれている（中心 y −12、友 −38。friendBandShift のテストで揃える）。
    const real: ProjectionParams = { ...params, upHeight: DEFAULT_VIEW_3D_SETTINGS.upHeightFactor * 76, downHeight: DEFAULT_VIEW_3D_SETTINGS.downHeightFactor * 76 };
    const centre = project({ x: 0, y: -12 }, 0, real);
    const ifThen = project({ x: -454, y: -38 }, 0, real);
    const willpower = project({ x: 425, y: -38 }, 0, real);
    const behaviourDesign = project({ x: -118, y: -291 }, 1, real);
    const readingNote = project({ x: 118, y: -291 }, 0, real);
    const pushUps = project({ x: 280, y: 214 }, -1, real);
    expect(ifThen.x).toBeLessThan(centre.x);
    expect(willpower.x).toBeGreaterThan(centre.x);
    expect(ifThen.y).toBe(willpower.y);
    // 行動デザインが一番高く、読書メモは北の床（level 0 = 床が −1 なら 1 段上）、歯磨きは南の床。
    expect(behaviourDesign.y).toBeLessThan(readingNote.y);
    expect(readingNote.y).toBeLessThan(centre.y);
    expect(pushUps.y).toBeGreaterThan(centre.y);
    expect(behaviourDesign).toEqual({ x: -118 + 291 * 0.4, y: -291 * 0.3 - 3.1 * 76, depth: 291 });
  });
});

describe('friendBandShift', () => {
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, upHeight: 3.1 * 76, downHeight: 3.6 * 76 };

  it('moves the friends of artifacts/3d1-e2e (y −38, rowHeight 76) onto the centre row (y −12, rowHeight 24), so all three project to one line', () => {
    const centerY = -12;
    const shift = friendBandShift(centerY, 76);
    expect(shift).toBe(26);
    const centre = project({ x: 0, y: centerY }, 0, params);
    const ifThen = project({ x: -454, y: -38 + shift }, 0, params);
    const willpower = project({ x: 425, y: -38 + shift }, 0, params);
    expect(ifThen.y).toBe(centre.y);
    expect(willpower.y).toBe(centre.y);
    expect(ifThen.depth).toBe(centre.depth);
    expect(willpower.x - centre.x).toBe(425);
  });

  it('is the half row the upstream Layout leaves out, measured from the centre (embedded centre at 0: friends move down by nodeHeight/2)', () => {
    // 1 行の帯の行は origoY − rowHeight/2。友の origoY は 0 なので、中心が y にいれば y + rowHeight/2 だけ動かす。
    expect(friendBandShift(0, 76)).toBe(38);
    expect(friendBandShift(-12, 24)).toBe(0); // 中心の帯を自分に揃えても動かない
    // 3 行の友（−76, 0, +76 の行が −114, −38, +38 に置かれる）は帯ごと動いて真ん中の行が中心に乗る。
    const rows = [-114, -38, 38].map((y) => y + friendBandShift(-12, 76));
    expect(rows).toEqual([-88, -12, 64]);
  });
});

describe('verticalSpread (§6-5: Up／Down は帯を離れて中心の真上・真下)', () => {
  const gap = 300;
  // 本人の画面 docs/images/3d-feedback-two-ups-2026-09-21.png の中心（artifacts/3d1-e2e と同じ y −12、nodeHeight 76）。
  const rootCenter: Point = { x: 0, y: -12 };
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, upHeight: 3.1 * 76, downHeight: 3.6 * 76 };
  const spreadCentres = (count: number): Point[] =>
    verticalSpread(count, gap).map((dx) => ({ x: rootCenter.x + dx, y: rootCenter.y }));

  it('puts a single Up or Down straight above/below the centre (no east-west offset)', () => {
    expect(verticalSpread(1, gap)).toEqual([0]);
  });

  it('spreads several of one level evenly around the centre, one gap apart (the centring rule of Layout.place)', () => {
    expect(verticalSpread(2, gap)).toEqual([-150, 150]);
    expect(verticalSpread(3, gap)).toEqual([-300, 0, 300]);
    expect(verticalSpread(4, gap)).toEqual([-450, -150, 150, 450]);
  });

  it('places nothing for an empty level and always keeps the row centred on the centre note', () => {
    expect(verticalSpread(0, gap)).toEqual([]);
    for (const count of [1, 2, 3, 7]) {
      const offsets = verticalSpread(count, gap);
      expect(offsets.length, String(count)).toBe(count);
      expect(offsets.reduce((sum, dx) => sum + dx, 0), String(count)).toBeCloseTo(0, 9);
    }
  });

  it('truncates a non-integer count instead of centring on it (length and centre agree)', () => {
    expect(verticalSpread(2.5, gap)).toEqual(verticalSpread(2, gap));
    expect(verticalSpread(-3, gap)).toEqual([]);
  });

  it('lifts two Ups onto one horizontal line straight above the centre, with no north shear', () => {
    // 追記 2 の不具合: 2 つ目の Up が 2D の北の帯（gy −291）のまま投影され、north のぶん右上（平行四辺形の上）に出ていた。
    const centre = project(rootCenter, 0, params);
    const ups = spreadCentres(2).map((c) => project(c, 1, params));
    expect(ups[0].y).toBe(ups[1].y);
    expect(centre.y - ups[0].y).toBeCloseTo(params.upHeight, 9);
    expect(ups.map((u) => u.x - centre.x)).toEqual([-150, 150]);
    // north が中心と同じなので描画順（depth）も中心の行と同じで、東西のずれ込みは 0。
    expect(ups.map((u) => u.depth)).toEqual([centre.depth, centre.depth]);
  });

  it('hangs a single Down straight below the centre, on the same screen x', () => {
    const centre = project(rootCenter, 0, params);
    const [down] = spreadCentres(1).map((c) => project(c, -1, params));
    expect(down.x).toBe(centre.x);
    expect(down.y - centre.y).toBeCloseTo(params.downHeight, 9);
    expect(down.depth).toBe(centre.depth);
  });

  it('drops the feet of Up and Down onto the east-west axis of the floor cross (the centre row)', () => {
    // 柱の足元は `project(center, FLOOR_LEVEL, params)`。中心と同じ north なので床の十字の東西の線に乗る。
    const axis = project(rootCenter, FLOOR_LEVEL, params);
    for (const centre of [...spreadCentres(2), ...spreadCentres(3)]) {
      const foot = project(centre, FLOOR_LEVEL, params);
      expect(foot.y).toBe(axis.y);
      // 東西のずれ込みは中心の行と同じ（帯の north が乗らない）ので、足元の間隔は gap のまま。
      expect(foot.x - centre.x).toBeCloseTo(axis.x - rootCenter.x, 9);
    }
  });
});

describe('verticalRow (§6-5: 帯から中心の行へ移すのはどのノードか)', () => {
  // artifacts/3d2-vertical-e2e の 2D（nodeHeight 76、中心 y −12）。北の帯は 2 列 2 行、南の帯は 3 列 1 行。
  const rootCenter: Point = { x: 0, y: -12 };
  // 垂直軸の間隔は設定 `verticalGapFactor × nodeHeight`（LEV-128）。帯の columnWidth はもう使わない
  const gap = 236;
  const up = (x: number, y: number): VerticalEntry => ({ level: 1, center: { x, y } });
  const down = (x: number, y: number): VerticalEntry => ({ level: -1, center: { x, y } });
  const ground = (x: number, y: number): VerticalEntry => ({ level: 0, center: { x, y } });

  it('leaves level 0 where the 2D band put it (the floor parallelogram keeps exactly these)', () => {
    const entries = [ground(118, -291), ground(-454, -38), ground(425, -38), ground(0, -12)];
    expect(verticalRow(entries, rootCenter, gap)).toEqual(entries.map((e) => e.center));
  });

  it('moves the Ups of the real fixture onto the centre row, centred on the centre note', () => {
    // 実機の 2D（artifacts/3d2-vertical-e2e）: 北の帯は 2 列 2 行で、1 行目（y −368）が 抽象化のはしご・習慣ループ、
    // 2 行目（y −291）が 行動デザイン・読書メモ：習慣の本。up の 3 つだけが中心の行へ移り、読書メモは帯に残る。
    const entries = [up(-118, -368), up(118, -368), up(-118, -291), ground(118, -291)];
    expect(verticalRow(entries, rootCenter, gap)).toEqual([
      { x: rootCenter.x - gap, y: rootCenter.y }, // 抽象化のはしご（1 行目の西）
      { x: rootCenter.x, y: rootCenter.y }, // 習慣ループ（1 行目の東）が中心の真上
      { x: rootCenter.x + gap, y: rootCenter.y }, // 行動デザイン（2 行目）
      { x: 118, y: -291 },
    ]);
  });

  it('reads the band north to south, then west to east, so a two-row band keeps a stable east-west order', () => {
    // 5 つの Up が 3 列 2 行（行 0: A B C、行 1: D _ E）に置かれた場合。行優先で A B C D E と並ぶ。
    const rows = [up(-236, -368), up(0, -368), up(236, -368), up(-236, -291), up(236, -291)];
    const xs = verticalRow(rows, rootCenter, gap).map((c) => c.x);
    expect(xs).toEqual([-2 * gap, -gap, 0, gap, 2 * gap]);
    expect(verticalRow(rows, rootCenter, gap).every((c) => c.y === rootCenter.y)).toBe(true);
  });

  it('spreads Up and Down independently, both with the same gap', () => {
    const entries = [up(-118, -291), up(118, -291), down(-280, 214), down(0, 214), down(280, 214)];
    expect(verticalRow(entries, rootCenter, gap)).toEqual([
      { x: -gap / 2, y: rootCenter.y },
      { x: gap / 2, y: rootCenter.y },
      { x: -gap, y: rootCenter.y },
      { x: 0, y: rootCenter.y },
      { x: gap, y: rootCenter.y },
    ]);
  });

  it('puts the middle of an odd group exactly on the centre note (one foot, one shadow — Scene dedupes)', () => {
    const entries = [up(-118, -291), up(0, -291), up(118, -291)];
    expect(verticalRow(entries, rootCenter, gap)[1]).toEqual({ ...rootCenter });
  });

  it('never touches the input centres (Scene keeps the 2D centres for the floor plan)', () => {
    const entries = [up(-118, -291), ground(118, -291)];
    const before = JSON.stringify(entries);
    verticalRow(entries, rootCenter, gap);
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe('floorOf (最下段。level 別の色の基準で、描く床は FLOOR_LEVEL)', () => {
  it('is the lowest level on screen, starting from the centre (0) so it is never above 0 and is 0 when empty', () => {
    expect(floorOf([])).toBe(0);
    expect(floorOf([0, 0])).toBe(0);
    expect(floorOf([1, 0])).toBe(0);
    expect(floorOf([1])).toBe(0);
    expect(floorOf([1, 0, -1])).toBe(-1);
    expect(floorOf([-1])).toBe(-1);
    expect(floorOf(neighbours.map((n) => n.expectedLevel))).toBe(-1);
  });
});

describe('compareDrawOrder', () => {
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, upHeight: 132, downHeight: 132 };

  it('sorts far (depth large) to near, so the north band is drawn first and the south band last, whatever the levels', () => {
    const points = [centralNote, ...neighbours.map((n) => n.center)];
    const projected = points.map((p, i) => project(p, ([1, -1, 0][i % 3]) as Level, params));
    const ordered = [...projected].sort(compareDrawOrder);
    expect(ordered.map((p) => p.depth)).toEqual([200, 200, 0, 0, 0, -200, -200, -200]);
    // 同じ north なら画面の x の小さい順（西から）。
    expect(ordered.map((p) => p.x)).toEqual([-40, 200, -300, 0, 300, -230, -80, 70]);
  });

  it('orders the real 2D coordinates of artifacts/3d1-e2e parents → friends → centre → children', () => {
    const real: [string, Point][] = [
      ['習慣はトリガー固定で続く', { x: 0, y: -12 }],
      ['行動デザイン', { x: -118, y: -291 }],
      ['読書メモ：習慣の本', { x: 118, y: -291 }],
      ['朝のルーティン手順', { x: 0, y: 214 }],
      ['歯磨き後に腕立て', { x: 280, y: 214 }],
      ['9月20日 朝ランの記録', { x: -280, y: 214 }],
      ['if-then プラン', { x: -454, y: -38 }],
      ['意志力で続ける', { x: 425, y: -38 }],
    ];
    const titles = real
      .map(([title, p]) => ({ title, projected: project(p, 0, params) }))
      .sort((a, b) => compareDrawOrder(a.projected, b.projected))
      .map(({ title }) => title);
    expect(titles).toEqual([
      '行動デザイン', '読書メモ：習慣の本',
      'if-then プラン', '意志力で続ける',
      '習慣はトリガー固定で続く',
      '9月20日 朝ランの記録', '朝のルーティン手順', '歯磨き後に腕立て',
    ]);
  });

  it('returns 0 only for the same screen point and depth, and is antisymmetric', () => {
    const at = (x: number, y: number, depth: number) => ({ x, y, depth });
    expect(compareDrawOrder(at(1, 2, 3), at(1, 2, 3))).toBe(0);
    expect(Math.sign(compareDrawOrder(at(0, 0, 10), at(0, 0, -10)))).toBe(-1);
    expect(Math.sign(compareDrawOrder(at(0, 0, -10), at(0, 0, 10)))).toBe(1);
    expect(Math.sign(compareDrawOrder(at(-5, 0, 0), at(5, 0, 0)))).toBe(-1);
  });
});

describe('floorPlan (Scene の床が使う純関数、3d-design §6-2)', () => {
  // artifacts/3d1-e2e の 2D の中心（友は friendBandShift 後で中心と同じ y −12）= 全ノードの影の足元。nodeHeight 76 が余白とグリッド間隔。
  const nodeHeight = 76;
  const origin: Point = { x: 0, y: -12 };
  const feet: Point[] = [
    origin,
    { x: -118, y: -291 }, { x: 118, y: -291 }, // 親
    { x: -454, y: -12 }, { x: 425, y: -12 }, // 友（東西軸の上）
    { x: 0, y: 214 }, { x: 280, y: 214 }, { x: -280, y: 214 }, // 子
  ];

  it('is the smallest rectangle around the feet plus one nodeHeight on every side (the shadows all fit, nothing more)', () => {
    const plan = floorPlan(feet, origin, nodeHeight);
    expect(plan.bounds).toEqual({ minX: -454 - 76, maxX: 425 + 76, minY: -291 - 76, maxY: 214 + 76 });
    for (const foot of feet) {
      expect(foot.x).toBeGreaterThanOrEqual(plan.bounds.minX + nodeHeight);
      expect(foot.x).toBeLessThanOrEqual(plan.bounds.maxX - nodeHeight);
      expect(foot.y).toBeGreaterThanOrEqual(plan.bounds.minY + nodeHeight);
      expect(foot.y).toBeLessThanOrEqual(plan.bounds.maxY - nodeHeight);
    }
  });

  it("puts the cross through the central note's foot, so on screen the friends' shadows sit on its east-west axis, parents' above-right, children's below-left", () => {
    const plan = floorPlan(feet, origin, nodeHeight);
    expect(plan.origin).toEqual(origin);
    expect(plan.origin).not.toBe(origin);
    // 東西軸 = origin.y の線（W から E まで）、南北軸 = origin.x の線（N から S まで）。
    expect(plan.compass.west.y).toBe(origin.y);
    expect(plan.compass.east.y).toBe(origin.y);
    expect(plan.compass.north.x).toBe(origin.x);
    expect(plan.compass.south.x).toBe(origin.x);
    // 床（中心の段）に投影した東西軸は画面で水平。友の足元はその上、親は上（北）、子は下（南）。
    const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, upHeight: 2.2 * nodeHeight, downHeight: 2.2 * nodeHeight };
    const axis = (x: number) => project({ x, y: plan.origin.y }, FLOOR_LEVEL, params);
    expect(axis(plan.bounds.minX).y).toBe(axis(plan.bounds.maxX).y);
    const screenY = (foot: Point) => project(foot, FLOOR_LEVEL, params).y;
    expect(feet.slice(0, 5).map(screenY)).toEqual([axis(0).y, axis(0).y - 291 * 0.3 + 12 * 0.3, axis(0).y - 291 * 0.3 + 12 * 0.3, axis(0).y, axis(0).y]);
    for (const child of feet.slice(5)) expect(screenY(child)).toBeGreaterThan(axis(0).y);
  });

  it('spaces the grid one nodeHeight apart from the cross, inside the floor, leaving out the two lines the cross already draws', () => {
    const plan = floorPlan(feet, origin, nodeHeight);
    expect(plan.columnXs).toEqual([-456, -380, -304, -228, -152, -76, 76, 152, 228, 304, 380, 456]);
    expect(plan.rowYs).toEqual([-316, -240, -164, -88, 64, 140, 216]);
    expect(plan.columnXs).not.toContain(origin.x);
    expect(plan.rowYs).not.toContain(origin.y);
    for (const x of plan.columnXs) {
      expect(x).toBeGreaterThan(plan.bounds.minX);
      expect(x).toBeLessThan(plan.bounds.maxX);
      expect(Number.isInteger((x - origin.x) / nodeHeight)).toBe(true);
    }
    for (const y of plan.rowYs) {
      expect(y).toBeGreaterThan(plan.bounds.minY);
      expect(y).toBeLessThan(plan.bounds.maxY);
      expect(Number.isInteger((y - origin.y) / nodeHeight)).toBe(true);
    }
  });

  it('puts N/S/W/E at the ends of the cross, half a margin outside the edge by default', () => {
    const plan = floorPlan(feet, origin, nodeHeight);
    expect(plan.compass).toEqual({
      north: { x: 0, y: -367 - 38 },
      south: { x: 0, y: 290 + 38 },
      west: { x: -530 - 38, y: -12 },
      east: { x: 501 + 38, y: -12 },
    });
  });

  it('takes the compass gap per side so Scene can undo the northRise foreshortening and set N and S apart (LEV-130)', () => {
    const northRise = 0.3;
    // Scene が渡す形: 画面で W／E 38px、N 18px、S 24px。南北は northRise で割って地面の距離にする。
    const plan = floorPlan(feet, origin, nodeHeight, nodeHeight, { x: 38, north: 18 / northRise, south: 24 / northRise });
    const params: ProjectionParams = { northShearX: 0.4, northRise, upHeight: 2.2 * nodeHeight, downHeight: 2.2 * nodeHeight };
    const screenGap = (edge: Point, label: Point) =>
      Math.abs(project(edge, FLOOR_LEVEL, params).y - project(label, FLOOR_LEVEL, params).y);
    expect(screenGap({ x: 0, y: plan.bounds.minY }, plan.compass.north)).toBeCloseTo(18, 9);
    expect(screenGap({ x: 0, y: plan.bounds.maxY }, plan.compass.south)).toBeCloseTo(24, 9);
    const edgeW = project({ x: plan.bounds.minX, y: -12 }, FLOOR_LEVEL, params);
    const labelW = project(plan.compass.west, FLOOR_LEVEL, params);
    expect(edgeW.x - labelW.x).toBeCloseTo(38, 9);
  });

  it('covers the width of the boxes east-west (a wide friend never hides the edge or W/E) but only the feet north-south', () => {
    const wide = floorPlan([{ x: -454, y: -12, width: 300 }, { x: 0, y: 214, width: 300 }], origin, nodeHeight);
    expect(wide.bounds.minX).toBe(-454 - 150 - 76);
    expect(wide.bounds.maxX).toBe(0 + 150 + 76);
    expect(wide.bounds.minY).toBe(-12 - 76);
    expect(wide.bounds.maxY).toBe(214 + 76);
    expect(wide.compass.west.x).toBeLessThan(-454 - 150);
  });

  it('leaves out grid lines that would lie on the outline, and draws none when the floor is only the margin around the origin', () => {
    // 足元が余白の端にちょうど乗る: x = 76 の線は内側、−76 と 152 は外周と重なるので描かない
    const edge = floorPlan([{ x: 76, y: 0 }], { x: 0, y: 0 }, 76);
    expect(edge.bounds).toEqual({ minX: -76, maxX: 152, minY: -76, maxY: 76 });
    expect(edge.columnXs).toEqual([76]);
    expect(edge.rowYs).toEqual([]);
    const alone = floorPlan([], { x: 10, y: -20 }, 50);
    expect(alone.bounds).toEqual({ minX: -40, maxX: 60, minY: -70, maxY: 30 });
    expect(alone.columnXs).toEqual([]);
    expect(alone.rowYs).toEqual([]);
    expect(alone.compass.north).toEqual({ x: 10, y: -95 });
  });

  it('keeps the cross inside the floor even when the origin is not among the feet, and takes a separate margin', () => {
    const plan = floorPlan([{ x: 300, y: 300 }], { x: 0, y: 0 }, 100, 10);
    expect(plan.bounds).toEqual({ minX: -10, maxX: 310, minY: -10, maxY: 310 });
    expect(plan.columnXs).toEqual([100, 200, 300]);
    expect(plan.compass.east).toEqual({ x: 315, y: 0 });
  });

  it('draws no grid for a non-positive spacing', () => {
    for (const spacing of [0, -76, Number.NaN]) {
      const plan = floorPlan(feet, origin, spacing, 76);
      expect(plan.columnXs).toEqual([]);
      expect(plan.rowYs).toEqual([]);
    }
  });
});

describe('floorPlan の左右の釣り合い (3d-design §6-2、LEV-135)', () => {
  const origin: Point = { x: 0, y: -12 };
  const shear = 0.4;
  const params: ProjectionParams = { northShearX: shear, northRise: 0.3, upHeight: 238, downHeight: 277 };
  // 実機と同じ形: 足元は中心の行に並び、床は奥 546・手前 443 まで広がる。
  const feet = [{ x: -293, y: -12, width: 150 }, { x: 0, y: -12, width: 330 }, { x: 293, y: -12, width: 150 }];
  const reach = { north: 546, south: 443 };
  const gap = { x: 46, north: 60, south: 80 };

  /** 投影後の床の左端（南西の角）と右端（北東の角）。 */
  const edges = (plan: ReturnType<typeof floorPlan>) => ({
    left: project({ x: plan.bounds.minX, y: plan.bounds.maxY }, FLOOR_LEVEL, params).x,
    right: project({ x: plan.bounds.maxX, y: plan.bounds.minY }, FLOOR_LEVEL, params).x,
  });

  it('leaves the centre of the floor off to one side when the shear is not given (the old behaviour)', () => {
    const plan = floorPlan(feet, origin, 77, 115, gap, reach);
    const { left, right } = edges(plan);
    const centre = project(origin, FLOOR_LEVEL, params).x;
    expect(centre - left).toBeLessThan(right - centre); // 床が右に伸びて中心が左寄りに見える
  });

  it('widens the floor so the projected left and right edges are the same distance from the centre note', () => {
    const plan = floorPlan(feet, origin, 77, 115, gap, reach, shear);
    const { left, right } = edges(plan);
    const centre = project(origin, FLOOR_LEVEL, params).x;
    expect(centre - left).toBeCloseTo(right - centre, 9);
  });

  it('only ever widens: every foot and box stays inside the floor', () => {
    const before = floorPlan(feet, origin, 77, 115, gap, reach);
    const after = floorPlan(feet, origin, 77, 115, gap, reach, shear);
    expect(after.bounds.minX).toBeLessThanOrEqual(before.bounds.minX);
    expect(after.bounds.maxX).toBeGreaterThanOrEqual(before.bounds.maxX);
    for (const foot of feet) {
      expect(after.bounds.minX).toBeLessThan(foot.x - foot.width / 2);
      expect(after.bounds.maxX).toBeGreaterThan(foot.x + foot.width / 2);
    }
  });

  it('widens to the east instead when the floor reaches further in front than behind', () => {
    const deepFront = floorPlan(feet, origin, 77, 115, gap, { north: 300, south: 700 }, shear);
    const plain = floorPlan(feet, origin, 77, 115, gap, { north: 300, south: 700 });
    expect(deepFront.bounds.maxX).toBeGreaterThan(plain.bounds.maxX);
    expect(deepFront.bounds.minX).toBe(plain.bounds.minX);
  });

  it('keeps the cross and the compass on the centre note (only the outline moves)', () => {
    const plan = floorPlan(feet, origin, 77, 115, gap, reach, shear);
    expect(plan.origin).toEqual(origin);
    expect(plan.compass.north.x).toBe(origin.x);
    expect(plan.compass.south.x).toBe(origin.x);
    expect(plan.compass.west.y).toBe(origin.y);
    expect(plan.compass.east.y).toBe(origin.y);
  });
});

describe('groundGapNorthSouth (画面の距離を 2D の地面距離に戻す、LEV-130)', () => {
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, upHeight: 100, downHeight: 100 };

  it('undoes the northRise foreshortening, so a screen gap lands as that many pixels after projection', () => {
    const ground = groundGapNorthSouth(18, params);
    expect(ground).toBeCloseTo(60, 9);
    const edge = project({ x: 0, y: 0 }, FLOOR_LEVEL, params);
    const label = project({ x: 0, y: 0 - ground }, FLOOR_LEVEL, params);
    expect(edge.y - label.y).toBeCloseTo(18, 9);
  });

  it('falls back to the screen distance when northRise is 0 (a hand-edited setting), instead of Infinity', () => {
    expect(groundGapNorthSouth(18, { ...params, northRise: 0 })).toBe(18);
    expect(groundGapNorthSouth(18, { ...params, northRise: -1 })).toBe(18);
  });
});

describe('floorPlan の最低の広がり (3d-design §6-6、LEV-128)', () => {
  const origin: Point = { x: 0, y: 0 };

  it('reaches at least `reach` north and south of the centre, so the floor is not all behind the notes', () => {
    // Up／Down が帯を離れると南に足元が無い: 足元の最小外接だけでは手前に奥行きが出ない。
    const plan = floorPlan([{ x: 0, y: -100 }], origin, 50, 50, undefined, { north: 400, south: 300 });
    expect(plan.bounds.minY).toBe(-400);
    expect(plan.bounds.maxY).toBe(300);
  });

  it('lets the feet win when they are further out than the reach', () => {
    const plan = floorPlan([{ x: 0, y: -900 }, { x: 0, y: 500 }], origin, 50, 50, undefined, { north: 400, south: 300 });
    expect(plan.bounds.minY).toBe(-950);
    expect(plan.bounds.maxY).toBe(550);
  });

  it('is the old behaviour when no reach is given (the default is 0)', () => {
    const plan = floorPlan([{ x: 0, y: -100 }], origin, 50);
    expect(plan.bounds.minY).toBe(-150);
    expect(plan.bounds.maxY).toBe(50);
  });

  it('keeps the compass on the widened edges, not on the feet', () => {
    const plan = floorPlan([{ x: 0, y: -100 }], origin, 50, 50, { x: 25, north: 25, south: 25 }, { north: 400, south: 300 });
    expect(plan.compass.north.y).toBe(-425);
    expect(plan.compass.south.y).toBe(325);
  });
});

describe('floorDrop (床の平面を中心の段から下げる量、3d-design §6-2)', () => {
  // artifacts/3d1-e2e: nodeHeight 76、Down の深さ 3.6 × 76 = 273.6。中心の箱 54（fontSize 30）、他 44。
  // 影は LEV-128 で無くなったので、平面は床の段の最も高い箱の下端をそのまま通る。
  const nodeHeight = 76;
  const downHeight = 3.6 * nodeHeight;
  const brief = [
    { level: 0, height: 54 }, // 中心
    { level: 0, height: 44 }, { level: 0, height: 44 }, // 友
    { level: 1, height: 44 }, { level: 0, height: 44 }, // 行動デザイン、読書メモ
    { level: -1, height: 44 }, { level: -1, height: 44 }, { level: -1, height: 44 }, // Down の子
  ] as const;

  it('puts the plane at the bottom of the tallest box on the floor (the centre), so the friends sit just above it', () => {
    const drop = floorDrop(brief, nodeHeight, downHeight);
    expect(drop).toBe(54 / 2);
    // 友の下端（22）は平面（27）より上、Down の子の上端（273.6 − 22）はずっと下。
    expect(44 / 2).toBeLessThan(drop);
    expect(downHeight - 44 / 2).toBeGreaterThan(drop);
  });

  it('follows the tallest floor box whichever it is (a central font smaller than the friends does not sink them)', () => {
    expect(floorDrop([{ level: 0, height: 40 }, { level: 0, height: 44 }], nodeHeight, downHeight)).toBe(22);
  });

  it('ignores boxes taller than nodeHeight (the embedded centre) and falls back to nodeHeight when nothing is on the floor', () => {
    expect(floorDrop([{ level: 0, height: 700 }, { level: 0, height: 44 }], nodeHeight, downHeight)).toBe(22);
    expect(floorDrop([{ level: 0, height: 700 }], nodeHeight, downHeight)).toBe(38);
    expect(floorDrop([], nodeHeight, downHeight)).toBe(38);
    expect(floorDrop([{ level: 1, height: 44 }], nodeHeight, downHeight)).toBe(38);
  });

  it('never drops the plane below the top of a box hanging under the floor, at the slider minimum', () => {
    // downHeightFactor 1.0・compactingFactor 1.0: nodeHeight ≈ 52.5、箱 45。箱の半分（22.5）で収まる。
    expect(floorDrop([{ level: 0, height: 45 }, { level: -1, height: 45 }], 52.5, 52.5)).toBe(22.5);
    // 吊る箱が高いと天井（downHeight − 箱の半分）のほうが低くなり、そちらで止まる。
    const clamped = floorDrop([{ level: 0, height: 45 }, { level: -1, height: 75 }], 52.5, 52.5);
    expect(clamped).toBe(52.5 - 37.5);
    expect(clamped).toBeLessThan(45 / 2);
    // 天井が負なら下げない。
    expect(floorDrop([{ level: 0, height: 45 }, { level: -1, height: 200 }], 52.5, 52.5)).toBe(0);
  });
});

describe('bandShift (床に残る Parents／Children の帯を中心から離す、3d-design §6-6)', () => {
  // artifacts/3d2-vertical-e2e の 2D: 中心 y −12、北の帯は y −291（内側の行）、南の帯は y 214。
  const centerY = -12;
  const distance = 300;

  it('moves the innermost row of each band to `distance` from the centre', () => {
    expect(-291 + bandShift(centerY, -291, distance, -1)).toBe(centerY - distance);
    expect(214 + bandShift(centerY, 214, distance, 1)).toBe(centerY + distance);
  });

  it('keeps the rest of the band at its 2D spacing (the whole band moves by one amount)', () => {
    // 北の帯が 2 行（y −368 と −291）: 内側の −291 が基準で、外側の行も同じ量だけ動く。
    const shift = bandShift(centerY, -291, distance, -1);
    expect(-291 + shift).toBe(centerY - distance);
    expect(-368 + shift).toBe(centerY - distance - 77);
  });

  it('leaves a band that already reaches further alone (the embedded centre pushes its bands out)', () => {
    // 埋め込みの中心では Layout が `heightInCenter` ぶん帯を押し出す。そこへ一定距離を当てはめると帯が箱の中に入る。
    expect(bandShift(centerY, -600, distance, -1)).toBe(0);
    expect(bandShift(centerY, 900, distance, 1)).toBe(0);
    // 届いていない帯だけを、ちょうど届くところまで動かす。
    expect(-100 + bandShift(centerY, -100, distance, -1)).toBe(centerY - distance);
    expect(100 + bandShift(centerY, 100, distance, 1)).toBe(centerY + distance);
  });

  it('is measured on the 2D ground, so the screen distance is northRise times smaller', () => {
    // 本人の「parents 300」は壁打ちのページと同じ 2D の距離。画面では 300 × northRise（0.3）＝ 90px 上にくる。
    const shifted = -291 + bandShift(centerY, -291, distance, -1);
    expect(project({ x: 0, y: shifted }, 0, { northShearX: 0.4, northRise: 0.3, upHeight: 1, downHeight: 1 }).y)
      .toBeCloseTo(project({ x: 0, y: centerY }, 0, { northShearX: 0.4, northRise: 0.3, upHeight: 1, downHeight: 1 }).y - distance * 0.3, 9);
  });
});
