import { Role } from "src/Types";

/**
 * 3D 表示の計算だけを置く純関数群（docs/3d-design.md §3-1・§3-2・§4-1）。
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

export type Point = { x: number; y: number };

export type ProjectionParams = {
  /** ヨー角（度）。3D-1 は 20° 固定。 */
  yawDegrees: number;
  /** 回転後の x に掛ける倍率（既定 0.8）。 */
  widthScale: number;
  /** 1 段ぶんの高さ（px）。`nodeHeight` × 倍率（既定 1.5）を呼び出し側で計算して渡す。 */
  levelHeight: number;
};

export type Projected = {
  x: number;
  y: number;
  /** 奥行き。小さいほど奥（北）。描画は depth の昇順。高さ（level）には依存しない。 */
  depth: number;
};

/**
 * §3-2 の式。`center` は Layout が決めた 2D の中心（中心ノート原点、`compressBands` のずれ適用後）。
 *
 * ```text
 * rx = gx·cos(yaw) − gy·sin(yaw)
 * ry = gx·sin(yaw) + gy·cos(yaw)
 * x  = rx · widthScale
 * y  = ry − level · levelHeight
 * depth = ry
 * ```
 *
 * 入力の検査はしない（params は設定の既定値から作る）。
 */
export const project = (center: Point, level: Level, params: ProjectionParams): Projected => {
  const yaw = (params.yawDegrees * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const rx = center.x * cos - center.y * sin;
  const ry = center.x * sin + center.y * cos;
  return {
    x: rx * params.widthScale,
    y: ry - level * params.levelHeight,
    depth: ry,
  };
};

/** 帯が占める y の範囲（上端・下端）。Layout なら `top` と `top + rows·rowHeight`。 */
export type BandExtent = { top: number; bottom: number };

/**
 * 北（親）・中心（中心ノートと左右の友）・南（子）の 3 帯。無い帯は null。
 * 兄弟は北の帯に入れない（親より中心に近い下端を持ちうるので隙間の測定を狂わせる）。
 * 兄弟には北のずれをそのまま適用する。
 */
export type BandExtents = {
  north: BandExtent | null;
  center: BandExtent | null;
  south: BandExtent | null;
};

/** 各帯の y に足す量。北は正（南へ寄る）、南は負（北へ寄る）。中心の帯は動かない。 */
export type BandShifts = { north: number; south: number };

/** `{ y, height }`（中心と箱の高さ）の並びから帯の範囲を求める。空なら null。 */
export const extentOf = (items: readonly { y: number; height: number }[]): BandExtent | null => {
  if (items.length === 0) return null;
  let top = Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    top = Math.min(top, item.y - item.height / 2);
    bottom = Math.max(bottom, item.y + item.height / 2);
  }
  return { top, bottom };
};

/**
 * §4-1: 帯と帯の「隙間」だけを `depthScale` 倍に潰す量を返す。帯の中は同じ量だけ動くので行間は変わらない。
 *
 * 隙間は北の帯の下端と中心の帯の上端、中心の帯の下端と南の帯の上端で測る。
 * 隙間が 0 以下（既に接している・重なっている）なら動かさない。中心の帯が無ければ何もしない。
 * `depthScale` は 0（帯が接する）〜1（2D のまま）に丸め、NaN は 1 とみなす。
 */
export const compressBands = (extents: BandExtents, depthScale: number): BandShifts => {
  const scale = Number.isNaN(depthScale) ? 1 : Math.min(1, Math.max(0, depthScale));
  /** 隙間を減らす量（0 以上）。 */
  const squeeze = (gap: number): number => (gap > 0 ? gap * (1 - scale) : 0);
  const { north, center, south } = extents;
  const northShift = center && north ? squeeze(center.top - north.bottom) : 0;
  const southShift = center && south ? squeeze(south.top - center.bottom) : 0;
  return { north: northShift, south: 0 - southShift }; // `-x` だと 0 が -0 になるので 0 - x
};
