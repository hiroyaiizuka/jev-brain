import { Role } from "src/Types";

/**
 * 3D 表示の計算だけを置く純関数群（docs/3d-design.md §3-1・§6-1）。
 * Obsidian・Excalidraw に依存しない。中心の決定は Layout、描画は Scene / Node が担う。
 */

/** 中心ノートを基準にした高さ。+1 = Up の親、-1 = Down の子、0 = 地面。 */
export type Level = -1 | 0 | 1;

/**
 * Up／Down 領域のフィールド名。ONT-1（LEV-106）が `plugin.hierarchyLowerCase` に足す
 * `abstract` / `concrete` と同じキー名・同じ形（小文字・空白→ハイフン）で受け取る。
 */
export type LevelHierarchy = {
  abstract: readonly string[];
  concrete: readonly string[];
};

/**
 * 関係のフィールドとは無関係に高さを 0 に固定する、対象ノードの属性（§3-1 の「兄弟は 0」）。
 * 兄弟の Neighbour は親の `getChildren()` 由来で「兄弟→親」のフィールドを持つので、`typeDefinition` だけでは
 * 見分けられない。未解決ページ（ゴースト）を 0 に落とす規則は LEV-124 でやめた（§6-5）: `up:: [[aaaa]]` のような
 * 未解決の Up も、解決済みの Up と同じ段に立てる。
 */
export type LevelSubject = {
  /** `Scene.addNodes` の `isSibling`。 */
  isSibling?: boolean;
};

/**
 * 中心ノートとの関係から隣接ノードの高さを決める。
 *
 * - 兄弟（`subject.isSibling`）→ 0
 * - 親（`Role.PARENT`）で、フィールドのどれかが Up／Down 領域に入る → +1
 * - 子（`Role.CHILD`）で、フィールドのどれかが Up／Down 領域に入る → -1
 * - それ以外（Parents／Children の親子、左右の友、推論リンク、file-tree・tag-tree）→ 0
 *
 * `typeDefinition` は `Page.addParent/addChild` が `hierarchyLowerCase` の要素を ", " で連結した文字列なので、
 * `Link` と同じく分割と trim だけで比べる（再正規化はしない）。フィールドが Up と Down のどちらに入るかは
 * 問わない: 親子の向きは Page が決めていて、親側のノートが `down: [[中心]]` と書いた関係も親に `down` のまま
 * 付くので、領域に入るかどうかだけを見て符号は役割から取る。推論リンク（`typeDefinition` 無し）は 0。
 */
export const levelOf = (
  typeDefinition: string | undefined,
  role: Role,
  hierarchy: LevelHierarchy,
  subject: LevelSubject = {},
): Level => {
  if (subject.isSibling) return 0;
  if (role !== Role.PARENT && role !== Role.CHILD) return 0;
  if (!typeDefinition) return 0;
  const onAxis = typeDefinition
    .split(",")
    .map((field) => field.trim())
    .some((field) => field !== "" && (hierarchy.abstract.includes(field) || hierarchy.concrete.includes(field)));
  if (!onAxis) return 0;
  return role === Role.PARENT ? 1 : -1;
};

/**
 * 画面内の最下段: 中心ノードは常に 0 なので 0 から始め、Down の子（−1）があれば −1。空でも 0。
 * L ラベルと level 別の色（§6-3、LEV-121）が L1 として数える基準。描く床（§6-2）はこれではなく常に中心の段 0
 * （`FLOOR_LEVEL`）で、最下段が −1 のときそのノードは床の下に吊る。
 */
export const floorOf = (levels: readonly Level[]): Level => levels.reduce<Level>((floor, level) => (level < floor ? level : floor), 0);

/**
 * 床の段（§6-2、本人の追記 2026-09-21）: 常に中心ノートの段。床の平面は `project(·, FLOOR_LEVEL, params)` の
 * `floorDrop` 下にあり、Up の親はその上に柱で立ち、Down の子は床の下に柱で吊る。
 */
export const FLOOR_LEVEL: Level = 0;

export type Point = { x: number; y: number };

/** 2D の範囲（中心ノート原点、y は北が負）。床の平行四辺形は `floorPlan` がこれを足元から作り、Scene が床の高さに投影する。 */
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * 床の平面図（§6-2）。すべて 2D の地面座標で、Scene が各点を `project(·, FLOOR_LEVEL, params)` で床の高さに投影する
 * （東西は水平のまま、南北は northShearX／northRise の向きに傾く平行四辺形になる）。
 */
export type FloorPlan = {
  /** 影の足元（`feet` と `origin`）と箱の横幅をすべて含む最小の長方形に、四方 `margin` の余白を足した範囲。 */
  bounds: Bounds;
  /** 床の十字の交点 = 中心ノートの足元。 */
  origin: Point;
  /** 南北に走るグリッド線の x（東西に `spacing` 間隔で並ぶ）。十字と重なる `origin.x` の線と、外周に乗る線は含まない。 */
  columnXs: number[];
  /** 東西に走るグリッド線の y（南北に `spacing` 間隔で並ぶ）。同上。 */
  rowYs: number[];
  /** 方角ラベルの位置: 十字の両端の外側、外周から `compassGap`（既定 `margin / 2`）。 */
  compass: { north: Point; south: Point; west: Point; east: Point };
};

/** `floorPlan` の足元: 2D の中心と、その箱の幅（東西は画面で水平なので床は箱の横幅も覆う。省略は 0）。 */
export type Foot = Point & { width?: number };

/** `origin + k·spacing`（k ≠ 0）のうち `min` と `max` の間（両端を除く）にあるもの。`spacing` が正でなければ空。 */
const gridPositions = (min: number, max: number, origin: number, spacing: number): number[] => {
  if (!(spacing > 0)) return [];
  const positions: number[] = [];
  const first = Math.ceil((min - origin) / spacing);
  const last = Math.floor((max - origin) / spacing);
  for (let k = first; k <= last; k++) {
    if (k === 0) continue;
    const at = origin + k * spacing;
    if (at > min && at < max) positions.push(at);
  }
  return positions;
};

/**
 * 床の範囲・グリッド・十字・方角の位置（§6-2）。`feet` は各ノードの影の足元（2D の中心。影はどのノードも足元にある）と
 * 箱の幅（幅の広い箱が床の東西の縁や W／E を隠さないよう、東西は箱の横幅も覆う。南北は足元だけ）、`origin` は中心ノートの
 * 足元（十字はここを通り、グリッドはここを基準に `spacing` 間隔）。`origin` も範囲に含めるので十字は必ず床の内側にある。
 * 余白 `margin` は既定で `spacing`（Scene はどちらも nodeHeight）。`compassGap` は方角ラベルを外周から離す量で、
 * 南北は投影で `northRise` 倍に縮むので Scene は y を `northRise` で割って渡す（画面でどの方角も同じ間隔）。
 * 足元が 1 つも無ければ（`origin` だけでも）その点の周りに余白だけの床を返す。
 */
export const floorPlan = (
  feet: readonly Foot[],
  origin: Point,
  spacing: number,
  margin = spacing,
  compassGap: Point = { x: margin / 2, y: margin / 2 },
): FloorPlan => {
  const bounds: Bounds = { minX: origin.x, maxX: origin.x, minY: origin.y, maxY: origin.y };
  for (const foot of feet) {
    const halfWidth = (foot.width ?? 0) / 2;
    bounds.minX = Math.min(bounds.minX, foot.x - halfWidth);
    bounds.maxX = Math.max(bounds.maxX, foot.x + halfWidth);
    bounds.minY = Math.min(bounds.minY, foot.y);
    bounds.maxY = Math.max(bounds.maxY, foot.y);
  }
  bounds.minX -= margin;
  bounds.maxX += margin;
  bounds.minY -= margin;
  bounds.maxY += margin;
  return {
    bounds,
    origin: { ...origin },
    columnXs: gridPositions(bounds.minX, bounds.maxX, origin.x, spacing),
    rowYs: gridPositions(bounds.minY, bounds.maxY, origin.y, spacing),
    compass: {
      north: { x: origin.x, y: bounds.minY - compassGap.y },
      south: { x: origin.x, y: bounds.maxY + compassGap.y },
      west: { x: bounds.minX - compassGap.x, y: origin.y },
      east: { x: bounds.maxX + compassGap.x, y: origin.y },
    },
  };
};

/** `floorDrop` の入力: 描画済みの箱の段と画面上の高さ（px）。 */
export type FloorBox = { level: Level; height: number };

/**
 * 床の平面を、中心の段（`FLOOR_LEVEL`）の投影から画面で下げる量（px、§6-2「中心のメモのノードのちょい下」）。
 * 床の段にある箱のうち最も高いものの半分＋影の半分で、その箱の下端に影の上端が接し、低い箱はその少し上に乗る。
 * `nodeHeight` より高い箱（埋め込みの中心）は数えない（LEV-123）。床の下に吊る箱（level < 0）の上端より下には
 * 下げない（`levelHeight` が箱と同じくらい小さい設定でも柱が反転しない）。床の段の箱が無ければ nodeHeight を箱とみなす。
 */
export const floorDrop = (boxes: readonly FloorBox[], nodeHeight: number, levelHeight: number, shadowHeight: number): number => {
  const onFloor = boxes.filter((box) => box.level === FLOOR_LEVEL && box.height <= nodeHeight).map((box) => box.height);
  const tallest = onFloor.length > 0 ? Math.max(...onFloor) : nodeHeight;
  const below = boxes.filter((box) => box.level < FLOOR_LEVEL).map((box) => box.height / 2);
  const ceiling = levelHeight - (below.length > 0 ? Math.max(...below) : 0) - shadowHeight / 2;
  return Math.max(0, Math.min(tallest / 2 + shadowHeight / 2, ceiling));
};

/**
 * 柱の目盛りを置く段（§6-2「1 段ごとに短い横線」）: 床と箱の段の間の各段（床の上に立つ柱も床の下に吊る柱も同じ）。
 * 箱の段の高さは箱に隠れるので含めない。床にいる箱や床から 1 段の箱には目盛りが無く、柱そのものが 1 段を表す
 * （3 段のままでは常に空。§7 で段が増えたときに効く）。Scene は足元から `(tick − FLOOR_LEVEL) · levelHeight` 上（下）に置く。
 */
export const pillarTickLevels = (level: Level, floor: Level): Level[] => {
  const ticks: Level[] = [];
  for (let tick = Math.min(level, floor) + 1; tick < Math.max(level, floor); tick++) ticks.push(tick as Level);
  return ticks;
};

/**
 * 斜投影（キャビネット図法）の係数。`northShearX`／`northRise` は設定 `view3D`（`View3DSettings`、既定値は
 * `constants.ts` の `DEFAULT_VIEW_3D_SETTINGS`）そのもの、`levelHeight` は `levelHeightFactor × nodeHeight` を
 * 呼び出し側（Scene）が毎回計算して渡す（`nodeHeight` は `compactingFactor` とフォントから決まるので px 固定にしない）。
 */
export type ProjectionParams = {
  /** north 1 につき画面 x を右へ動かす量（既定 0.40）。 */
  northShearX: number;
  /** north 1 につき画面 y を上へ動かす量（既定 0.30）。 */
  northRise: number;
  /** 1 段ぶんの高さ（px）。 */
  levelHeight: number;
};

/**
 * 友の帯を中心ノートの y に揃えるための、2D の y に足す量（§6-1「フレンドと中心は同じ north」）。
 *
 * 上流の `Layout.place()` は行の中心を `top + row·rowHeight`（`top = origoY − rows·rowHeight/2`）に置くので、
 * どの帯も行の平均が origoY より rowHeight/2 だけ北にある。中心の帯（rowHeight = 中心の箱の高さ）と友の帯
 * （rowHeight = nodeHeight）でこの量が違い、2D では中心と友の y が (nodeHeight − 中心の行高)/2 ずれる
 * （`Scene` の `lCenter` の origoY のコメント「friends are just slightly off center」。実測 −12 と −38）。
 * 2D はそのままにし、3D では友の帯の平均の行が中心ノートの y（`centerY`）に来るよう帯ごと動かしてから投影する。
 * 中心は動かさない（原点は `retainCentralNode` の不動点）。
 */
export const friendBandShift = (centerY: number, friendRowHeight: number): number => centerY + friendRowHeight / 2;

/**
 * Up／Down（level ≠ 0）を中心ノートの真上・真下に立てるための、東西のずらし量（§6-5、本人の追記 2）。
 *
 * 3D では level ≠ 0 のノードは 2D の帯（北・南）の位置を使わず、中心ノートと同じ north の行（`north = 0`、
 * 床の十字の東西の線）に東西等間隔で並べてから投影する。これで Up は中心の真上、Down は真下に垂直に並び、
 * 平行四辺形の床の帯に残るのは level 0（Parents／Children／Left／Right／Previous／Next）だけになる。
 *
 * 1 つなら `[0]`（中心の真上・真下）、n 個なら中心を挟んで `columnWidth` 間隔の中央揃え（`Layout.place()` が
 * 列を中央に揃えるのと同じ規則）。Scene は同じ level のノードを 2D の x 順に並べてこの配列を当てる。
 */
export const verticalSpread = (count: number, columnWidth: number): number[] =>
  Array.from({ length: Math.max(0, Math.trunc(count)) }, (_, i) => (i - (count - 1) / 2) * columnWidth);

export type Projected = {
  x: number;
  y: number;
  /** 奥行き = north（−gy）。大きいほど奥（北）。描画は north の降順（`compareDrawOrder`）。高さ（level）には依存しない。 */
  depth: number;
};

/**
 * §6-1 の斜投影（キャビネット図法）。`center` は Layout が決めた 2D の中心（中心ノート原点、gy は北が負）。
 *
 * ```text
 * north = −gy
 * x     = gx + north · northShearX
 * y     = −north · northRise − level · levelHeight
 * depth = north
 * ```
 *
 * 東西は水平のまま（2D の横並びが崩れない）、抽象度は真上、南北は右上がりの斜め（北が右上・奥、南が左下・手前）。
 * 中心ノート（gx = gy = 0、level 0）は原点に留まる: `retainCentralNode` で保持した埋め込みの中心の要素は
 * 前回の描画位置のままなので、2D（Layout が原点に置く）と 3D で中心が同じ場所にある必要がある。床は
 * `project(center, FLOOR_LEVEL, params)` の少し下（中心の箱の下端）を通る（§6-2）。
 *
 * 入力の検査はしない（params は設定の値から作る）。`0 - gy` は `-gy` が 0 を −0 にするのを避けるため。
 */
export const project = (center: Point, level: Level, params: ProjectionParams): Projected => {
  const north = 0 - center.y;
  return {
    x: center.x + north * params.northShearX,
    y: 0 - north * params.northRise - level * params.levelHeight,
    depth: north,
  };
};

/**
 * 描画順（§6-1）: `depth`（north）の大きい順（奥 → 手前）。同じ north なら画面の x の小さい順（西から）で決定的にする。
 * `Array.prototype.sort` の比較関数として `project` の結果を渡す。
 */
export const compareDrawOrder = (a: Projected, b: Projected): number => b.depth - a.depth || a.x - b.x;
