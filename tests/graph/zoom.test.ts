import { describe, expect, it } from 'vitest';
import { zoomTargets } from 'src/graph/zoom';

/**
 * 初期ズームの対象（docs/3d-design.md §7、LEV-144）。`Scene.render()` が `zoomToFit` に渡す配列を作る部分だけを
 * 純関数にしてある。要素は id しか見ないので、Excalidraw の要素の代わりに id と役割だけの形で並べる。
 * 並びは `Scene.render()` が `ea.elementsDict` に入れる順（床 → リンク → ノード）に合わせた。
 */
const scene = Object.freeze([
  { id: 'floor-outline' },
  { id: 'floor-grid-1' },
  { id: 'floor-cross-ew' },
  { id: 'compass-n' },
  { id: 'link-1' },
  { id: 'node-centre' },
  { id: 'node-up' },
].map((element) => Object.freeze(element)));
const sceneryIds = new Set(['floor-outline', 'floor-grid-1', 'floor-cross-ew', 'compass-n']);

describe('zoomTargets', () => {
  it('3D では床と方角を外し、ノードとリンクだけを残す', () => {
    expect(zoomTargets(scene, sceneryIds)).toEqual([
      { id: 'link-1' },
      { id: 'node-centre' },
      { id: 'node-up' },
    ]);
  });

  it('2D（床の id が無い）では入力をそのまま返す', () => {
    const flat = [{ id: 'link-1' }, { id: 'node-centre' }];
    expect(zoomTargets(flat, new Set<string>())).toBe(flat);
  });

  it('床の id が画面に無ければ何も外さない（前回の描画の id が残っていても倍率は変わらない）', () => {
    const flat = [{ id: 'link-1' }, { id: 'node-centre' }];
    //一致が 0 件でも filter は新しい配列を作るので、同じ参照ではなく同じ内容であることを見る
    expect(zoomTargets(flat, sceneryIds)).toEqual(flat);
  });

  it('全部が床のときは入力を返す（空の配列を渡すと合わせる先が無くなる）', () => {
    const onlyFloor = [{ id: 'floor-outline' }, { id: 'compass-n' }];
    expect(zoomTargets(onlyFloor, sceneryIds)).toBe(onlyFloor);
  });

  it('入力が空でも落ちない', () => {
    expect(zoomTargets([], sceneryIds)).toEqual([]);
  });

  it('入力の配列も要素も書き換えない（凍結した fixture で落ちないこと）', () => {
    const before = scene.map((element) => element.id);
    const targets = zoomTargets(scene, sceneryIds);
    expect(scene.map((element) => element.id)).toEqual(before);
    //返すのは入力の要素そのもの。Scene はこれを Excalidraw に渡すので、複製を作ってはいけない
    targets.forEach((target) => expect(scene).toContain(target));
  });
});
