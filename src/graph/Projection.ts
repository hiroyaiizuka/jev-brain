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
 * level 別の色（§6-3）の添字の基準（`levelColors[level − floor]`。肩の L ラベルは LEV-130 でやめた）。描く床（§6-2）はこれではなく常に中心の段 0
 * （`FLOOR_LEVEL`）で、最下段が −1 のときそのノードは床の下に吊る。
 */
export const floorOf = (levels: readonly Level[]): Level => levels.reduce<Level>((floor, level) => (level < floor ? level : floor), 0);

/**
 * 床の段（§6-2、本人の追記 2026-09-21）: 常に中心ノートの段。床の平面は `project(·, FLOOR_LEVEL, params)` の
 * `floorDrop` 下にあり、Up の親はその上に浮き、Down の子は床の下に吊られる（柱と影は §6-6 でやめた）。
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

/**
 * 方角ラベルを床の外周から離す量（2D の距離）。東西と南北を分け、さらに南北も別々に持つ: N は床のすぐ外、
 * S はもう少しだけ外（本人のフィードバック 4、LEV-130）。南北は投影で `northRise` 倍に縮むので、Scene は
 * 画面で欲しい量を割って渡す。
 */
export type CompassGap = { x: number; north: number; south: number };

/** `floorPlan` の足元: ノードの 2D の中心と、その箱の幅（東西は画面で水平なので床は箱の横幅も覆う。省略は 0）。 */
export type Foot = Point & { width?: number };

/**
 * 床が中心ノートの足元から最低限もつ奥行き（2D の距離、LEV-128 の本人の指定: 奥 7.1 段・手前 5.75 段）。
 * Up／Down が帯を離れてからは南の帯に足元が無く、足元の最小外接だけでは床が北に偏って「傾いた紙」に見えるため。
 */
export type FloorReach = { north: number; south: number };

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
 * 床の範囲・グリッド・十字・方角の位置（§6-2）。`feet` は各ノードの影の足元（2D の中心。足元は影を描いていた頃と同じ点）と
 * 箱の幅（幅の広い箱が床の東西の縁や W／E を隠さないよう、東西は箱の横幅も覆う。南北は足元だけ）、`origin` は中心ノートの
 * 足元（十字はここを通り、グリッドはここを基準に `spacing` 間隔）。`origin` も範囲に含めるので十字は必ず床の内側にある。
 * 余白 `margin` は既定で `spacing`（Scene は spacing に nodeHeight、margin に `floorMarginFactor × nodeHeight` を渡す）。`compassGap` は方角ラベルを外周から離す量で、
 * 東西・北・南を別々に持つ（南北は投影で `northRise` 倍に縮むので Scene は割って渡す）。`balanceShear`（投影の傾き
 * `northShearX`）を渡すと、投影後の床の左右の端が中心ノートの足元から等距離になるよう東西を広げる（LEV-135。
 * 省略すると足元を囲む最小の範囲のまま）。
 * 足元が 1 つも無ければ（`origin` だけでも）その点の周りに余白だけの床を返す。
 */
export const floorPlan = (
  feet: readonly Foot[],
  origin: Point,
  spacing: number,
  margin = spacing,
  compassGap: CompassGap = { x: margin / 2, north: margin / 2, south: margin / 2 },
  reach: FloorReach = { north: 0, south: 0 },
  balanceShear?: number,
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
  // 床の最低の広がり（LEV-128）: 足元が北に寄っていても手前に奥行きを出す。足元がこれより外なら足元が勝つ
  bounds.minY = Math.min(bounds.minY, origin.y - reach.north);
  bounds.maxY = Math.max(bounds.maxY, origin.y + reach.south);
  // 傾きぶんの釣り合い（LEV-135）: 投影は北の辺を右へ、南の辺を左へずらすので、東西の範囲をそのまま投影すると
  // 左右の端が中心ノートの足元に対して非対称になる（奥のほうが深い既定値では床が右に伸びて見える）。
  // `balanceShear`（= `northShearX`）を渡すと、投影後の左端（南西の角）と右端（北東の角）が中心から等距離に
  // なるよう足りない側へ広げる（狭めない）。渡さなければ足元を囲む最小の範囲のまま。
  if (balanceShear !== undefined) {
    const balance = 2 * origin.x + (bounds.minY + bounds.maxY - 2 * origin.y) * balanceShear - (bounds.minX + bounds.maxX);
    if (balance < 0) bounds.minX += balance;
    else bounds.maxX += balance;
  }
  return {
    bounds,
    origin: { ...origin },
    columnXs: gridPositions(bounds.minX, bounds.maxX, origin.x, spacing),
    rowYs: gridPositions(bounds.minY, bounds.maxY, origin.y, spacing),
    compass: {
      north: { x: origin.x, y: bounds.minY - compassGap.north },
      south: { x: origin.x, y: bounds.maxY + compassGap.south },
      west: { x: bounds.minX - compassGap.x, y: origin.y },
      east: { x: bounds.maxX + compassGap.x, y: origin.y },
    },
  };
};

/** `floorDrop` の入力: 描画済みの箱の段と画面上の高さ（px）。 */
export type FloorBox = { level: Level; height: number };

/**
 * 床の平面を、中心の段（`FLOOR_LEVEL`）の投影から画面で下げる量（px、§6-2「中心のメモのノードのちょい下」）。
 * 床の段にある箱のうち最も高いものの半分で、その箱の下端を平面が通り、低い箱はその少し上に乗る。
 * `nodeHeight` より高い箱（埋め込みの中心）は数えない（LEV-123）。床の下に吊る箱（level < 0）の上端より下には
 * 下げない（`downHeight` が箱と同じくらい小さい設定でも上下が反転しない）。床の段の箱が無ければ nodeHeight を箱とみなす。
 */
export const floorDrop = (boxes: readonly FloorBox[], nodeHeight: number, downHeight: number): number => {
  const onFloor = boxes.filter((box) => box.level === FLOOR_LEVEL && box.height <= nodeHeight).map((box) => box.height);
  const tallest = onFloor.length > 0 ? Math.max(...onFloor) : nodeHeight;
  const below = boxes.filter((box) => box.level < FLOOR_LEVEL).map((box) => box.height / 2);
  const ceiling = downHeight - (below.length > 0 ? Math.max(...below) : 0);
  return Math.max(0, Math.min(tallest / 2, ceiling));
};

/**
 * 斜投影（キャビネット図法）の係数。`northShearX`／`northRise` は設定 `view3D`（`View3DSettings`、既定値は
 * `constants.ts` の `DEFAULT_VIEW_3D_SETTINGS`）そのもの、`upHeight`／`downHeight` は `upHeightFactor`／
 * `downHeightFactor × nodeHeight` を呼び出し側（Scene）が毎回計算して渡す（`nodeHeight` は `compactingFactor` と
 * フォントから決まるので px 固定にしない）。上と下で高さが違うのは本人の指定（LEV-128: Up 3.1 段・Down 3.6 段）。
 */
export type ProjectionParams = {
  /** north 1 につき画面 x を右へ動かす量（既定 0.40）。 */
  northShearX: number;
  /** north 1 につき画面 y を上へ動かす量（既定 0.30）。 */
  northRise: number;
  /** Up（level > 0）1 段ぶんの高さ（px）。 */
  upHeight: number;
  /** Down（level < 0）1 段ぶんの深さ（px）。 */
  downHeight: number;
};

/** 段の高さ（px、上が正）。level 0 は 0、Up は `upHeight`、Down は `downHeight` を使う（LEV-128）。 */
export const liftOf = (level: Level, params: ProjectionParams): number =>
  level > 0 ? level * params.upHeight : level * params.downHeight;

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
 * 1 つなら `[0]`（中心の真上・真下）、n 個なら中心を挟んで `gap` 間隔の中央揃え（`Layout.place()` が列を中央に
 * 揃えるのと同じ規則）。`gap` は設定 `verticalGapFactor × nodeHeight`（LEV-128 で帯の `columnWidth` から変えた:
 * 垂直軸は帯を離れているので、帯の列幅ではなく 3D 専用の間隔で並べる）。段の中で折り返さないので、
 * `maxItemCount3D` いっぱいの Up は 1 行に伸びる（§7 の論点）。整数でない `count` は切り捨ててから中央揃えする。
 */
export const verticalSpread = (count: number, gap: number): number[] => {
  const items = Math.max(0, Math.trunc(count));
  return Array.from({ length: items }, (_, i) => (i - (items - 1) / 2) * gap);
};

/** `verticalRow` の入力: `Layout.place()` が決めた 2D の中心（帯のシフト済み）と、そのノードの段。 */
export type VerticalEntry = { level: Level; center: Point };

/**
 * Up／Down を帯から外して中心ノートの真上・真下へ移した、各ノードの新しい 2D の中心（§6-5、本人の追記 2）。
 * 入力と同じ並びで返す。
 *
 * - level 0（Parents／Children／Left／Right／Previous／Next）は 2D の帯の中心のまま。床の平行四辺形に残るのはこれだけ。
 * - level ≠ 0 は中心ノートと同じ north の行（`rootCenter.y`。床の十字の東西の線であって、world の north 0 ではない）に、
 *   `verticalSpread` の間隔で東西に並べる。したがって 1 つなら中心の真上・真下、複数なら中心を挟んで等間隔。
 *
 * 同じ level の並び順は 2D の読み順（行＝北から南、同じ行は西から東）。東西の間隔 `gap` は段によらず同じ。
 */
export const verticalRow = (entries: readonly VerticalEntry[], rootCenter: Point, gap: number): Point[] => {
  const centres = entries.map((entry) => ({ ...entry.center }));
  const levels = new Set(entries.map((entry) => entry.level).filter((level) => level !== 0));
  for (const level of levels) {
    const group = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.level === level)
      .sort((a, b) => a.entry.center.y - b.entry.center.y || a.entry.center.x - b.entry.center.x);
    const offsets = verticalSpread(group.length, gap);
    group.forEach(({ index }, i) => {
      centres[index] = { x: rootCenter.x + offsets[i], y: rootCenter.y };
    });
  }
  return centres;
};

/**
 * level 0 の帯（Parents／Children）を中心ノートから最低 `distance`（2D の地面距離。画面では northRise 倍に縮む）
 * 離すための、帯の 2D の y に足す量（LEV-128、本人の指定）。
 *
 * 3D では Up／Down が帯を離れて垂直軸に立つので、帯に残る level 0 が中心に近すぎると Up／Down と重なって読めない。
 * 帯のうち中心にいちばん近い行（Parents なら最も南の行、Children なら最も北の行）が中心から `distance` に届かなければ、
 * 届くところまで帯ごと動かす。`side` は −1 が北（Parents）、+1 が南（Children）。2D は動かさない（`friendBandShift` と同じ）。
 *
 * 既に `distance` より遠い帯は動かさない（0 を返す）。上流の `Layout` は中心の箱の高さ（埋め込みの中心なら
 * `centerEmbedHeight`）に合わせて帯を押し出しているので（`parentsOrigoY` は `heightInCenter` に依る）、そこへ
 * 一定距離を当てはめると帯が中心の箱の中に入る。
 */
export const bandShift = (centerY: number, innermostY: number, distance: number, side: -1 | 1): number => {
  const reach = side * (innermostY - centerY);
  return reach >= distance ? 0 : side * (distance - reach);
};

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
 * y     = −north · northRise − liftOf(level)
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
    y: 0 - north * params.northRise - liftOf(level, params),
    depth: north,
  };
};

/**
 * 描画順（§6-1）: `depth`（north）の大きい順（奥 → 手前）。同じ north なら画面の x の小さい順（西から）で決定的にする。
 * `Array.prototype.sort` の比較関数として `project` の結果を渡す。
 */
export const compareDrawOrder = (a: Projected, b: Projected): number => b.depth - a.depth || a.x - b.x;

/**
 * 画面で `screen` px ぶんの南北の隙間に当たる 2D の地面距離（LEV-130）。投影は南北を `northRise` 倍に縮めるので
 * （`project` の `y = −north · northRise`）、画面で欲しい量から地面の距離を戻すのは割り算になる。方角ラベルのように
 * 「画面で決めた距離」を 2D の座標に置きたいところで使う。`northRise` が 0 以下（設定を手で壊した場合）なら
 * 縮まないものとして `screen` をそのまま返す。
 */
export const groundGapNorthSouth = (screen: number, params: ProjectionParams): number =>
  params.northRise > 0 ? screen / params.northRise : screen;
