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
 * 関係のフィールドとは無関係に高さを 0 に固定する、対象ノードの属性（§3-1 の「兄弟は 0」「未解決は 0」）。
 * 兄弟の Neighbour は親の `getChildren()` 由来で「兄弟→親」のフィールドを持ち、未解決（ゴースト）は
 * `addUnresolvedPage` のあと定義済みのフィールドで結ばれるので、`typeDefinition` だけでは見分けられない。
 */
export type LevelSubject = {
  /** `Scene.addNodes` の `isSibling`。 */
  isSibling?: boolean;
  /** `Page.isVirtual`（ファイルの無い未解決リンク）。 */
  isVirtual?: boolean;
};

/**
 * 中心ノートとの関係から隣接ノードの高さを決める。
 *
 * - 兄弟・未解決ページ（`subject`）→ 0
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
  if (subject.isSibling || subject.isVirtual) return 0;
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
 * 床の高さ（§6-1）: 画面内の最小 level。中心ノードは常に 0 なので 0 から始め、Down の子（−1）があれば −1。
 * 空でも 0。床にいるノード（level === floor）には柱も影も描かない（接地影は §6-2、LEV-120）。
 */
export const floorOf = (levels: readonly Level[]): Level => levels.reduce<Level>((floor, level) => (level < floor ? level : floor), 0);

export type Point = { x: number; y: number };

/** 箱（中心と大きさ）の並びが占める 2D の範囲。地面の平行四辺形はこれに余白を足して投影する。 */
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/** `boundsOf` の入力。`x`/`y` は中心。 */
export type Box = Point & { width: number; height: number };

/** 箱の外周の範囲に `margin` を四方に足したもの。空なら null。 */
export const boundsOf = (boxes: readonly Box[], margin = 0): Bounds | null => {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x - box.width / 2);
    maxX = Math.max(maxX, box.x + box.width / 2);
    minY = Math.min(minY, box.y - box.height / 2);
    maxY = Math.max(maxY, box.y + box.height / 2);
  }
  return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin };
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
 * `project(center, floor, params)`（`floorOf` の高さ）で、床が −1 なら原点の `levelHeight` 下を通る。
 * 画面全体をどこに置くかは平行移動の違いでしかなく、§6-1 の「中心ノートの足元が原点」と見た目は同じ。
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
