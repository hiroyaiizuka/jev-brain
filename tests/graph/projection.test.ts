import { describe, expect, it } from 'vitest';
import { Layout } from 'src/graph/Layout';
import type { Node } from 'src/graph/Node';
import { LayoutSpecification, Role } from 'src/Types';
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
  isOnAxis,
  limitByAxis,
  bandShift,
  BandGrid,
  regridBand,
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
    heightShearX: DEFAULT_VIEW_3D_SETTINGS.heightShearX,
    upHeight: DEFAULT_VIEW_3D_SETTINGS.upHeightFactor * nodeHeight,
    downHeight: DEFAULT_VIEW_3D_SETTINGS.downHeightFactor * nodeHeight,
    rowLift: DEFAULT_VIEW_3D_SETTINGS.rowLiftFactor * nodeHeight,
  };
  const upHeight = params.upHeight;
  const downHeight = params.downHeight;

  it('ships the layout the author dragged out on 2026-09-21 (3d-design §6-6, LEV-128)', () => {
    // nodeHeight 77 のとき: Up 239・Down 283（本人の指定で 5px 下げた）・垂直軸の間隔 293・帯 300・床 547／443／116。
    // 高さの傾き 0.64 は本人が実機で決めた（LEV-137。Up 239px なら東へ 153px）。
    expect(DEFAULT_VIEW_3D_SETTINGS).toEqual({
      northShearX: 0.4,
      northRise: 0.3,
      heightShearX: 0.64,
      upHeightFactor: 3.1,
      downHeightFactor: 3.67,
      verticalGapFactor: 3.8,
      verticalColumns: 5,
      rowLiftFactor: 1.2,
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
    // 行動デザイン: gy −200 → north 200 → x +80, y −60。level +1 でさらに upHeight 上、東へ upHeight × heightShearX（LEV-137）。
    const parent = byTitle('行動デザイン');
    const lean = DEFAULT_VIEW_3D_SETTINGS.heightShearX;
    expect(project(parent.center, 0, params)).toEqual({ x: -120 + 80, y: -60, depth: 200 });
    expect(project(parent.center, 1, params)).toEqual({ x: -120 + 80 + upHeight * lean, y: -60 - upHeight, depth: 200 });
    // 歯磨き後に腕立て: gy 200 → north −200 → x −80, y +60。level −1 でさらに downHeight 下、西へ downHeight × heightShearX。
    const child = byTitle('歯磨き後に腕立て');
    expect(project(child.center, 0, params)).toEqual({ x: 0 - 80, y: 60, depth: -200 });
    expect(project(child.center, -1, params)).toEqual({ x: 0 - 80 - downHeight * lean, y: 60 + downHeight, depth: -200 });
  });

  it('puts the feet of parents up-right of the east-west axis and of children down-left (the floor plane is level 0)', () => {
    // 足元は床の平面（`FLOOR_LEVEL`）への投影なので、高さの傾き（LEV-137）は効かない。
    // Scene はこの点で床の広さを決める。
    const axisY = project(centralNote, FLOOR_LEVEL, params).y; // 中心の足元を通る東西軸
    for (const n of neighbours) {
      const foot = project(n.center, FLOOR_LEVEL, params);
      const shear = foot.x - n.center.x; // 自分の 2D の x からのずれ
      if (n.role === Role.PARENT) {
        expect(shear, n.title).toBeGreaterThan(0);
        expect(foot.y, n.title).toBeLessThan(axisY);
      } else if (n.role === Role.CHILD) {
        expect(shear, n.title).toBeLessThan(0);
        expect(foot.y, n.title).toBeGreaterThan(axisY);
      } else {
        // フレンドの足元は東西軸の上。
        expect(shear, n.title).toBe(0);
        expect(foot.y, n.title).toBe(axisY);
      }
    }
  });

  it('lifts Up by upHeight and lowers Down by downHeight, leaning east with the floor (LEV-128, LEV-137)', () => {
    expect(upHeight).not.toBe(downHeight);
    const lean = DEFAULT_VIEW_3D_SETTINGS.heightShearX;
    for (const n of [centralNote, ...neighbours.map((x) => x.center)]) {
      const at = (level: Level) => project(n, level, params);
      // 高さは真上ではなく、床と同じ向きに倒れる: 上は東へ、下は西へ。
      expect(at(1).x - at(0).x).toBeCloseTo(upHeight * lean, 9);
      expect(at(-1).x - at(0).x).toBeCloseTo(-downHeight * lean, 9);
      expect(at(0).y - at(1).y).toBeCloseTo(upHeight, 9);
      expect(at(-1).y - at(0).y).toBeCloseTo(downHeight, 9);
      expect(at(-1).y - at(1).y).toBeCloseTo(upHeight + downHeight, 9);
    }
  });

  it('keeps the height straight up when the height shear is 0 (the projection before LEV-137)', () => {
    const upright: ProjectionParams = { ...params, heightShearX: 0 };
    for (const n of [centralNote, ...neighbours.map((x) => x.center)]) {
      expect(project(n, 1, upright).x).toBe(project(n, 0, upright).x);
      expect(project(n, -1, upright).x).toBe(project(n, 0, upright).x);
    }
  });

  it('is parallel to the floor\'s north-south lines only when heightShearX = northShearX / northRise', () => {
    // 床の南北の線は north 1 につき東へ northShearX・上へ northRise、つまり画面で (northShearX, −northRise) の向き。
    // 箱と足元を結ぶ線は (heightShearX, −1)。平行になるのは heightShearX = northShearX / northRise のとき。
    const parallel = params.northShearX / params.northRise;
    const matched: ProjectionParams = { ...params, heightShearX: parallel };
    const foot = project(centralNote, 0, matched);
    const top = project(centralNote, 1, matched);
    const northLine = { x: params.northShearX, y: -params.northRise };
    const upLine = { x: top.x - foot.x, y: top.y - foot.y };
    // 外積 0 ＝ 平行。
    expect(upLine.x * northLine.y - upLine.y * northLine.x).toBeCloseTo(0, 6);
    // 既定の 0.64 はその手前（1.33）なので平行ではない。本人が画面で選んだ値（LEV-137）。
    expect(DEFAULT_VIEW_3D_SETTINGS.heightShearX).toBeLessThan(parallel);
  });

  it('uses north (−gy) as depth, independent of level, so 3D-1 fixture levels never reorder the bands', () => {
    for (const n of neighbours) {
      expect(project(n.center, n.expectedLevel, params).depth).toBe(0 - n.center.y);
      expect(project(n.center, 1, params).depth).toBe(project(n.center, -1, params).depth);
    }
  });

  it('is the identity at zero shear, zero rise and level 0, and scales linearly with the coefficients', () => {
    const flat: ProjectionParams = { northShearX: 0, northRise: 0, heightShearX: 0, upHeight: 100, downHeight: 100, rowLift: 60 };
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
    expect(behaviourDesign).toEqual({ x: -118 + 291 * 0.4 + 3.1 * 76 * 0.64, y: -291 * 0.3 - 3.1 * 76, depth: 291 });
  });
});

describe('compareDrawOrder と高さの傾き（LEV-137）', () => {
  const nodeHeight = 77;
  const params: ProjectionParams = {
    northShearX: DEFAULT_VIEW_3D_SETTINGS.northShearX,
    northRise: DEFAULT_VIEW_3D_SETTINGS.northRise,
    heightShearX: DEFAULT_VIEW_3D_SETTINGS.heightShearX,
    upHeight: DEFAULT_VIEW_3D_SETTINGS.upHeightFactor * nodeHeight,
    downHeight: DEFAULT_VIEW_3D_SETTINGS.downHeightFactor * nodeHeight,
    rowLift: DEFAULT_VIEW_3D_SETTINGS.rowLiftFactor * nodeHeight,
  };
  const centre: Point = { x: 0, y: -12 };

  it('keeps depth on north only, so the lean never reorders the bands', () => {
    // 高さの傾きは x にしか効かない。奥行き（depth）は north のままなので、帯の前後関係は変わらない。
    for (const level of [-1, 0, 1] as const) {
      expect(project(centre, level, params).depth).toBe(project(centre, 0, params).depth);
    }
    const north = project({ x: 0, y: -300 }, 0, params);
    const south = project({ x: 0, y: 300 }, 1, params);
    expect(compareDrawOrder(north, south)).toBeLessThan(0); // 北が先（奥）
  });

  it('orders the centre row by the projected x, which the lean changes (Up east, Down west)', () => {
    // 中心の行に集まる中心・Up・Down は depth が同じなので、描画順は投影後の x で決まる。
    const up = project(centre, 1, params);
    const down = project(centre, -1, params);
    const flat = project(centre, 0, params);
    expect(down.x).toBeLessThan(flat.x);
    expect(flat.x).toBeLessThan(up.x);
    expect([up, flat, down].sort(compareDrawOrder).map((p) => Math.round(p.x)))
      .toEqual([down, flat, up].map((p) => Math.round(p.x)));
  });
});

describe('friendBandShift', () => {
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, heightShearX: 0, upHeight: 3.1 * 76, downHeight: 3.6 * 76, rowLift: 92 };

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
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, heightShearX: 0, upHeight: 3.1 * 76, downHeight: 3.6 * 76, rowLift: 92 };
  /** 1 行に収まるだけの列数を渡して、東西のずらし量だけ取り出す（折り返しは専用の describe で見る）。 */
  const offsetsOf = (count: number): number[] =>
    verticalSpread(count, gap, Math.max(1, Math.trunc(count))).map((slot) => slot.dx);
  const spreadCentres = (count: number): Point[] =>
    offsetsOf(count).map((dx) => ({ x: rootCenter.x + dx, y: rootCenter.y }));

  it('puts a single Up or Down straight above/below the centre (no east-west offset)', () => {
    expect(offsetsOf(1)).toEqual([0]);
  });

  it('spreads several of one level evenly around the centre, one gap apart (the centring rule of Layout.place)', () => {
    expect(offsetsOf(2)).toEqual([-150, 150]);
    expect(offsetsOf(3)).toEqual([-300, 0, 300]);
    expect(offsetsOf(4)).toEqual([-450, -150, 150, 450]);
  });

  it('places nothing for an empty level and always keeps the row centred on the centre note', () => {
    expect(offsetsOf(0)).toEqual([]);
    for (const count of [1, 2, 3, 7]) {
      const offsets = offsetsOf(count);
      expect(offsets.length, String(count)).toBe(count);
      expect(offsets.reduce((sum, dx) => sum + dx, 0), String(count)).toBeCloseTo(0, 9);
    }
  });

  it('truncates a non-integer count instead of centring on it (length and centre agree)', () => {
    expect(offsetsOf(2.5)).toEqual(offsetsOf(2));
    expect(offsetsOf(-3)).toEqual([]);
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
  /** 折り返さない並びの中心だけを取り出す（行のテストは別に置く）。 */
  const centresOf = (entries: VerticalEntry[], columns = entries.length || 1): Point[] =>
    verticalRow(entries, rootCenter, gap, columns).map((p) => p.center);

  it('leaves level 0 where the 2D band put it (the floor parallelogram keeps exactly these)', () => {
    const entries = [ground(118, -291), ground(-454, -38), ground(425, -38), ground(0, -12)];
    expect(centresOf(entries)).toEqual(entries.map((e) => e.center));
  });

  it('moves the Ups of the real fixture onto the centre row, centred on the centre note', () => {
    // 実機の 2D（artifacts/3d2-vertical-e2e）: 北の帯は 2 列 2 行で、1 行目（y −368）が 抽象化のはしご・習慣ループ、
    // 2 行目（y −291）が 行動デザイン・読書メモ：習慣の本。up の 3 つだけが中心の行へ移り、読書メモは帯に残る。
    const entries = [up(-118, -368), up(118, -368), up(-118, -291), ground(118, -291)];
    expect(centresOf(entries)).toEqual([
      { x: rootCenter.x - gap, y: rootCenter.y }, // 抽象化のはしご（1 行目の西）
      { x: rootCenter.x, y: rootCenter.y }, // 習慣ループ（1 行目の東）が中心の真上
      { x: rootCenter.x + gap, y: rootCenter.y }, // 行動デザイン（2 行目）
      { x: 118, y: -291 },
    ]);
  });

  it('reads the band north to south, then west to east, so a two-row band keeps a stable east-west order', () => {
    // 5 つの Up が 3 列 2 行（行 0: A B C、行 1: D _ E）に置かれた場合。行優先で A B C D E と並ぶ。
    const rows = [up(-236, -368), up(0, -368), up(236, -368), up(-236, -291), up(236, -291)];
    const xs = centresOf(rows).map((c) => c.x);
    expect(xs).toEqual([-2 * gap, -gap, 0, gap, 2 * gap]);
    expect(centresOf(rows).every((c) => c.y === rootCenter.y)).toBe(true);
  });

  it('spreads Up and Down independently, both with the same gap', () => {
    const entries = [up(-118, -291), up(118, -291), down(-280, 214), down(0, 214), down(280, 214)];
    expect(centresOf(entries)).toEqual([
      { x: -gap / 2, y: rootCenter.y },
      { x: gap / 2, y: rootCenter.y },
      { x: -gap, y: rootCenter.y },
      { x: 0, y: rootCenter.y },
      { x: gap, y: rootCenter.y },
    ]);
  });

  it('puts the middle of an odd group exactly on the centre note (one foot, one shadow — Scene dedupes)', () => {
    const entries = [up(-118, -291), up(0, -291), up(118, -291)];
    expect(centresOf(entries)[1]).toEqual({ ...rootCenter });
  });

  it('never touches the input centres (Scene keeps the 2D centres for the floor plan)', () => {
    const entries = [up(-118, -291), ground(118, -291)];
    const before = JSON.stringify(entries);
    centresOf(entries);
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe('折り返し (§6-7、LEV-127: 上限 5 列であふれたら上・下へ積む)', () => {
  const gap = 300;
  const rootCenter: Point = { x: 0, y: -12 };
  const nodeHeight = 77;
  const params: ProjectionParams = {
    northShearX: DEFAULT_VIEW_3D_SETTINGS.northShearX,
    northRise: DEFAULT_VIEW_3D_SETTINGS.northRise,
    heightShearX: DEFAULT_VIEW_3D_SETTINGS.heightShearX,
    upHeight: DEFAULT_VIEW_3D_SETTINGS.upHeightFactor * nodeHeight,
    downHeight: DEFAULT_VIEW_3D_SETTINGS.downHeightFactor * nodeHeight,
    rowLift: DEFAULT_VIEW_3D_SETTINGS.rowLiftFactor * nodeHeight,
  };
  const ups = (n: number): VerticalEntry[] =>
    Array.from({ length: n }, (_, i) => ({ level: 1, center: { x: i * 100 - 200, y: -291 } }));

  it('ships the author\'s 5 columns and a row height well under the level height', () => {
    expect(DEFAULT_VIEW_3D_SETTINGS.verticalColumns).toBe(5);
    expect(DEFAULT_VIEW_3D_SETTINGS.rowLiftFactor).toBe(1.2);
    // 行（92px）は段（239px）の半分以下。折り返した行が「もう 1 段上」に見えないための余裕。
    expect(params.rowLift).toBeLessThan(params.upHeight / 2);
  });

  it('keeps one row up to the column count, then starts the next row', () => {
    expect(verticalSpread(5, gap, 5).map((s) => s.row)).toEqual([0, 0, 0, 0, 0]);
    expect(verticalSpread(7, gap, 5).map((s) => s.row)).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(verticalSpread(12, gap, 5).map((s) => s.row)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2]);
  });

  it('centres each row on the centre note, so a short last row is not left-aligned', () => {
    const slots = verticalSpread(7, gap, 5);
    expect(slots.slice(0, 5).map((s) => s.dx)).toEqual([-600, -300, 0, 300, 600]);
    expect(slots.slice(5).map((s) => s.dx)).toEqual([-150, 150]); // あふれた 2 つは中央揃え
  });

  it('never widens past the column count, however many there are', () => {
    for (const count of [6, 9, 12, 20]) {
      const widest = Math.max(...verticalSpread(count, gap, 5).map((s) => Math.abs(s.dx)));
      expect(widest, String(count)).toBe(600); // 5 列ぶんの半分
    }
  });

  it('stacks the extra rows up for Up and down for Down, by rowLift each', () => {
    const upRow0 = project(rootCenter, 1, params, 0);
    const upRow1 = project(rootCenter, 1, params, 1);
    const downRow0 = project(rootCenter, -1, params, 0);
    const downRow1 = project(rootCenter, -1, params, 1);
    expect(upRow0.y - upRow1.y).toBeCloseTo(params.rowLift, 9);
    expect(downRow1.y - downRow0.y).toBeCloseTo(params.rowLift, 9);
    // 高さの傾き（LEV-137）は行にも効く: 上の行は東、下の行は西へさらに倒れる。
    expect(upRow1.x - upRow0.x).toBeCloseTo(params.rowLift * params.heightShearX, 9);
    expect(downRow1.x - downRow0.x).toBeCloseTo(-params.rowLift * params.heightShearX, 9);
  });

  it('gives verticalRow the row of each node and keeps every foot on the centre row', () => {
    const placements = verticalRow(ups(7), rootCenter, gap, 5);
    expect(placements.map((p) => p.row)).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(placements.every((p) => p.center.y === rootCenter.y)).toBe(true);
    // 足元は全部中心の行なので、折り返しても床は横に伸びない。
    const feet = placements.map((p) => p.center.x);
    expect(Math.max(...feet) - Math.min(...feet)).toBe(4 * gap);
  });

  it('leaves level 0 on row 0 (the bands never wrap this way)', () => {
    const mixed: VerticalEntry[] = [
      { level: 0, center: { x: 118, y: -291 } },
      ...ups(6),
    ];
    const placements = verticalRow(mixed, rootCenter, gap, 5);
    expect(placements[0]).toEqual({ center: { x: 118, y: -291 }, row: 0 });
    expect(placements.slice(1).map((p) => p.row)).toEqual([0, 0, 0, 0, 0, 1]);
  });
});

describe('limitByAxis (§6-7、LEV-127: 垂直軸と帯で別々に切る)', () => {
  type Item = { t: string; level: Level };
  const axis = (t: string, level: Level): Item => ({ t, level });
  const levelOfItem = (i: Item) => i.level;
  const names = (items: Item[]) => items.map((i) => i.t);

  it('keeps the Up/Down that a shared cap would have pushed out (the author\'s "only 4 Downs")', () => {
    // 実機と同じ形: 子 15 件のうち先頭 8 件が帯（leads to）、あとが Down。共有の上限 12 だと Down は 4 件しか残らない。
    const children: Item[] = [
      ...Array.from({ length: 8 }, (_, i) => axis(`band${i}`, 0)),
      ...Array.from({ length: 7 }, (_, i) => axis(`down${i}`, -1)),
    ];
    expect(names(children.slice(0, 12)).filter((t) => t.startsWith('down'))).toHaveLength(4);
    const kept = limitByAxis(children, levelOfItem, { axis: 15, band: 12 });
    expect(names(kept).filter((t) => t.startsWith('down'))).toHaveLength(7);
    expect(names(kept).filter((t) => t.startsWith('band'))).toHaveLength(8);
  });

  it('never lets the axis eat the band: both keep their own cap', () => {
    const many: Item[] = [
      ...Array.from({ length: 20 }, (_, i) => axis(`up${i}`, 1)),
      ...Array.from({ length: 4 }, (_, i) => axis(`band${i}`, 0)),
    ];
    const kept = limitByAxis(many, levelOfItem, { axis: 15, band: 12 });
    expect(names(kept).filter((t) => t.startsWith('up'))).toHaveLength(15);
    expect(names(kept).filter((t) => t.startsWith('band'))).toHaveLength(4); // 帯は消えない
  });

  it('keeps the order inside each group (the axis reads 2D order, the band keeps the band order)', () => {
    const mixed: Item[] = [axis('b1', 0), axis('u1', 1), axis('b2', 0), axis('d1', -1), axis('u2', 1)];
    expect(names(limitByAxis(mixed, levelOfItem, { axis: 10, band: 10 }))).toEqual(['u1', 'd1', 'u2', 'b1', 'b2']);
  });

  it('treats every level ≠ 0 as the axis, including Down', () => {
    expect(isOnAxis(1)).toBe(true);
    expect(isOnAxis(-1)).toBe(true);
    expect(isOnAxis(0)).toBe(false);
  });

  it('takes nothing when a cap is 0 or negative', () => {
    const mixed: Item[] = [axis('u1', 1), axis('b1', 0)];
    expect(names(limitByAxis(mixed, levelOfItem, { axis: 0, band: 10 }))).toEqual(['b1']);
    expect(names(limitByAxis(mixed, levelOfItem, { axis: 10, band: -3 }))).toEqual(['u1']);
  });
});

describe('verticalSpread の壊れた設定 (LEV-127)', () => {
  it('falls back to one column instead of returning nothing (which would throw in verticalRow)', () => {
    for (const columns of [NaN, Infinity, undefined as unknown as number]) {
      const slots = verticalSpread(3, 300, columns);
      expect(slots.length, String(columns)).toBe(3);
      expect(slots.map((s) => s.row), String(columns)).toEqual([0, 1, 2]);
    }
    expect(verticalSpread(3, 300, 0).map((s) => s.row)).toEqual([0, 1, 2]);
    expect(verticalSpread(3, 300, -2).map((s) => s.row)).toEqual([0, 1, 2]);
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
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, heightShearX: 0, upHeight: 132, downHeight: 132, rowLift: 60 };

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
    const plan = floorPlan(feet, origin, { spacing: nodeHeight });
    expect(plan.bounds).toEqual({ minX: -454 - 76, maxX: 425 + 76, minY: -291 - 76, maxY: 214 + 76 });
    for (const foot of feet) {
      expect(foot.x).toBeGreaterThanOrEqual(plan.bounds.minX + nodeHeight);
      expect(foot.x).toBeLessThanOrEqual(plan.bounds.maxX - nodeHeight);
      expect(foot.y).toBeGreaterThanOrEqual(plan.bounds.minY + nodeHeight);
      expect(foot.y).toBeLessThanOrEqual(plan.bounds.maxY - nodeHeight);
    }
  });

  it("puts the cross through the central note's foot, so on screen the friends' shadows sit on its east-west axis, parents' above-right, children's below-left", () => {
    const plan = floorPlan(feet, origin, { spacing: nodeHeight });
    expect(plan.origin).toEqual(origin);
    expect(plan.origin).not.toBe(origin);
    // 東西軸 = origin.y の線（W から E まで）、南北軸 = origin.x の線（N から S まで）。
    expect(plan.compass.west.y).toBe(origin.y);
    expect(plan.compass.east.y).toBe(origin.y);
    expect(plan.compass.north.x).toBe(origin.x);
    expect(plan.compass.south.x).toBe(origin.x);
    // 床（中心の段）に投影した東西軸は画面で水平。友の足元はその上、親は上（北）、子は下（南）。
    const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, heightShearX: 0, upHeight: 2.2 * nodeHeight, downHeight: 2.2 * nodeHeight, rowLift: nodeHeight };
    const axis = (x: number) => project({ x, y: plan.origin.y }, FLOOR_LEVEL, params);
    expect(axis(plan.bounds.minX).y).toBe(axis(plan.bounds.maxX).y);
    const screenY = (foot: Point) => project(foot, FLOOR_LEVEL, params).y;
    expect(feet.slice(0, 5).map(screenY)).toEqual([axis(0).y, axis(0).y - 291 * 0.3 + 12 * 0.3, axis(0).y - 291 * 0.3 + 12 * 0.3, axis(0).y, axis(0).y]);
    for (const child of feet.slice(5)) expect(screenY(child)).toBeGreaterThan(axis(0).y);
  });

  it('spaces the grid one nodeHeight apart from the cross, inside the floor, leaving out the two lines the cross already draws', () => {
    const plan = floorPlan(feet, origin, { spacing: nodeHeight });
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
    const plan = floorPlan(feet, origin, { spacing: nodeHeight });
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
    const plan = floorPlan(feet, origin, { spacing: nodeHeight, compassGap: { x: 38, north: 18 / northRise, south: 24 / northRise } });
    const params: ProjectionParams = { northShearX: 0.4, northRise, heightShearX: 0, upHeight: 2.2 * nodeHeight, downHeight: 2.2 * nodeHeight, rowLift: nodeHeight };
    const screenGap = (edge: Point, label: Point) =>
      Math.abs(project(edge, FLOOR_LEVEL, params).y - project(label, FLOOR_LEVEL, params).y);
    expect(screenGap({ x: 0, y: plan.bounds.minY }, plan.compass.north)).toBeCloseTo(18, 9);
    expect(screenGap({ x: 0, y: plan.bounds.maxY }, plan.compass.south)).toBeCloseTo(24, 9);
    const edgeW = project({ x: plan.bounds.minX, y: -12 }, FLOOR_LEVEL, params);
    const labelW = project(plan.compass.west, FLOOR_LEVEL, params);
    expect(edgeW.x - labelW.x).toBeCloseTo(38, 9);
  });

  it('covers the width of the boxes east-west (a wide friend never hides the edge or W/E) but only the feet north-south', () => {
    const wide = floorPlan([{ x: -454, y: -12, width: 300 }, { x: 0, y: 214, width: 300 }], origin, { spacing: nodeHeight });
    expect(wide.bounds.minX).toBe(-454 - 150 - 76);
    expect(wide.bounds.maxX).toBe(0 + 150 + 76);
    expect(wide.bounds.minY).toBe(-12 - 76);
    expect(wide.bounds.maxY).toBe(214 + 76);
    expect(wide.compass.west.x).toBeLessThan(-454 - 150);
  });

  it('leaves out grid lines that would lie on the outline, and draws none when the floor is only the margin around the origin', () => {
    // 足元が余白の端にちょうど乗る: x = 76 の線は内側、−76 と 152 は外周と重なるので描かない
    const edge = floorPlan([{ x: 76, y: 0 }], { x: 0, y: 0 }, { spacing: 76 });
    expect(edge.bounds).toEqual({ minX: -76, maxX: 152, minY: -76, maxY: 76 });
    expect(edge.columnXs).toEqual([76]);
    expect(edge.rowYs).toEqual([]);
    const alone = floorPlan([], { x: 10, y: -20 }, { spacing: 50 });
    expect(alone.bounds).toEqual({ minX: -40, maxX: 60, minY: -70, maxY: 30 });
    expect(alone.columnXs).toEqual([]);
    expect(alone.rowYs).toEqual([]);
    expect(alone.compass.north).toEqual({ x: 10, y: -95 });
  });

  it('keeps the cross inside the floor even when the origin is not among the feet, and takes a separate margin', () => {
    const plan = floorPlan([{ x: 300, y: 300 }], { x: 0, y: 0 }, { spacing: 100, margin: 10 });
    expect(plan.bounds).toEqual({ minX: -10, maxX: 310, minY: -10, maxY: 310 });
    expect(plan.columnXs).toEqual([100, 200, 300]);
    expect(plan.compass.east).toEqual({ x: 315, y: 0 });
  });

  it('draws no grid for a non-positive spacing', () => {
    for (const spacing of [0, -76, Number.NaN]) {
      const plan = floorPlan(feet, origin, { spacing, margin: 76 });
      expect(plan.columnXs).toEqual([]);
      expect(plan.rowYs).toEqual([]);
    }
  });
});

describe('floorPlan の左右の釣り合い (3d-design §6-2、LEV-135)', () => {
  const origin: Point = { x: 0, y: -12 };
  const shear = 0.4;
  const params: ProjectionParams = { northShearX: shear, northRise: 0.3, heightShearX: 0, upHeight: 238, downHeight: 277, rowLift: 92 };
  // 実機と同じ形: 足元は中心の行に並び、床は奥 546・手前 443 まで広がる。
  const feet = [{ x: -293, y: -12, width: 150 }, { x: 0, y: -12, width: 330 }, { x: 293, y: -12, width: 150 }];
  const reach = { north: 546, south: 443 };
  const gap = { x: 46, north: 60, south: 80 };

  const corners = { shear, at: "corners" } as const;
  const centreLine = { shear, at: "centre-line" } as const;

  /** 投影後の床の左端（南西の角）と右端（北東の角）。 */
  const edges = (plan: ReturnType<typeof floorPlan>) => ({
    left: project({ x: plan.bounds.minX, y: plan.bounds.maxY }, FLOOR_LEVEL, params).x,
    right: project({ x: plan.bounds.maxX, y: plan.bounds.minY }, FLOOR_LEVEL, params).x,
  });

  it('leaves the centre of the floor off to one side when the shear is not given (the old behaviour)', () => {
    const plan = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach });
    const { left, right } = edges(plan);
    const centre = project(origin, FLOOR_LEVEL, params).x;
    expect(centre - left).toBeLessThan(right - centre); // 床が右に伸びて中心が左寄りに見える
  });

  it('widens the floor so the projected left and right edges are the same distance from the centre note', () => {
    const plan = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: corners });
    const { left, right } = edges(plan);
    const centre = project(origin, FLOOR_LEVEL, params).x;
    expect(centre - left).toBeCloseTo(right - centre, 9);
  });

  it('only ever widens: every foot and box stays inside the floor', () => {
    const before = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach });
    const after = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: corners });
    expect(after.bounds.minX).toBeLessThanOrEqual(before.bounds.minX);
    expect(after.bounds.maxX).toBeGreaterThanOrEqual(before.bounds.maxX);
    for (const foot of feet) {
      expect(after.bounds.minX).toBeLessThan(foot.x - foot.width / 2);
      expect(after.bounds.maxX).toBeGreaterThan(foot.x + foot.width / 2);
    }
  });

  it('widens to the east instead when the floor reaches further in front than behind', () => {
    const deepFront = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach: { north: 300, south: 700 }, balance: corners });
    const plain = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach: { north: 300, south: 700 } });
    expect(deepFront.bounds.maxX).toBeGreaterThan(plain.bounds.maxX);
    expect(deepFront.bounds.minX).toBe(plain.bounds.minX);
  });

  it('widens by (south − north) × shear to the west when the feet are already centred', () => {
    const plain = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach });
    const balanced = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: corners });
    // 奥 546・手前 443・傾き 0.4 → 西へ 41.2px（「中心が動く量」の 2 倍。docs の値もこれ）。
    expect(balanced.bounds.minX - plain.bounds.minX).toBeCloseTo((reach.south - reach.north) * shear, 9);
    expect(balanced.bounds.maxX).toBe(plain.bounds.maxX);
  });

  it('also cancels an east-west imbalance in the feet, at the cost of a wider floor', () => {
    // 西のラベルが短く東が長い Vault: 足元の中心が東にずれるので、垂直軸を真ん中に置くには床が西へ大きく広がる。
    const lopsided = [{ x: -300, y: -12, width: 150 }, { x: 300, y: -12, width: 600 }];
    const plain = floorPlan(lopsided, origin, { spacing: 77, margin: 115, compassGap: gap, reach });
    const balanced = floorPlan(lopsided, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: corners });
    const { left, right } = edges(balanced);
    const centre = project(origin, FLOOR_LEVEL, params).x;
    expect(centre - left).toBeCloseTo(right - centre, 9);
    expect(balanced.bounds.maxX - balanced.bounds.minX).toBeGreaterThan(plain.bounds.maxX - plain.bounds.minX);
  });

  it('keeps the grid, the cross and the compass tied to the centre note when the floor is balanced', () => {
    const plan = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: centreLine });
    // グリッドは中心の足元から 77 間隔のまま、外周に乗る線は含まない。
    for (const x of plan.columnXs) expect(Math.abs((x - origin.x) % 77)).toBeCloseTo(0, 9);
    expect(Math.min(...plan.columnXs)).toBeGreaterThan(plan.bounds.minX);
    expect(Math.max(...plan.columnXs)).toBeLessThan(plan.bounds.maxX);
    // 方角は外周から compassGap。西は広がったぶんだけ外に出る。
    expect(plan.compass.west.x).toBe(plan.bounds.minX - gap.x);
    expect(plan.compass.east.x).toBe(plan.bounds.maxX + gap.x);
    expect(plan.compass.north.y).toBe(plan.bounds.minY - gap.north);
    expect(plan.compass.south.y).toBe(plan.bounds.maxY + gap.south);
  });

  it('puts the centre line of the parallelogram through the centre note with "centre-line" (the path Scene takes)', () => {
    // 中心線 = 北の辺の中点と南の辺の中点を結ぶ線。中心ノートの行で西端と東端が等距離になるのと同じこと。
    const plan = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: centreLine });
    const midOf = (y: number) => project({ x: (plan.bounds.minX + plan.bounds.maxX) / 2, y }, FLOOR_LEVEL, params).x;
    const axis = (y: number) => project({ x: origin.x, y }, FLOOR_LEVEL, params).x;
    for (const y of [plan.bounds.minY, origin.y, plan.bounds.maxY]) expect(midOf(y)).toBeCloseTo(axis(y), 9);
    // 中心ノートの行: 西端までと東端までが等距離。
    const west = project({ x: plan.bounds.minX, y: origin.y }, FLOOR_LEVEL, params).x;
    const east = project({ x: plan.bounds.maxX, y: origin.y }, FLOOR_LEVEL, params).x;
    const centre = project(origin, FLOOR_LEVEL, params).x;
    expect(centre - west).toBeCloseTo(east - centre, 9);
  });

  it('does not use the shear for "centre-line": it only makes the 2D range symmetric around the centre note', () => {
    const plan = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: centreLine });
    expect(plan.bounds.minX + plan.bounds.maxX).toBeCloseTo(2 * origin.x, 9);
    const flat = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: { shear: 0, at: "centre-line" } });
    expect(flat.bounds).toEqual(plan.bounds);
    // 足元が対称なら広げない（"corners" は (south − north)·shear ぶん西へ広げる）。
    const plain = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach });
    expect(plan.bounds.minX).toBe(plain.bounds.minX);
    expect(plan.bounds.maxX).toBe(plain.bounds.maxX);
  });

  it('still cancels an east-west imbalance with "centre-line"', () => {
    const lopsided = [{ x: -300, y: -12, width: 150 }, { x: 300, y: -12, width: 600 }];
    const plan = floorPlan(lopsided, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: centreLine });
    expect(plan.bounds.minX + plan.bounds.maxX).toBeCloseTo(2 * origin.x, 9);
    for (const foot of lopsided) {
      expect(plan.bounds.minX).toBeLessThan(foot.x - foot.width / 2);
      expect(plan.bounds.maxX).toBeGreaterThan(foot.x + foot.width / 2);
    }
  });

  it('keeps the cross and the compass on the centre note (only the outline moves)', () => {
    const plan = floorPlan(feet, origin, { spacing: 77, margin: 115, compassGap: gap, reach, balance: corners });
    expect(plan.origin).toEqual(origin);
    expect(plan.compass.north.x).toBe(origin.x);
    expect(plan.compass.south.x).toBe(origin.x);
    expect(plan.compass.west.y).toBe(origin.y);
    expect(plan.compass.east.y).toBe(origin.y);
  });
});

describe('groundGapNorthSouth (画面の距離を 2D の地面距離に戻す、LEV-130)', () => {
  const params: ProjectionParams = { northShearX: 0.4, northRise: 0.3, heightShearX: 0, upHeight: 100, downHeight: 100, rowLift: 60 };

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
    const plan = floorPlan([{ x: 0, y: -100 }], origin, { spacing: 50, reach: { north: 400, south: 300 } });
    expect(plan.bounds.minY).toBe(-400);
    expect(plan.bounds.maxY).toBe(300);
  });

  it('lets the feet win when they are further out than the reach', () => {
    const plan = floorPlan([{ x: 0, y: -900 }, { x: 0, y: 500 }], origin, { spacing: 50, reach: { north: 400, south: 300 } });
    expect(plan.bounds.minY).toBe(-950);
    expect(plan.bounds.maxY).toBe(550);
  });

  it('is the old behaviour when no reach is given (the default is 0)', () => {
    const plan = floorPlan([{ x: 0, y: -100 }], origin, { spacing: 50 });
    expect(plan.bounds.minY).toBe(-150);
    expect(plan.bounds.maxY).toBe(50);
  });

  it('keeps the compass on the widened edges, not on the feet', () => {
    const plan = floorPlan([{ x: 0, y: -100 }], origin, { spacing: 50, compassGap: { x: 25, north: 25, south: 25 }, reach: { north: 400, south: 300 } });
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
    expect(project({ x: 0, y: shifted }, 0, { northShearX: 0.4, northRise: 0.3, heightShearX: 0, upHeight: 1, downHeight: 1, rowLift: 1 }).y)
      .toBeCloseTo(project({ x: 0, y: centerY }, 0, { northShearX: 0.4, northRise: 0.3, heightShearX: 0, upHeight: 1, downHeight: 1, rowLift: 1 }).y - distance * 0.3, 9);
  });
});

describe('帯の行間は画面基準 (§6-9、LEV-149)', () => {
  const nodeHeight = 77;
  const params: ProjectionParams = {
    northShearX: DEFAULT_VIEW_3D_SETTINGS.northShearX,
    northRise: DEFAULT_VIEW_3D_SETTINGS.northRise,
    heightShearX: DEFAULT_VIEW_3D_SETTINGS.heightShearX,
    upHeight: DEFAULT_VIEW_3D_SETTINGS.upHeightFactor * nodeHeight,
    downHeight: DEFAULT_VIEW_3D_SETTINGS.downHeightFactor * nodeHeight,
    rowLift: DEFAULT_VIEW_3D_SETTINGS.rowLiftFactor * nodeHeight,
  };
  const grid = (rowHeight: number): BandGrid => ({ columns: 2, columnWidth: 236, rowHeight, side: -1 });
  // 2 列 2 行（北の帯の読み順は y 昇順 → 同じ行は西から東）。入力の並びのまま行 0・行 0・行 1・行 1 になる。
  const twoRows = [{ x: -118, y: -368 }, { x: 118, y: -368 }, { x: -118, y: -291 }, { x: 118, y: -291 }];

  it('collapses to less than a box height when the 2D row pitch is projected as is (the bug)', () => {
    const rows = regridBand(twoRows, { x: 0, y: -291 }, grid(nodeHeight));
    const screen = rows.map((c) => project(c, 0, params).y);
    const pitch = Math.abs(screen[0] - screen[2]); // 行 0 と行 1
    expect(pitch).toBeCloseTo(nodeHeight * params.northRise, 9); // 23px
    expect(pitch).toBeLessThan(nodeHeight * 0.86); // 箱の高さより小さい＝重なる
  });

  it('keeps a full nodeHeight between rows on screen when the pitch is undone first (the fix)', () => {
    const rows = regridBand(twoRows, { x: 0, y: -291 }, grid(groundGapNorthSouth(nodeHeight, params)));
    const screen = rows.map((c) => project(c, 0, params).y);
    expect(Math.abs(screen[0] - screen[2])).toBeCloseTo(nodeHeight, 9);
    // 同じ行の 2 つは高さが揃ったまま、東西の並びも変わらない。
    expect(screen[0]).toBe(screen[1]);
    expect(rows[1].x - rows[0].x).toBe(236);
  });
});

describe('regridBand (帯に残る level 0 だけで列を組み直す、3d-design §6-8・LEV-145)', () => {
  // artifacts/3d2-vertical-e2e の 2D（行の間隔 77）。docs/3d-brief.md §7 の 8 ノートを上流の `Layout` が置いたときの格子:
  //   北の帯（親 4 つ）は 2 列 2 行、columnWidth 236。1 行目 y −368 に 抽象化のはしご（up）・習慣ループ（up）、
  //   2 行目 y −291 に 行動デザイン（up）・読書メモ：習慣の本（origin）。
  //   南の帯（子 5 つ）は 3 列 2 行、columnWidth 280。1 行目 y 214 に 9月20日 朝ランの記録・朝のルーティン手順・
  //   歯磨き後に腕立て（どれも Down）、2 行目 y 290 に 習慣トラッカーの使い方・週次レビューのテンプレート（どちらも `leads to`）。
  // 中心ノートは x 0 なので、帯の中心線（`LayoutSpecification.origoX`）も 0。
  const north: BandGrid = { columns: 2, columnWidth: 236, rowHeight: 77, side: -1 };
  const south: BandGrid = { columns: 3, columnWidth: 280, rowHeight: 77, side: 1 };
  const centre = 0;

  it('puts the one parent left on the band（origin）on the true north of the centre note', () => {
    // 受入条件 1: up の 3 つが垂直軸へ抜けたあと、読書メモ：習慣の本 は 2 列の東側（x 118）に取り残されていた。
    expect(regridBand([{ x: 118, y: -291 }], { x: centre, y: -291 }, north)).toEqual([{ x: centre, y: -291 }]);
  });

  it('puts two parents left on the band either side of the centre', () => {
    // 受入条件 1 の後半。1 行に 2 つなので columnWidth の半分ずつ東西へ。
    expect(regridBand([{ x: -118, y: -291 }, { x: 118, y: -368 }], { x: centre, y: -291 }, north)).toEqual([
      { x: centre + 118, y: -291 }, // 読み順では y −291 が 2 つ目
      { x: centre - 118, y: -291 },
    ]);
  });

  it('centres the two `leads to` children of the south band on the centre note', () => {
    // 受入条件 2: down／example の 3 つが抜けたあと、習慣トラッカー（x 0）と 週次レビュー（x 280）が東へ寄っていた。
    // 残り 2 つで 1 行になり、丸ごと空いた 1 行目のぶん帯の内側の縁（y 214）まで詰める。
    expect(regridBand([{ x: 0, y: 290 }, { x: 280, y: 290 }], { x: centre, y: 214 }, south)).toEqual([
      { x: centre - 140, y: 214 },
      { x: centre + 140, y: 214 },
    ]);
  });

  it('keeps the band hugging the centre: the innermost row stays at `origin.y` and the rest stack outward', () => {
    // 北の帯は最も南の行が中心側なので、読み順の最後の行が `origin.y`。南の帯は最も北の行が中心側。
    const five = [0, 1, 2, 3, 4].map((i) => ({ x: i * 10, y: i }));
    // 北の帯（2 列）は 3 行になり、読み順の最後の行が y −291、外側へ 77 ずつ北へ
    expect(regridBand(five, { x: centre, y: -291 }, north).map((c) => c.y))
      .toEqual([-291 - 2 * 77, -291 - 2 * 77, -291 - 77, -291 - 77, -291]);
    // 南の帯（3 列）は 2 行で、読み順の 1 行目が y 214、外側へ 77 南へ
    expect(regridBand(five, { x: centre, y: 214 }, south).map((c) => c.y)).toEqual([214, 214, 214, 214 + 77, 214 + 77]);
  });

  it('reads the band north to south, then west to east（`Layout` が並べたタイトル順のまま）', () => {
    // 3 列。読み順の 1〜3 番目が 1 行目、4・5 番目が 2 行目の中央揃え。入力の並びは崩さずに返す
    const scattered = [
      { x: 280, y: 290 }, // 読み順 5
      { x: -280, y: 214 }, // 読み順 1
      { x: 280, y: 214 }, // 読み順 3
      { x: -280, y: 290 }, // 読み順 4
      { x: 0, y: 214 }, // 読み順 2
    ];
    expect(regridBand(scattered, { x: centre, y: 214 }, south)).toEqual([
      { x: centre + 140, y: 214 + 77 },
      { x: centre - 280, y: 214 },
      { x: centre + 280, y: 214 },
      { x: centre - 140, y: 214 + 77 },
      { x: centre, y: 214 },
    ]);
  });

  it('lands a full row exactly where `Layout.place()` would（満杯の行は 2D と同じ位置）', () => {
    // `Layout.place()`: center00.x = origoX − (columns−1)/2 × columnWidth、idx 番目は + idx × columnWidth。
    const placeX = (idx: number, grid: BandGrid) => centre - ((grid.columns - 1) / 2) * grid.columnWidth + idx * grid.columnWidth;
    const row = [{ x: -280, y: 214 }, { x: 0, y: 214 }, { x: 280, y: 214 }];
    expect(regridBand(row, { x: centre, y: 214 }, south).map((c) => c.x)).toEqual([placeX(0, south), placeX(1, south), placeX(2, south)]);
  });

  it('puts the innermost row on `origin.y`, so the band never moves away from the centre', () => {
    // `origin.y` には帯が `place()` で占めていた内側の縁を渡す。`bandShift` はその行から測り、届いていなければ
    // ちょうど `distance` まで動かす（丸ごと空いた行があれば帯は中心側へ詰まるので、測る距離は 2D より小さくなる）
    const centerY = -12;
    const distance = 300;
    const regridded = regridBand([{ x: 118, y: -291 }], { x: centre, y: -291 }, north);
    expect(regridded[0].y).toBe(-291);
    expect(regridded[0].y + bandShift(centerY, regridded[0].y, distance, -1)).toBe(centerY - distance);
  });

  it('never touches the input centres', () => {
    const centres = [{ x: 118, y: -291 }, { x: -118, y: -368 }];
    const before = JSON.stringify(centres);
    regridBand(centres, { x: centre, y: -291 }, north);
    expect(JSON.stringify(centres)).toBe(before);
  });

  it('returns an empty band unchanged and falls back to one column on a broken column count', () => {
    expect(regridBand([], { x: centre, y: -291 }, north)).toEqual([]);
    const broken = { ...north, columns: Number.NaN };
    // 1 列 2 行。読み順は北（y −368）が先で、中心にいちばん近い y −291 が最後の行
    expect(regridBand([{ x: 118, y: -291 }, { x: -118, y: -368 }], { x: centre, y: -291 }, broken)).toEqual([
      { x: centre, y: -291 },
      { x: centre, y: -291 - 77 },
    ]);
  });
});

describe('regridBand と Layout.place() (8 ノート fixture の帯、LEV-145 の受入条件)', () => {
  /** `Layout` が触るのは `title`（並べ替え）と `setCenter()` だけ。`level` は 3D の Scene が付ける。 */
  class BandNode {
    center: Point = { x: 0, y: 0 };
    constructor(readonly title: string, readonly level: Level) {}
    setCenter(center: Point): void {
      this.center = center;
    }
  }

  /** `Scene.calculateLayoutParams` が決める帯の形で上流の `Layout` に置かせ、置いたノードを返す。 */
  const placeBand = (band: [string, Level][], spec: LayoutSpecification): BandNode[] => {
    const layout = new Layout(spec);
    const nodes = band.map(([title, level]) => new BandNode(title, level));
    layout.nodes.push(...(nodes as unknown as Node[]));
    layout.place();
    return nodes;
  };

  /** 読み順（行＝北から南、同じ行は西から東）に並べ直して見る。`Layout` はタイトル順に並べてから格子へ入れる。 */
  const readingOrder = (nodes: BandNode[]): { title: string; x: number; y: number }[] =>
    [...nodes]
      .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x)
      .map((node) => ({ title: node.title, ...node.center }));

  /**
   * `Scene.render3D` が `regridBand` に渡すのと同じ入力を作る: 帯に残った level 0 の中心（`node.level` で選ぶ）と、
   * 帯が `place()` で占めていた内側の縁（北の帯は最も南の行、南の帯は最も北の行。垂直軸へ抜けるノードも数える）。
   * 中心ノートの x は 0（`lCenter` の `origoX`）。Scene 側の当てはめそのものは EA 依存で実機のみ。
   */
  const regridOf = (nodes: BandNode[], grid: BandGrid): { title: string; center: Point }[] => {
    const onBand = nodes.filter((node) => !isOnAxis(node.level));
    const ys = nodes.map((node) => node.center.y);
    const innermostY = grid.side < 0 ? Math.max(...ys) : Math.min(...ys);
    const centres = regridBand(onBand.map((node) => node.center), { x: 0, y: innermostY }, grid);
    return onBand.map((node, i) => ({ title: node.title, center: centres[i] }));
  };

  /** 実測（artifacts/3d2-vertical-e2e）と同じ寸法。origoY は 1 行目が実測の y に来る値。 */
  const baseSpec: LayoutSpecification = { columns: 1, origoX: 0, origoY: 0, top: null, bottom: null, rowHeight: 77, columnWidth: 236, maxLabelLength: 30 };
  const parentsSpec: LayoutSpecification = { ...baseSpec, columns: 2, columnWidth: 236, origoY: -291, bottom: -154 };
  const childrenSpec: LayoutSpecification = { ...baseSpec, columns: 3, columnWidth: 280, origoY: 291, top: 0 };

  const parents: [string, Level][] = [['行動デザイン', 1], ['習慣ループ', 1], ['抽象化のはしご', 1], ['読書メモ：習慣の本', 0]];
  const children: [string, Level][] = [
    ['朝のルーティン手順', -1], ['歯磨き後に腕立て', -1], ['9月20日 朝ランの記録', -1],
    ['習慣トラッカーの使い方', 0], ['週次レビューのテンプレート', 0],
  ];

  it('北の帯: origin の親が 2D では東に取り残され、組み直すと中心の真北に来る', () => {
    const placed = placeBand(parents, parentsSpec);
    // 2D（上流の `Layout`）: 2 列 2 行。読書メモ：習慣の本 は 2 行目の東の列で、中心（x 0）から columnWidth の半分だけ東
    expect(readingOrder(placed)).toEqual([
      { title: '抽象化のはしご', x: -118, y: -368 },
      { title: '習慣ループ', x: 118, y: -368 },
      { title: '行動デザイン', x: -118, y: -291 },
      { title: '読書メモ：習慣の本', x: 118, y: -291 },
    ]);
    // 3D: up の 3 つが垂直軸へ抜け、残る 1 つが中心の真北（x が中心と同じ）に立つ
    expect(regridOf(placed, { columns: 2, columnWidth: 236, rowHeight: 77, side: -1 })).toEqual([
      { title: '読書メモ：習慣の本', center: { x: 0, y: -291 } },
    ]);
  });

  it('北の帯: level 0 の親が 2 つなら中心を挟んで対称', () => {
    const twoOnBand: [string, Level][] = [['行動デザイン', 1], ['習慣ループ', 1], ['抽象化のはしご', 0], ['読書メモ：習慣の本', 0]];
    const centres = regridOf(placeBand(twoOnBand, parentsSpec), { columns: 2, columnWidth: 236, rowHeight: 77, side: -1 })
      .map((n) => n.center.x);
    expect(centres).toEqual([-118, 118]);
    expect(centres[0] + centres[1]).toBe(0);
  });

  it('南の帯: `leads to` の 2 つが 2D では東に寄り、組み直すと中心を挟んで対称に来る', () => {
    const placed = placeBand(children, childrenSpec);
    // 2D: 3 列 2 行。1 行目は Down の 3 つ、2 行目は上流の行ベクトルで中央と東の列（x 0 と 280）に入る
    expect(readingOrder(placed)).toEqual([
      { title: '9月20日 朝ランの記録', x: -280, y: 214 },
      { title: '朝のルーティン手順', x: 0, y: 214 },
      { title: '歯磨き後に腕立て', x: 280, y: 214 },
      { title: '習慣トラッカーの使い方', x: 0, y: 291 },
      { title: '週次レビューのテンプレート', x: 280, y: 291 },
    ]);
    // 3D: down／example の 3 つが抜け、残る 2 つが中心を挟んで対称。丸ごと空いた 1 行目のぶん帯の内側の縁（y 214）へ詰まる
    expect(regridOf(placed, { columns: 3, columnWidth: 280, rowHeight: 77, side: 1 })).toEqual([
      { title: '習慣トラッカーの使い方', center: { x: -140, y: 214 } },
      { title: '週次レビューのテンプレート', center: { x: 140, y: 214 } },
    ]);
  });

  it('Up／Down を使っていない Vault でも、上流の半端な行の偏りを中心に揃え直す', () => {
    // 軸へ抜けるノードが 1 つも無い帯（子 5 つが全部 level 0）。上流の 2 行目は x 0 と 280 で東へ寄っているので、
    // 組み直しで中心を挟んで対称にする。1 行目は満杯なので `Layout.place()` と同じ位置のまま、行も動かない
    const allOnBand = children.map(([title]) => [title, 0] as [string, Level]);
    const placed = placeBand(allOnBand, childrenSpec);
    expect(readingOrder(placed).slice(3)).toEqual([
      { title: '習慣トラッカーの使い方', x: 0, y: 291 },
      { title: '週次レビューのテンプレート', x: 280, y: 291 },
    ]);
    const centres = regridOf(placed, { columns: 3, columnWidth: 280, rowHeight: 77, side: 1 });
    expect([...centres].sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x)).toEqual([
      // 1 行目は満杯なので `Layout.place()` と同じ位置
      { title: '9月20日 朝ランの記録', center: { x: -280, y: 214 } },
      { title: '朝のルーティン手順', center: { x: 0, y: 214 } },
      { title: '歯磨き後に腕立て', center: { x: 280, y: 214 } },
      // 2 行目は中心を挟んで対称に（2D では x 0 と 280）
      { title: '習慣トラッカーの使い方', center: { x: -140, y: 291 } },
      { title: '週次レビューのテンプレート', center: { x: 140, y: 291 } },
    ]);
  });

  it('中心にいちばん近い行が空いていれば、そのぶん帯は中心側へ詰まる（`bandShift` はそのあとから測る）', () => {
    // 南の帯の 1 行目（y 214）が全部 Down なら、残った 2 つは 1 行目の位置まで詰まる。帯は中心から遠ざからない
    const placed = placeBand(children, childrenSpec);
    const innermost = Math.min(...placed.map((node) => node.center.y));
    const centres = regridOf(placed, { columns: 3, columnWidth: 280, rowHeight: 77, side: 1 });
    expect(centres.every((n) => n.center.y === innermost)).toBe(true);
    // 詰めたあとの内側の行から測るので、中心（y −12）から 300 に届いていなければ `bandShift` がそこまで動かす
    expect(innermost + bandShift(-12, innermost, 300, 1)).toBe(-12 + 300);
  });
});
