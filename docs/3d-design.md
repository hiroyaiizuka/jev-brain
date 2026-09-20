# 3D トグル：フェーズ 0 の調査結果と設計

更新日: 2026-09-20。ブリーフは `docs/3d-brief.md`。高さの元になる Up／Down 領域は `docs/ontology-axis-design.md`（ONT-1）。本書は `src/` を読んで確かめた事実（§1）、本人の回答（§0）、設計（§3）、残る論点（§4）、ロードマップ（§5）。

## 0. 本人の回答（2026-09-20）

| ブリーフ §8 の問い | 回答 | 設計への反映 |
| --- | --- | --- |
| 抽象度の保存場所と形式 | ノートの属性ではなく**リンクの型**。「抽象度アップ」に当たるオントロジー（`up`、`part of` など）を付け、リンクの色と太さで見分けてきた。既定値で決め打ちせず、設定に Up／Down の**領域**を作ってそこに入れる | 高さは「中心ノートとの関係のフィールドが Up／Down のどちらの領域か」で決める（§3-1）。ノート側にデータは要らない。領域は ONT-1 で先に作る |
| 段数と向き | 中心を基準に「上げる」「下げる」「同じ」の 3 段 | 中心＝0、Up の親＝+1、Down の子＝−1、それ以外＝0（地面） |
| 抽象度が無いノートの高さ | 今まで通りでよい。普通の平面 | 地面（0）に置く。Up／Down の関係が 1 つも無い画面では、3D は傾いた 2D になる |
| 3D の永続化 | 起動時は常に 2D | `view3D` は Scene の状態として持ち、設定には保存しない。ヨー角などの数値は設定に保存する |
| 視点の回転 | 明示なし | 固定視点（既定 20°）で先に試す（3D-1）。回転 UI は 3D-2 |
| モバイル | 使わない | `ea.DEVICE.isDesktop` が偽ならトグルを出さない |
| 重なり対策 | 1（帯の間だけ潰す）＋ 3（3D 用 maxItemCount）でまず形を見たい | 3D-1 に含める |

## 1. ソースで確かめたこと

| ブリーフの見立て | 実際 | 影響 |
| --- | --- | --- |
| 位置の計算と描画が分かれていて、間に投影を挟める | 分かれている。`Layout.render()`（`src/graph/Layout.ts`）が全ノードの中心を `node.setCenter({x, y})` で決め、直後に `node.render()` を呼ぶ。座標は中心ノートを (0,0) とした相対値で、親は y が負（北）、子は正（南）、左友は x が負、右友は正、兄弟は右上 | 投影を挟む場所は `Layout.render()` の `setCenter` と `render()` の間の 1 か所。ブリーフの `gx, gy` は `center.x, center.y` そのもの |
| ゲート（小円）・ラベル・埋め込み枠はノードに付いてくるか | 付いてくる。`Node.render()` の中で全部 `this.center` から計算している（`src/graph/Node.ts`） | 中心を動かせばノード一式が動く。Node は無改造でよい |
| リンクはゲート同士の接続 | そのとおり。`Link.render()` が `ea.connectObjects(gateA, null, gateB, null)`。Excalidraw 2.27.3 の実装を読むと、接続点が null のときは **2 要素の中心を結ぶ直線を各要素の輪郭で切った線分** を引き、`startObjectId/endObjectId` で両端を要素に束縛する | ノードを先に置けばリンクは自動で追従する（描画順も今のまま: レイアウト → `links.render()`） |
| ゲートの向きの問題 | 起きる。ゲートは役割で固定（親ゲート＝上、子ゲート＝下）。3D で由来の親が中心より下に投影されると、中心の上ゲートから親の下ゲートへ、両方の箱を突っ切る線になる。箱の背景は既定で半透明（`#00000066`）なので隠れない | 3D のときだけ、投影後の上下関係でゲートを選び直す（`Link.render()` に分岐 1 つ） |
| 描画順は追加順 | そのとおり。`ea.elementsDict` への挿入順が z 順。`Scene.render()` はレイアウトを `Promise.all` で並列描画したあと「リンクを後ろ、ノードを前」に並べ替えている | 3D では全レイアウトの中心を先に決め、depth でソートしてから順に `node.render()` する。`Layout.render()` を「配置」と「描画」に分ける小さなリファクタが要る（2D の経路は変えない） |
| 兄弟のレイアウト | `Scene.render()` の `lSiblings`（右上、`renderSiblings` のときだけ） | 他と同じく投影する |
| ToolsPanel のボタンと状態 | `ToggleButton`（`src/Components/ToggleButton.ts`）に `getVal / setVal / updateIndex / shouldRerenderOnToggle` を渡す。`setVal` が true を返すと `plugin.saveSettings()`。クリックで `scene.reRender(updateIndex)` | 3D トグルは既存パターンで約 20 行。`setVal` で false を返せば保存されない（起動時 2D）。再描画は毎回 `ea.clear()` からの全面描き直し（ノードをクリックしたときと同じコスト） |
| 関係のフィールド名はどこにあるか | `Neighbour.typeDefinition`（カンマ区切りのフィールド名）が `Scene.addNodes()` と `addLinks()` に渡る。`Link` はこれを分解して `hierarchyLinkStyles` の色・太さを当てている（本人の緑の太線はこの経路） | 高さも同じ文字列から決められる。Node に `level` を 1 つ足すだけ |
| クリック・ホバー | `excalibrain-main.ts` の `ea.onLinkClickHook / onLinkHoverHook` が要素の `link` 属性で動く | 位置に依存しないので 3D でも壊れない。柱と影には `link` を付けず、ノードのグループにも入れない |
| 要素数 | テキストノード 1 つ＝約 7〜8 要素、リンク 1 本＝1〜2。隣接 50・リンク 60 でおよそ 460 | 3D は柱＋影で +2/ノード、地面と方角で +5。約 570。実測は test-vault で（未実施） |

## 2. 本人の運用（設定から読み取ったもの）

Evergreens の `hierarchyLinkStyles` で色・太さを変えているフィールド。ONT-1 で本人が Up／Down に移す候補として載せる（決めるのは本人）。

| フィールド | 今の領域 | スタイル | 移す先の候補 |
| --- | --- | --- | --- |
| `up`、`part of`、`subtopic of`、`instance of`、`member of` | Parents | 緑、太さ 4.5 | Up |
| `down`、`next level detail` | Children | 緑、太さ 4.5 | Down |
| `example`、`examples`、`illustrates` | Children | 太さ 1 | Down（細線は残る） |
| `analogous to` | 友 | 緑、太さ 4.5 | そのまま（0） |
| `supported by` | 友 | 矢印を逆向き | そのまま |
| `origin`、`source`、`author`、`based on` など | Parents | 既定 | そのまま（由来の親は地面） |

株式会社Levers の Vault は `up`、`part of`、`next level detail`、`down` だけが緑。

## 3. 設計

### 3-1. 高さの決め方

- 中心ノートは 0。隣接ノードの高さは、中心との関係のフィールド名が `hierarchy.abstract`（Up）／`hierarchy.concrete`（Down）のどちらに入るかで決める:
  - Up のフィールドで結ばれた親 → +1
  - Down のフィールドで結ばれた子 → −1
  - それ以外（Parents／Children の親子、友、前後、推論リンク、フォルダ・タグ・URL・未解決）→ 0
- 1 ノートが複数のフィールドで結ばれている場合（`typeDefinition` がカンマ区切り）は、+1 が 1 つでもあれば +1、無ければ −1 があれば −1。
- フィールドが Up と Down のどちらに入るかは問わず、符号は役割（親＝+1、子＝−1）から取る。親側のノートが `down:` で中心を指した関係も `typeDefinition` は `down` のまま親に付く（`Page.addParent`）ので、その親は +1（LEV-110 の `levelOf`）。
- 兄弟（siblings）は親を介した関係なので 0。
- 3D 固有の設定は追加しない。領域は ONT-1 の設定をそのまま使う。

これで、モックの「行動デザイン（up → Up）」は +1、「読書メモ：習慣の本（origin → Parents）」は 0 で北の地面、子の「歯磨き後に腕立て（example → Down）」は −1 になる。

### 3-2. 投影

```text
// center: Layout が決めた 2D の中心（中心ノート原点）。level: −1 / 0 / +1。
depthScale（既定 0.38）は帯の「間」にだけ掛ける（§4-1）。
rx = gx·cos(yaw) − gy'·sin(yaw)
ry = gx·sin(yaw) + gy'·cos(yaw)
x  = rx · widthScale（既定 0.8）
y  = ry − level · levelHeight
depth = ry
```

- `levelHeight` は `nodeHeight` の倍数（既定 1.5）。`nodeHeight` は `compactingFactor` とフォントから毎回計算されるため px 固定にしない。
- ヨー角は既定 20°、3D-1 では固定。
- 中心ノートも 0 の高さに置き、地面は −1 の高さ（表示中に −1 が無ければ 0）。

### 3-3. 置き場所

```text
src/graph/Projection.ts   新規。純関数。Obsidian・Excalidraw に依存しない → Vitest で単体テスト
  levelOf(typeDefinition, role, hierarchyLowerCase) → -1 | 0 | 1
  project(center, level, params) → { x, y, depth }
  compressBands(bands, depthScale) → 北・中心・南の帯ごとの中心（帯の間の隙間だけ潰す。§4-1）
src/graph/Layout.ts       render() を place()（中心を決める）と renderNodes() に分割。2D は今の順番のまま
src/graph/Node.ts         level を 1 つ持つ（既定 0）。描画は無改造
src/Scene.ts              render() に分岐 1 つ: 3D なら place → level → project → depth 順に render → 柱・影・地面
src/graph/Link.ts         3D のときだけ、投影後の上下でゲートを選ぶ
src/Components/ToolsPanel.ts  3D トグル（デスクトップのみ表示）。3D-2 でヨー角
src/Settings.ts           yaw / levelHeight / depthScale / widthScale / maxItemCount3D / showPillars / showGround（3D-2 で画面に出す。3D-1 は既定値のまま）
```

`view3D` は `Scene` のフィールド（起動時 false）。トグルの `setVal` は false を返して設定を保存しない。

### 3-4. 柱・影・地面

- 柱: `ea.addLine` を `strokeStyle: "dashed"`、リンクより薄い色で、箱の下端から地面へ。地面にいるノードには引かない。
- 影: 小さな楕円を地面の位置に（地面にいないノードだけ）。
- 地面: 平行四辺形 1 つと北・南・西・東のラベル。`showGround` で消せる。
- いずれもリンクと同じ「ノードの後ろ」に並べる。

### 3-5. 描画順

奥（depth 小）から手前へ。`Promise.all` をやめて 3D のときだけ逐次 `await node.render()`。

## 4. 残る論点

1. **帯の間だけ潰す**の具体: 北の帯（親）・中心の帯（左右友と中心）・南の帯（子）の各帯の内部は 2D の行間のまま、帯と帯の隙間（`parentsOrigoY` と `childrenOrigoY` が作る余白）だけ `depthScale` を掛ける。帯の中の行間を潰さないので同じ段の箱は重ならない。その代わり画面は 2D より高くなる。3D 用 `maxItemCount3D`（既定 12）で行数を抑える。実機で見て決める。
2. リンクの見た目は 2D と同じ（色・太さは領域とフィールド別スタイルのまま）。高さの差はリンクの長さに出る。
3. 逆転の強調（親なのに −1、子なのに +1）は領域で高さが決まるため起きない。外す。

## 5. ロードマップ

| フェーズ | 内容 | 受入の目安 |
| --- | --- | --- |
| ONT-1 | Up／Down 領域（`docs/ontology-axis-design.md`）。3D-1 の前提 | 同文書 §4 |
| 3D-1 | `Projection.ts`（levelOf / project / compressBands）と単体テスト、Layout の分割、Node.level、Scene の分岐、固定ヨー 20°、トグル（デスクトップのみ・非永続）、柱・影・地面、ゲート選び直し、`maxItemCount3D` | ブリーフ §7 の 8 ノート Vault（`up` を Up、`origin` を Parents、`example` を Down に設定）で「行動デザイン」が +1、「読書メモ」が北の地面、「歯磨き」が −1。オフで元の配置。クリックで中心が移る。2D の回帰なし（既存ケース E01〜E03）。親 12・子 12 の fixture で箱が重ならない |
| 3D-2 | ヨー角の UI（15° 刻み）、設定画面（levelHeight / depthScale / widthScale / showPillars / showGround） | ヨーを変えても 1 回の再描画で済む |
| 3D-3 | 実測（要素数・描画時間）と重なりの追加対策 | 親 20・子 30 の fixture の記録が `artifacts/` にある |
