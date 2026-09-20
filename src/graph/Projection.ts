import { Role } from "src/Types";

/**
 * 3D 表示の計算だけを置く純関数群（docs/3d-design.md §3-1・§3-2・§4-1）。
 * Obsidian・Excalidraw に依存しない。中心の決定は Layout、描画は Scene / Node が担う。
 */

/** 中心ノートを基準にした高さ。+1 = Up の親、-1 = Down の子、0 = 地面。 */
export type Level = -1 | 0 | 1;

/**
 * Up／Down 領域のフィールド名（ONT-1 の `hierarchyLowerCase.abstract` / `.concrete`）。
 * 要素は `plugin.hierarchyLowerCase` と同じく小文字・空白→ハイフンに正規化済みであること。
 */
export type LevelHierarchy = {
  abstract: readonly string[];
  concrete: readonly string[];
};

/** フィールド名を `hierarchyLowerCase` と同じ形（前後の空白を落とし、小文字、空白→ハイフン）にそろえる。 */
export const normalizeFieldName = (field: string): string =>
  field.trim().toLowerCase().replaceAll(" ", "-");

/** カンマ区切りの `typeDefinition` を正規化済みフィールド名の配列にする。空の要素は落とす。 */
export const splitTypeDefinition = (typeDefinition: string | undefined): string[] =>
  (typeDefinition ?? "")
    .split(",")
    .map(normalizeFieldName)
    .filter((field) => field.length > 0);

/**
 * 中心ノートとの関係から隣接ノードの高さを決める。
 *
 * - 親（`Role.PARENT`）で、フィールドのどれかが Up／Down 領域に入る → +1
 * - 子（`Role.CHILD`）で、フィールドのどれかが Up／Down 領域に入る → -1
 * - それ以外（Parents／Children の親子、左右の友、推論リンク、file-tree・tag-tree）→ 0
 *
 * `typeDefinition` の各フィールドは Up でも Down でもよい。親子の向きは Page が既に決めていて、
 * 親が `down: [[中心]]` と書いた場合も `typeDefinition` は `down` のまま親側に付く（Page.addParent）ので、
 * 領域に入るかどうかだけを見て、符号は役割から取る。推論リンク（`typeDefinition` 無し）は 0。
 */
export const levelOf = (
  typeDefinition: string | undefined,
  role: Role,
  hierarchy: LevelHierarchy,
): Level => {
  if (role !== Role.PARENT && role !== Role.CHILD) return 0;
  const fields = splitTypeDefinition(typeDefinition);
  const onAxis = fields.some(
    (field) => hierarchy.abstract.includes(field) || hierarchy.concrete.includes(field),
  );
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
 * §3-2 の式。`center` は Layout が決めた 2D の中心（中心ノート原点、`compressBands` 適用後）。
 *
 * ```text
 * rx = gx·cos(yaw) − gy·sin(yaw)
 * ry = gx·sin(yaw) + gy·cos(yaw)
 * x  = rx · widthScale
 * y  = ry − level · levelHeight
 * depth = ry
 * ```
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

/** 帯に入れるノード 1 つぶん。`y` は中心、`height` は箱の高さ（Layout の `rowHeight` でよい）。 */
export type BandItem = { y: number; height: number };

/** 北（親・兄弟）・中心（中心ノートと左右の友）・南（子）の 3 帯。 */
export type Bands<T extends BandItem> = { north: T[]; center: T[]; south: T[] };

type Extent = { top: number; bottom: number };

const extentOf = (items: readonly BandItem[]): Extent | null => {
  if (items.length === 0) return null;
  let top = Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    top = Math.min(top, item.y - item.height / 2);
    bottom = Math.max(bottom, item.y + item.height / 2);
  }
  return { top, bottom };
};

const shiftBand = <T extends BandItem>(items: readonly T[], shift: number): T[] =>
  items.map((item) => ({ ...item, y: item.y + shift }));

/**
 * §4-1: 帯と帯の「隙間」だけを `depthScale` 倍に潰す。帯の中の行間は変えないので、同じ段の箱は重ならない。
 *
 * 隙間は箱の縁で測る（北の帯の最下端と中心の帯の最上端、中心の帯の最下端と南の帯の最上端）。
 * 隙間が 0 以下（既に接している・重なっている）なら動かさない。中心の帯が空なら何もしない。
 * `depthScale` は 0（帯が接する）〜1（2D のまま）に丸める。入力は変更せず、新しい配列を返す。
 */
export const compressBands = <T extends BandItem>(bands: Bands<T>, depthScale: number): Bands<T> => {
  const scale = Number.isFinite(depthScale) ? Math.min(1, Math.max(0, depthScale)) : 1;
  const center = extentOf(bands.center);
  const north = extentOf(bands.north);
  const south = extentOf(bands.south);

  const northGap = center && north ? center.top - north.bottom : 0;
  const southGap = center && south ? south.top - center.bottom : 0;
  const northShift = northGap > 0 ? northGap * (1 - scale) : 0;
  const southShift = southGap > 0 ? southGap * (1 - scale) : 0;

  return {
    north: shiftBand(bands.north, northShift),
    center: shiftBand(bands.center, 0),
    south: shiftBand(bands.south, -southShift),
  };
};
