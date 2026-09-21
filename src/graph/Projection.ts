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
 * そのノードが垂直軸（Up／Down）に立つか（§6-5）。床の平行四辺形の帯に残るのは level 0 だけ。
 * 「床の平面を描く段」である `FLOOR_LEVEL` とは別の判断なので、こちらを使う（§7 で段が増えても壊れない）。
 */
export const isOnAxis = (level: Level): boolean => level !== 0;

/**
 * 3D の上限の配り方（§6-7、LEV-127）: 垂直軸（Up／Down）と床の帯を別々に切って混ぜる。
 *
 * 1 つの上限を共有して先頭から切ると、`Page` の並び順しだいで垂直軸のノードが帯のノートに押し出される
 * （本人の「ダウンを追加してるのに 4 個しか出ない」: 子 15 件のうち先頭 12 件が残り `down` は 4 件だけだった）。
 * 逆に垂直軸を優先するだけだと、軸のノードが上限に届いた時点で帯が丸ごと消える。そこで軸と帯で別々の上限を持つ。
 * 軸は折り返す（`verticalSpread`）ので `列数 × 行数` まで置ける。並び順はそれぞれの中で保つ。
 */
export const limitByAxis = <T>(
  items: readonly T[],
  levelOfItem: (item: T) => Level,
  limits: { axis: number; band: number },
): T[] => {
  const onAxis: T[] = [];
  const onBand: T[] = [];
  for (const item of items) (isOnAxis(levelOfItem(item)) ? onAxis : onBand).push(item);
  return [...onAxis.slice(0, Math.max(0, limits.axis)), ...onBand.slice(0, Math.max(0, limits.band))];
};

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
  /**
   * 床の外周の範囲。足元（`feet` と `origin`）と箱の横幅をすべて含む最小の長方形に四方 `margin` を足し、さらに
   * `reach`（中心からの最低の奥行き、LEV-128）と `balance`（左右の釣り合い、LEV-135）で広げたもの。
   * 広げるだけなので、足元と、床の上にいる箱（level 0）は必ず内側にある。浮いている箱（Up／Down）は
   * 高さの傾き（`heightShearX`、LEV-137）で東／西へ動くので、床の縁より外に出ることがある（空中なので構わない）。
   */
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

/** `floorPlan` の寸法。どれも 2D の地面の距離で、Scene が nodeHeight と設定から作る。 */
export type FloorPlanOptions = {
  /** グリッドの間隔（Scene は nodeHeight）。 */
  spacing: number;
  /** 足元のまわりに残す余白（既定は `spacing`。Scene は `floorMarginFactor × nodeHeight`）。 */
  margin?: number;
  /** 方角ラベルを外周から離す量（既定は `margin` の半分）。南北は投影で縮むので Scene が `groundGapNorthSouth` で戻して渡す。 */
  compassGap?: CompassGap;
  /** 中心の足元から最低これだけは広げる奥行き（既定 0、LEV-128）。 */
  reach?: FloorReach;
  /**
   * 床の左右を中心ノート（＝ Up／Down の垂直軸）に対して釣り合わせる（LEV-135）。省略すると足元を囲む最小の範囲のまま。
   * どちらも足りない側へ広げるだけで、狭めない。
   *
   * - `at: "centre-line"`: 平行四辺形の中心線（北の辺の中点と南の辺の中点を結ぶ線。中心ノートの行で西端と東端が
   *   等距離になるのと同じこと）が中心ノートを通るようにする。2D の東西を `origin.x` に対して対称にするだけで、
   *   傾きは効かない。十字の東西の腕と W／E も軸に対して対称になる。
   * - `at: "corners"`: 投影後の左端（南西の角）と右端（北東の角）が中心ノートの足元から等距離になるようにする。
   *   平行四辺形の外接で見たときに釣り合うが、中心線は `(south − north) × shear` ぶん西へずれる。
   *
   * `shear` は投影の傾き（`northShearX`）。`"corners"` のときだけ使う。
   */
  balance?: { shear: number; at: "centre-line" | "corners" };
};

/**
 * 床の範囲・グリッド・十字・方角の位置（§6-2）。`feet` は各ノードの影の足元（2D の中心。足元は影を描いていた頃と同じ点）と
 * 箱の幅（幅の広い箱が床の東西の縁や W／E を隠さないよう、東西は箱の横幅も覆う。南北は足元だけ）、`origin` は中心ノートの
 * 足元（十字はここを通り、グリッドはここを基準に `spacing` 間隔）。`origin` も範囲に含めるので十字は必ず床の内側にある。
 * 寸法は `FloorPlanOptions`。足元が 1 つも無ければ（`origin` だけでも）その点の周りに余白だけの床を返す。
 */
export const floorPlan = (feet: readonly Foot[], origin: Point, options: FloorPlanOptions): FloorPlan => {
  const { spacing, margin = spacing, reach = { north: 0, south: 0 }, balance } = options;
  const compassGap = options.compassGap ?? { x: margin / 2, north: margin / 2, south: margin / 2 };
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
  // 左右の釣り合い（LEV-135）: 「垂直軸（中心ノート）が床の左右の真ん中に来る」よう、足りない側へ広げる（狭めない）。
  // どちらの基準でも、足元や箱の幅の東西の偏り（西と東でラベルの長さが違う Vault）も一緒に打ち消すので床は広くなる（§7 の論点）。
  //   - "centre-line": 平行四辺形の中心線を中心ノートに通す。2D の東西を origin.x 対称にするだけ（傾きは効かない）。
  //   - "corners": 投影後の左端（南西の角 = minX − maxY·shear）と右端（北東の角 = maxX − minY·shear）を
  //     中心ノートの足元（origin.x − origin.y·shear）から等距離にする。`project` の `x = gx − gy·shear` の展開。
  if (balance) {
    const target = balance.at === "corners"
      ? 2 * origin.x + (bounds.minY + bounds.maxY - 2 * origin.y) * balance.shear
      : 2 * origin.x;
    const diff = target - (bounds.minX + bounds.maxX);
    if (diff < 0) bounds.minX += diff;
    else bounds.maxX += diff;
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
 * 床の平面を、中心の段（`FLOOR_LEVEL`）の投影から**画面で**下げる量（px、§6-2「中心のメモのノードのちょい下」）。
 * これは段（高さ）ではなく画面上のオフセットなので、高さの傾き（`heightShearX`、LEV-137）は掛けない: 床は
 * 真下に沈むだけで、東西には動かない。
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
  /**
   * 高さ 1px につき画面 x を右へ動かす量（既定 0.64。本人が実機と壁打ちのページで決めた。LEV-137）。
   * 床を右斜め上から見た形にしているので、その上に立つものも同じ向きに倒れて見えるのが筋。0 にすると
   * 高さだけ正面から見た位置に残り、上の段が西の縁に寄って見える（本人のフィードバック 6）。
   * 床の南北の線と完全に平行にするなら `northShearX / northRise`（既定で 1.33）だが、本人が選んだのはその手前。
   */
  heightShearX: number;
  /** Up（level > 0）1 段ぶんの高さ（px）。 */
  upHeight: number;
  /** Down（level < 0）1 段ぶんの深さ（px）。 */
  downHeight: number;
  /**
   * 同じ段の中で折り返した 1 行ぶんの高さ（px、LEV-127）。段の高さ（`upHeight`／`downHeight`）より
   * はっきり小さくして、「段（抽象度）」と「行（あふれ）」を見分けられるようにする。
   */
  rowLift: number;
};

/**
 * 段の高さ（px、上が正）。level 0 は 0、Up は `upHeight`、Down は `downHeight`（LEV-128）。
 * `row` は同じ段の中であふれて折り返した行（0 が中心に近い、LEV-127）。段の高さより小さい `rowLift` ずつ、
 * Up はさらに上へ、Down はさらに下へ積む。
 */
export const liftOf = (level: Level, params: ProjectionParams, row = 0): number =>
  level > 0 ? level * params.upHeight + row * params.rowLift
    : level < 0 ? level * params.downHeight - row * params.rowLift
      : 0;

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
 * ここで決めるのは 2D の地面座標。画面では高さの傾き（`heightShearX`、LEV-137）のぶん Up は東、Down は西へ倒れる。
 *
 * 1 つなら中央（2D では中心の真上・真下）、n 個なら中心を挟んで `gap` 間隔の中央揃え（`Layout.place()` が列を中央に
 * 揃えるのと同じ規則）。`gap` は設定 `verticalGapFactor × nodeHeight`（LEV-128 で帯の `columnWidth` から変えた:
 * 垂直軸は帯を離れているので、帯の列幅ではなく 3D 専用の間隔で並べる）。
 *
 * `columns` の数で折り返し、あふれた行は `row` 1, 2… になる（LEV-127、本人の指定で既定 5 列）。
 * 行は `liftOf` が `rowLift` ずつ Up は上へ、Down は下へ積む。整数でない `count` は切り捨ててから中央揃えし、
 * `columns` が数でなければ 1 列に落とす（設定が壊れていても描画を止めない）。
 *
 * 床の帯を組み直す `regridBand`（§6-8）も、東西の揃え方はこれをそのまま使う（間隔は帯の `columnWidth`、
 * 行は高さではなく南北に積む）。半端な行の中央揃えの規則は 1 か所にしておく。
 */
export const verticalSpread = (count: number, gap: number, columns: number): VerticalSlot[] => {
  const items = Math.max(0, Math.trunc(count));
  // 設定が壊れていても（NaN・0・負）1 列に落として描画を止めない
  const perRow = Number.isFinite(columns) ? Math.max(1, Math.trunc(columns)) : 1;
  const slots: VerticalSlot[] = [];
  for (let start = 0, row = 0; start < items; start += perRow, row++) {
    const n = Math.min(perRow, items - start);
    for (let i = 0; i < n; i++) slots.push({ dx: (i - (n - 1) / 2) * gap, row });
  }
  return slots;
};

/** `verticalRow` の入力: `Layout.place()` が決めた 2D の中心（帯のシフト済み）と、そのノードの段。 */
export type VerticalEntry = { level: Level; center: Point };

/** `verticalSpread` の 1 つ分: 中心からの東西のずらし量と、折り返した行（0 が中心にいちばん近い）。 */
export type VerticalSlot = { dx: number; row: number };

/** `verticalRow` の結果: 置き直した 2D の中心と、その行（`project` の第 4 引数に渡す）。 */
export type VerticalPlacement = { center: Point; row: number };

/**
 * Up／Down を帯から外して中心ノートの真上・真下へ移した、各ノードの新しい 2D の中心（§6-5、本人の追記 2）。
 * 入力と同じ並びで返す。
 *
 * - level 0（Parents／Children／Left／Right／Previous／Next）は 2D の帯の中心のまま。床の平行四辺形に残るのはこれだけ。
 * - level ≠ 0 は中心ノートと同じ north の行（`rootCenter.y`。床の十字の東西の線であって、world の north 0 ではない）に、
 *   `verticalSpread` の間隔で東西に並べる。2D では 1 つなら中心の真上・真下、複数なら中心を挟んで等間隔。
 *   画面上の位置は `project` が決め、高さの傾き（LEV-137）のぶん Up は東、Down は西へずれる。
 *
 * 同じ level の並び順は 2D の読み順（行＝北から南、同じ行は西から東）。東西の間隔 `gap` は段によらず同じ。
 * `columns` を渡すとその数で折り返し、あふれた行の `row` が 1, 2… になる（LEV-127）。足元（`center`）は
 * どの行も中心の行のままで、行は高さ（`liftOf` の `rowLift`）だけで表す。床の広さは足元で決まるので、
 * 折り返しても床は横に伸びない。
 */
export const verticalRow = (
  entries: readonly VerticalEntry[],
  rootCenter: Point,
  gap: number,
  columns: number,
): VerticalPlacement[] => {
  const placements: VerticalPlacement[] = entries.map((entry) => ({ center: { ...entry.center }, row: 0 }));
  const levels = new Set(entries.map((entry) => entry.level).filter(isOnAxis));
  for (const level of levels) {
    const group = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.level === level)
      .sort((a, b) => a.entry.center.y - b.entry.center.y || a.entry.center.x - b.entry.center.x);
    const slots = verticalSpread(group.length, gap, columns);
    group.forEach(({ index }, i) => {
      placements[index] = { center: { x: rootCenter.x + slots[i].dx, y: rootCenter.y }, row: slots[i].row };
    });
  }
  return placements;
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

/**
 * `regridBand` が使う帯の形（`LayoutSpecification` のうち列の組み直しに要るものだけ）。
 */
export type BandGrid = {
  /**
   * 1 行に並べる数（帯の `columns`）。残った数から取り直さない: 列数は `Scene.calculateLayoutParams` が
   * 帯の全件数から決めていて、帯の幅（`leftFriendOrigoX` などの東西の余白）もその数で計算済みなので、
   * ここで狭めると友の帯との間だけが空く。
   */
  columns: number;
  /** 列の間隔（帯の `columnWidth`。ラベルの長さとフォントから決まる箱の幅＋余白）。 */
  columnWidth: number;
  /** 行の間隔（帯の `rowHeight`）。 */
  rowHeight: number;
  /** 中心にいちばん近い行がどちらの端か: −1 = 北の帯（Parents なら最も南の行）、+1 = 南の帯（Children なら最も北の行）。 */
  side: -1 | 1;
};

/**
 * 床の帯（Parents／Children）に残った level 0 のノードだけで列を組み直す（§6-8、LEV-145）。
 * 入力と同じ並びで新しい 2D の中心を返す。
 *
 * Up／Down を垂直軸へ抜く（`verticalRow`）と、帯は 2D の格子の穴が開いたままになる: 上流の `Layout.place()` は
 * 帯の全件数で列を割り当てているので、残ったノードが列の端に取り残されて中心の真北・真南からずれる
 * （実機では 4 つの親のうち `origin` の 1 つだけが残り、2 列の東側 ＝ 中心から columnWidth/2 東に立っていた）。
 *
 * - 東西は行ごとの中央揃えで、`verticalSpread` をそのまま使う（垂直軸と同じ規則。半端な行の揃え方と、列数が
 *   壊れていたときの 1 列への落とし方を 1 か所にしておく）。間隔は帯の `columnWidth`、中心は `origin.x`
 *   ＝ 中心ノートの x。1 行が満杯なら `Layout.place()` と同じ位置になる。上流の `Layout.layout()` の行ベクトル
 *   （`getRowLayout`）は使わない: 半端な行を列に振り分ける作りが中心に対して非対称で、2 列に 1 つだと西、
 *   3 列に 2 つだと東へずれる（この不揃いを直すのがこのチケット）。
 * - 南北は読み順（北から南）のまま `rowHeight` 間隔で、中心にいちばん近い行を `origin.y` に置く。`origin.y` には
 *   帯が `place()` で占めていた内側の縁を渡すので、帯は中心から遠ざからず、丸ごと空いた行があればそのぶん中心側へ
 *   詰まる。続く `bandShift`（§6-6）は詰めたあとの内側の行から測る（それでも `bandDistance` より遠ければ動かさない）。
 *
 * 並べ替えの基準は入力の中心（行＝北から南、同じ行は西から東）なので、`Layout` が並べたタイトル順がそのまま残る。
 */
export const regridBand = (centers: readonly Point[], origin: Point, grid: BandGrid): Point[] => {
  const order = centers
    .map((center, index) => ({ center, index }))
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
  const slots = verticalSpread(order.length, grid.columnWidth, grid.columns);
  const rows = slots.length > 0 ? slots[slots.length - 1].row + 1 : 0;
  const placed = new Array<Point>(centers.length);
  order.forEach(({ index }, i) => {
    // 読み順の行は北から南。北の帯（side −1）は最後の行が中心にいちばん近いので、そこを `origin.y` にする
    const fromInner = grid.side < 0 ? rows - 1 - slots[i].row : slots[i].row;
    placed[index] = {
      x: origin.x + slots[i].dx,
      y: origin.y + grid.side * fromInner * grid.rowHeight,
    };
  });
  return placed;
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
 * lift  = liftOf(level, params, row)        高さ（px、上が正。row は折り返した行、LEV-127）
 * x     = gx + north · northShearX + lift · heightShearX
 * y     = −north · northRise − lift
 * depth = north
 * ```
 *
 * 東西は水平のまま（2D の横並びが崩れない）、南北は右上がりの斜め（北が右上・奥、南が左下・手前）、
 * 高さは `heightShearX` のぶん東へ倒れる（LEV-137。0 なら真上）。
 * 中心ノート（gx = gy = 0、level 0）は原点に留まる: `retainCentralNode` で保持した埋め込みの中心の要素は
 * 前回の描画位置のままなので、2D（Layout が原点に置く）と 3D で中心が同じ場所にある必要がある。床は
 * `project(center, FLOOR_LEVEL, params)` の少し下（中心の箱の下端）を通る（§6-2）。
 *
 * 入力の検査はしない（params は設定の値から作る）。`0 - gy` は `-gy` が 0 を −0 にするのを避けるため。
 */
export const project = (center: Point, level: Level, params: ProjectionParams, row = 0): Projected => {
  const north = 0 - center.y;
  const lift = liftOf(level, params, row);
  return {
    x: center.x + north * params.northShearX + lift * params.heightShearX,
    y: 0 - north * params.northRise - lift,
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
