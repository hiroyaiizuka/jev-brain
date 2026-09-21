/**
 * 初期ズーム（`zoomToFit`）の対象を選ぶ純関数（docs/3d-design.md §7、LEV-144）。
 * Obsidian・Excalidraw に依存しない。実際に倍率を動かすのは `Scene.zoomToFitNodes()`。
 */

/** id しか見ないので、Excalidraw の要素をそのまま渡せる（テストは `{id}` で足りる）。 */
export type Identified = { id: string };

/**
 * 床と方角を外し、ノードとリンクだけを `zoomToFit` の対象にする。
 *
 * 床は中心から奥・手前へ最低の広がりを持つ（`floorNorthFactor`／`floorSouthFactor`、§6-6）ので、ノートが
 * 少ないほど床がビューポートを決めてしまい、8 ノートの fixture では倍率が 2D の 50% に対して 35% まで落ちていた
 * （§7 の開いている論点）。床は脇役なので、画面からはみ出してよい。
 *
 * - `sceneryIds` が空（2D）なら入力をそのまま返す。2D の経路は上流のまま変えない。
 * - 除いた結果が空になるときも入力をそのまま返す。空の配列を渡すと Excalidraw が合わせる先を失う。
 *   3D にノードが 1 つも無い画面は起きない（中心ノートは必ず描く）が、床だけを画面いっぱいに広げるより
 *   これまでの挙動に倒すほうが安全。
 */
export const zoomTargets = <T extends Identified>(
  elements: readonly T[],
  sceneryIds: ReadonlySet<string>,
): readonly T[] => {
  if (sceneryIds.size === 0) return elements;
  const targets = elements.filter((element) => !sceneryIds.has(element.id));
  return targets.length === 0 ? elements : targets;
};
