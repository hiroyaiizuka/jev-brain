# jev-brain 製品計画

更新日: 2026-09-20

リポジトリの説明は「jev assisted 3d excalibrain」。ExcaliBrain（Obsidian の編集可能なグラフビュー）のフォークで、次を加える。順序と依存は `docs/roadmap.md`。

1. **Up／Down 領域**: オントロジーの設定に、Parents／Children と並ぶ「Up（抽象）」「Down（具体）」の領域を足す。入れたフィールドの関係は 2D で専用の色になる。設計は `docs/ontology-axis-design.md`。
2. **3D トグル**: Up の親を上、Down の子を下、それ以外を地面に置いた疑似 3D に切り替える検査モード。設計は `docs/3d-design.md`、経緯は `docs/3d-brief.md`。
3. **Jev でリンクに型を付ける**: `[[X]]` の上でホットキーを押すと Jev がフィールドを順位付けし、`(field:: [[X]])` に書き換える。フォーク本体ではなく別プラグイン。設計は `docs/jev-link-typer-design.md`。

本書は受入条件の正本で、進捗は Linear、検証手順は `docs/harness.md`、証跡は `artifacts/`。

## 1. 現状

- 上流 zsviczian/excalibrain 0.2.18 に作者の code scanner fixes を重ねた状態（2026-09-20 取り込み）。
- 開発ハーネス（`npm run check`、test-vault、リリース workflow、AGENTS.md、docs）を Mappy と同じ作りで整備した。
- 配布は未公開。BRAT・コミュニティ登録は未着手。
- 上流の型エラー 26 件を型だけの変更で解消した。挙動の差分は実機未確認。
- 3D のフェーズ 0（ソース調査）完了。本人の回答で、高さの元は Up／Down 領域、起動時は 2D、モバイル対象外と決まった。

## 2. 方針

1. 上流の挙動を壊さない。Vault のノートを書き換えるのは明示的な操作だけ。3D オフのときの表示と挙動は変更前と完全に同じ。Up／Down が空の設定は今までどおり動く。
2. 機能を足す前に、検証できる土台（型・lint・実機ケース・証跡）を先に作る。
3. フォーク側はネットワークを使わない。Jev への通信は別プラグインに閉じる。
4. 上流に還元できる変更（型付け、lint 対応、Up／Down 領域）と、フォーク固有の変更（3D）を分けて記録する。3D の変更は `src/graph/Projection.ts` に寄せ、既存へのフックは最小限にする。

## 3. 段階と受入条件

### H0 ハーネス整備（完了、実機は未実施）

- `npm run check` がローカルと GitHub Actions で通る。
- `npm run harness:prepare` → Dataview／Excalidraw を手で入れる → `npm run harness:preflight` が通り、`Fixtures/` のグラフが実機で E01 の通りに出る。
- `AGENTS.md`・`docs/` が揃い、Linear の起票テンプレートが使える。

現在の実装: check・CI・test-vault・docs は main に入っている。実機は 2026-09-21 に E01〜E07・E09・E10 を確認（`artifacts/h0-e2e/record.md`、LEV-105）。E05 の右クリック表示は本人の目視待ち、E08 は上流に UI が無く対象外、E11・E12 は未実施。Linear の Project「Jevbrain」は作成済み。

### ONT-1 Up／Down 領域

受入条件は `docs/ontology-axis-design.md` §4。要点:
- 設定の Ontology 節に Up (abstract) と Down (concrete) の text area。「Ontology に追加」モーダルとサジェスターでも選べる。
- Up のフィールドは北、Down は南に今までどおり出て、リンクは領域のスタイル（既定: 緑・太さ 4.5）。フィールド別スタイルが優先。
- Up と Parents に同じフィールドを書いたら Up が勝つ。Up／Down の無い既存設定は回帰なし（実機 E01〜E05）。
- `Link` のスタイル重ね順と領域の排他に単体テスト。

現在の実装: LEV-106 で `Hierarchy` に `abstract`／`concrete`（既定は空配列）を足し、読み込み時の既定値・排他（hidden → Up → Down → Parents → Children → 左右 → 前後 → exclusions の順に後ろから落とす）・ソートを `src/utils/hierarchy.ts` の純関数 `buildHierarchyLowerCase` と `axisOf` に移し、`loadSettings` から呼ぶ。`tests/utils/hierarchy.test.ts` が上流 0.2.18 のアルゴリズムの写しをオラクルにして「Up／Down の無い設定は同じ結果」を固定し、Up 対 Parents の排他・正規化・`axisOf` を検証する。LEV-107 で `Page.addDVFieldLinksToPage` が `hierarchyLowerCase.abstract` を Parents と同じ処理（北）、`concrete` を Children と同じ処理（南）に通し（`item.field` はフィールド名のまま定義に残る）、`Link` のスタイルの重ね順を base → inferred → 領域（`axisOf` で判定、`upLinkStyle`／`downLinkStyle`）→ フィールド別にした。`ExcaliBrainSettings` に `upLinkStyle`／`downLinkStyle` の型と既定値（`DEFAULT_AXIS_LINK_STYLE`: `#22ec23cc`・太さ 4.5）を足した。`tests/graph/link-style.test.ts` が plugin／EA スタブで領域のみ・フィールド別のみ・両方・inferred の 4 通りと file-tree／tag-tree の回帰、`render()` が EA に渡す色・太さ・ゲートを固定し、`tests/graph/page-relations.test.ts` が Dataview／vault スタブで Up が親・Down が子になること、Up／Down が空なら従来どおりなこと、定義の重複判定が完全一致になったこと（`architecture.md` D8）を固定する。LEV-108 で設定画面の Ontology 節に Up (abstract)／Down (concrete) の text area を Parents の前に足し（`hierarchy.abstract`／`concrete` と `hierarchyLowerCase` を他の領域と同じ流れで更新）、Link style のドロップダウンに「Style of Up (abstract) links」「Style of Down (concrete) links」（`upLinkStyle`／`downLinkStyle`。キーは `up-axis`／`down-axis`。`plugin.linkStyles` は `loadSettings()` のたびに作り直されるので、設定タブが参照の前に無ければ登録する `ensureAxisLinkStyles`）を足した。`hierarchyStyleList`・unassigned の除外集合・demo link の役割判定（Up は北）・ドロップダウンの並びとラベル（Up > ／Down > ）が両領域を知り、フィールド別スタイルの継承値と demo 画像は base＋領域（`axisOf`）でキャンバスの重ね順に揃えた。「Ontology に追加」モーダルに Up／Down のボタン（Hidden と Parents の間）、`Ontology` enum に `Up`／`Down`、サジェスターの全フィールド一覧に `abstract`／`concrete` を足した（専用トリガーは無し）。`tests/components/add-to-ontology-modal.test.ts`（ボタンの並びと CTA、Parents → Up／Up → Down → Children の移動、保存回数と Notice）と `tests/suggesters/ontology-suggester.test.ts`（全フィールド一覧に Up／Down、方向別一覧は従来どおり）が plugin スタブと `Modal`／`Setting`／`EditorSuggest` の最小スタブで固定する。設定画面は Obsidian の `Setting` API 依存で単体テスト無し。実機（2026-09-21、main b824020、CDP、`artifacts/3d1-e2e/record.md`）: 設定画面の Up (abstract)／Down (concrete) の text area に入力すると `hierarchy.abstract`／`concrete` と `hierarchyLowerCase` が更新され、up・down・example のリンクだけが緑・太さ 4.5 になり、origin・similar・next は既定のまま。2D の位置は変わらず、E01〜E03 の回帰も一致。残りは本人の目視（LEV-109）。

### 3D-1 固定視点の 3D トグル（ONT-1 の後）

受入条件は `docs/3d-design.md` §5。要点:
- ツールパネルに 3D トグル。デスクトップのみ。起動時は常に 2D で、トグルの状態は保存しない。
- Up の親が +1、Down の子が −1、それ以外は 0。8 ノートの fixture で「行動デザイン」が +1、「読書メモ：習慣の本」が北の地面、「歯磨き後に腕立て」が −1。
- 地面にいないノードから破線の柱と影。地面と方角ラベル。奥から手前の順に描き、由来の親が下に来てもリンクが箱を突っ切らない。
- 帯の間だけ潰し、帯の中の行間は 2D のまま。親 12・子 12 で箱が重ならない。`maxItemCount3D`（既定 12）。
- 3D オフで変更前とまったく同じ配置。クリック・ホバー・フィルター・ピン留めが 2D と同じ。
- `Projection.ts` の `levelOf` / `project` / `compressBands` に単体テスト。

現在の実装（LEV-110・LEV-111・LEV-112・LEV-113・LEV-114）: `src/graph/Projection.ts`（`levelOf` / `project` / `compressBands`）と `tests/graph/projection.test.ts` が LEV-110 で入った（規則は `docs/3d-design.md` §3-1・§3-2・§4-1）。`Layout.render()` を `place()`（中心を決める）と `renderNodes()`（配置済みノードを行順に描く）に分割し、`render()` は両方を順に呼ぶ。`Node.level`（−1 | 0 | 1、既定 0）を追加。描画は無改造で、2D は `render()` のまま、ノードの描画順も分割前と同じ（`tests/graph/layout.test.ts`）。LEV-112 で `Scene` に `view3D`（起動時 false、設定に保存しない）と `render()` の 3D 分岐を 1 つ入れた: 全レイアウトの `place()` → `compressBands`（帯の範囲は Layout の rowHeight から。兄弟は北と同じ量だけ動かす）→ `addNodes` が `levelOf` で付けた `Node.level` で `project` → 中心を置き換えて depth 昇順に逐次 `node.render()` → 地面（`boundsOf` の範囲を `groundLevelOf` の高さに投影した平行四辺形と、`t()` の方角ラベル N／S／W／E）・影（楕円）・柱（破線）を link 無し・グループ外で描き、リンクの後ろに並べる（柱・影・地面が変えた `ea.style` は戻す）。ヨー 20°・widthScale 0.8・levelHeight 1.5 × nodeHeight・depthScale 0.38 は `Scene.ts` の定数（3D-2 で設定へ）。`maxItemCount3D`（既定 12）を設定の型・既定値に足し、3D のときだけ `getNeighbors` の上限に使う。埋め込みの中心は Layout が原点に置き、原点は level 0 の投影の不動点なので `retainCentralNode` は 3D でもそのまま。3D オフの経路は分岐の外で変更なし。`Scene` は EA 依存で単体テスト無し（実機は LEV-115）。LEV-113 で `Link.render()` に `view3D` を足し、3D のときだけ親子のリンクのゲートを投影後の中心（`Node.getCenter()`）の上下で選ぶ: 上にある側の子ゲート → 下にある側の親ゲート、同じ y（NaN も）なら役割どおり、左右のリンクは友ゲートのまま、矢印の向き（nodeA → nodeB）は変えない。`Scene.render()` が `Links.render()` に `view3D` を渡し、false（2D）のあいだは中心を読まず従来どおり。`tests/graph/link-gates.test.ts` が Node／EA スタブで 2D は役割どおり・3D で親が下に来たときの入れ替え・同じ y と NaN の fallback・左右は不変・`project()` の実値で由来の親が中心より下に投影される例・`Links.render()` の受け渡しを固定する。中心の y だけで決めるので、投影後に箱が縦に重なる相手（3d-design §4-1 の未解決 (b)、埋め込み中心の高い箱）とは上下どちらのゲートでも線が箱を通りうる。3D-3 の重なり対策と実機（LEV-115）で扱う。LEV-114 で `ToolsPanel` の末尾に 3D トグル（`ToggleButton`、`lucide-box`／`lucide-square`、tooltip は `TOGGLE_3D_VIEW`）を足した: `ea.DEVICE?.isDesktop` が偽なら作らない（モバイルは非対応）。`getVal` は `scene.view3D`、`setVal` は `scene.view3D = val` して false を返すので `saveSettings()` は呼ばれず、起動時は常に 2D。`updateIndex: false` でクリック時は `reRender(false)`（索引の再構築なし）。`ToolsPanel` は Obsidian の DOM 依存で単体テスト無し。実機（2026-09-21、main b824020、CDP、`artifacts/3d1-e2e/record.md`）: 設定画面の text area から Up＝up・Down＝down, example を入れ、ツールパネルの 3D トグルで 3d-brief §7 の 8 ノート fixture を描画。行動デザインが +1 で最上、読書メモ：習慣の本は北の地面、朝のルーティン手順・歯磨き後に腕立て・9月20日 朝ランの記録は −1、柱・影・地面が出る。トグルを戻すと 2D の座標が完全一致、プラグイン再読込後は 2D、E01〜E03 の 2D 回帰も merge 前と一致。残りは本人の目視（LEV-115）。

### R1 ベータ配布（3D-1 の後）

- plugin ID と名前を決める（上流と同じ `excalibrain` のままなら上流版と同時インストール不可）。
- `npm version x.y.z` → tag → Release → BRAT で導入できる。`artifacts/` に導入の記録。

現在の実装（LEV-147）: plugin ID を `jevbrain`、名前を JevBrain、作者を Hiroya Iizuka にした（`manifest.json`、`package.json`＋lock、`disablePlugin()` に渡す自分の ID（`constants.PLUGIN_NAME` をやめて `this.manifest.id`）、`scripts/preflight.mjs`、`release.yml`／`check.yml` の artifact 名と `dist/jevbrain/`、tooling テストのサンプル）。上流版（`excalibrain`）と ID が違うので別プラグインとして入る（実機での同時インストールは未確認。既定の図面ファイルがどちらも `excalibrain.md` なので、並べて使うには片方の設定を変える）。command ID `excalibrain-*`・CSS クラス・設定のキー・既定の図面ファイル・`APPNAME` の表示文字列は互換のため据え置き（表示名の置き換えは別チケット）。ID が変わって `obsidianmd/commands/no-plugin-id-in-command-id` が指摘しなくなったので、lint のベースラインから外した（`harness.md` の表も）。BRAT 配布は Jev の実装後まで保留で、Release はまだ作っていない。

### 3D-2 見た目の作り直し（本人のフィードバック 2026-09-21）

受入条件は `docs/3d-feedback-2026-09-21.md`「合格の目安」と `docs/3d-design.md` §6:
- if-then プラン／中心／意志力で続ける が画面上で水平の一直線に並ぶ（斜投影。東西は水平、抽象度は真上、南北は右上がり）。
- 全ノードの影が床のグリッドの上に乗り、フレンドの影は東西軸の上、親の影はその右上、子の影は左下。
- 行動デザインが一番高く、読書メモ：習慣の本は北側の床に接している。床のノードは柱なし・接地影、浮いたノードは目立つ柱と 1 段ごとの目盛り、影は同じ大きさで柱の下端。床は中心ノートのすぐ下にあり、Down の子は床の下、左右の友は床の少し上に乗っている（本人の追記 2026-09-21、`3d-feedback-2026-09-21.md` 末尾）。
- 3D ではリンクが細く薄くノード中心同士、ゲートと数字は非表示。ノードの色は level 別（肩の L1 などの文字ラベルは本人の追記 4 でやめた）。方角の N と S は床の縁のすぐ外にある。
- Up／Down は中心の真上・真下の垂直軸に並ぶ（1 つなら軸の上、複数なら中心を挟んで東西に等間隔で同じ高さ）。5 個を超えたら折り返し、あふれた行は Up が上・Down が下へ積む（本人の追記 7）。上限で切るときは垂直軸の Up／Down を先に残す。画面では高さの傾き（`heightShearX`）のぶん、軸ごと Up が東・Down が西へ倒れる（本人の追記 6）。床の平行四辺形の帯に残るのは level 0（Parents／Children／Left／Right／Previous／Next）だけ。未解決リンクの Up／Down にも段が付く（本人の追記 2、`3d-feedback-2026-09-21.md` 末尾）。
- northShearX（0.40）／northRise（0.30）／heightShearX（0.64）と、段の高さ・帯の距離・床の広がり（§6-6 の 7 つ）は設定。
- 柱（点々）と影（丸）は描かない。床の平行四辺形は手前（S）にも奥行きがあり、その上に乗るのが level 0、上下に離れて出るのが Up／Down と読める（本人の追記 3）。Up と Parents、Down と Children は重ならない。床の左右は中心ノート（垂直軸）に対して対称（本人の追記 5）。
- 3D をオフにすると元の 2D とまったく同じ表示。

現在の実装（LEV-119）: `Projection.project` を斜投影（`x = gx + north·northShearX`、`y = −north·northRise − level·levelHeight`、`depth = north`。原点は中心ノートの箱で、床は `floorOf`＝画面内の最小 level の高さ。`3d-design.md` §6-1）に書き換え、yaw・`widthScale`・`compressBands`・`extentOf`・`groundLevelOf` を削除、`Scene.render3D()` は設定 `view3D`（`Types.View3DSettings`: `northShearX`／`northRise`／`levelHeightFactor`、`constants.DEFAULT_VIEW_3D_SETTINGS` 0.40／0.30／2.2、`loadSettings` で既定値を merge、設定画面の「3D view」節（`setHeading()`）にスライダー 3 つ。northRise の下限 0.2 は親の最下行と友が重ならない値）から係数を作り、左右の友の帯だけ `friendBandShift`（上流 Layout の半行のずれを 3D でだけ戻し、中心と友を同じ north にする）で動かしてから投影し、`compareDrawOrder`（`depth` 降順、同値は画面 x 昇順）で逐次描き、床・影・柱は今の関数のまま `floor` の高さに乗せる。保持した埋め込みの中心は `Node.render()` が `id` を付け直すので柱・影の箱が取れる（`tests/graph/projection.test.ts` を書き換え、`link-gates.test.ts` の投影の例を差し替え。実機は未実施で LEV-120 以降と合わせて確認。埋め込みの中心（高さ 700）に Down の子が付くと床が箱の内側を通る件は LEV-120 向けの子チケットに切り出し）。 LEV-120 で床・柱・影を `3d-design.md` §6-2 に作り直した: 床は常に中心の段（`Projection.FLOOR_LEVEL` = 0）で、平面は床の段の最も高い箱（中心）の下端に影の上端が接する位置（`Projection.floorDrop`）、Up の親は床の上に柱で立ち Down の子は床の下に柱で吊る。`Projection.floorPlan`（全ノードの足元と箱の横幅を囲む最小の範囲＋nodeHeight の余白、nodeHeight 間隔のグリッド、中心ノートの足元を通る十字、十字の両端の N／S／W／E）と `pillarTickLevels`（床と箱の段の間の各段）を純関数にして `tests/graph/projection.test.ts` で固定し、`Scene.render3D()` はノードを描いてから影（全ノード同じ楕円 nodeHeight × 0.6／0.25 を足元に）・柱（テキスト色 60%・太さ 2・破線、目盛りは gateRadius × 4 の実線）・床（外周・グリッド 15%・十字 40%）を描き、床 → 影 → 柱の順にリンクの後ろへ置く（`boundsOf` は削除、`floorOf` は最下段＝L ラベルの基準としてだけ残す。色はすべてテキスト色から作る。実機は未実施で LEV-122）。 1 で 3D のときだけ `Link.render()` がゲートでなく箱同士（`Node.id`）を太さ 1・不透明度 50%（色・破線・矢印は領域とフィールド別スタイルのまま）で結び（LEV-113 の投影後のゲート選び直しは削除）、`Node.render({floor})`（`Scene.render3D()` だけが渡す。2D は引数なし）がゲート 4 つと近傍数を描かず、箱の背景を `settings.levelColors[level − floor]`（`constants.DEFAULT_LEVEL_COLORS`＝模式図の 4 段、設定画面「3D view」節に色 4 つ）の solid 塗りにして文字色は `readableTextColor` で読める側に寄せ（キャンバス色に合成した level 色との WCAG 3:1 未満なら黒か白。既定の白は L4 だけ残る）、箱の右肩の外側に fontSize × 0.6 の「L{level − floor + 1}」をキャンバス色に対して読める文字色で付けてグループに入れる（埋め込みの枠は保持されて 2D に色が残るので色を変えず、3D でリンクが枠に束縛する矢印が `boundElements` に溜まらないよう削除済みの分を落とす。`tests/graph/link-gates.test.ts` を「2D はゲート・3D は箱同士」に置き換え、`tests/graph/node-render.test.ts` を追加。2D の経路は分岐の外で変更なし。実機は未実施で LEV-122）。 LEV-124 で Up／Down を帯から垂直軸に移した（`3d-design.md` §6-5）: `Projection.verticalSpread(count, columnWidth)`（1 つなら 0、n 個なら中心を挟んで columnWidth 間隔の中央揃え）と `verticalRow(entries, rootCenter)`（level ≠ 0 のノードだけを中心ノートと同じ north の行（床の十字の東西の線）へ 2D の読み順で置き直し、level 0 は帯の中心のまま返す純関数）を足し、`Scene.render3D()` はその中心を投影するだけにした。段が奇数個のときは真ん中のノードの足元が中心ノートと重なるので、同じ点の影は 1 つだけ描く。これで Up は中心の真上、Down は真下に立ち、柱の足元は東西軸に落ち、床の帯に残るのは level 0 だけになる。`Projection.levelOf` は未解決ページ（ゴースト）を 0 に落とす規則をやめ（`LevelSubject` から `isVirtual` を削除、0 に固定するのは兄弟だけ）、未解決の `up:: [[…]]` も解決済みの Up と同じ段に立つ。fixture に 2 つ目の Up「習慣ループ」と未解決の `up:: [[抽象化のはしご]]` を足した（`tests/fixtures/`、E14・E15）。 実機（2026-09-21、CDP、`artifacts/3d2-vertical-e2e/record.md`。`/code-review 12 high` の反映後に再実行）: Up 3 つ（未解決の抽象化のはしごを含む）が中心を挟んで ±236 の等間隔・同じ高さ、Down 3 つが ±280 で中心の真下、読書メモ：習慣の本だけ北の帯に残り、影 8 個（中心と足元が重なる 2 つは畳まれる）のうち 7 個が床の十字の東西の線に乗る。3D を戻すと 2D の座標が完全一致、console.error なし。本人の目視は未。Up／Down が多いときの折り返し（LEV-127）と埋め込みの中心との重なり（LEV-123 にコメント）は残っている。 LEV-130 で本人の追記 4 を入れた: 箱の肩の「L{n}」ラベル（`Node.renderLevelLabel`・`LEVEL_LABEL_FONT_SCALE`）を削除し、level は箱の色だけで表す。方角の N／S を床の外周に寄せた（`fontSize × VIEW_3D.compassGapNorthInFont` 0.9＝画面 18px、S は `compassGapSouthInFont` 1.2＝24px。W／E は床の余白の 0.4 倍に詰めた。`Projection.CompassGap` を東西・北・南の 3 つに分けた）。実機（2026-09-21、CDP、`artifacts/3d-labels-e2e/record.md`）: L ラベル 0 個、N は床の縁から画面 18px・S は 24px、3D のオンオフで 2D の座標に差分なし、console.error なし。 LEV-135 で本人の追記 5（床の左右の中心を垂直軸に合わせる）を入れた: `Projection.floorPlan` の `balance`（`"centre-line"` か `"corners"`）で床の左右を中心ノートに釣り合わせる（足りない側へ広げるだけ）。基準は実機を見ながら決め、平行四辺形の中心線を軸に通す `"centre-line"` を採用した。実機（2026-09-21、CDP、`artifacts/3d-floor-centre-e2e/record.md`）: 中心ノートの行で西 770・東 770、中心線は足元で軸と一致、Up 5 つの中央も中心と同じ x、3D のオンオフで 2D の座標に差分なし。 LEV-137 で本人の追記 6（高さにも東西の傾き）を入れた: `ProjectionParams.heightShearX`（設定 `view3D.heightShearX`、既定 0.64）を足し、`x = gx + north × northShearX + 高さ × heightShearX` にした。床は level 0 なので変わらず、上の段だけ東へ寄る。実機（2026-09-21、CDP、`artifacts/3d-height-shear-e2e/record.md`）: Up の高さ 238px に対して東へ 153px、実測の傾き 0.643、3D のオンオフで 2D の座標に差分なし、console.error なし。 LEV-127 で本人の追記 7（折り返しと上限）を入れた: `verticalSpread` が `verticalColumns`（既定 5）で折り返して `{dx, row}` を返し、`liftOf(level, params, row)` が `rowLift`（`rowLiftFactor` 1.2 ＝ 92px）ずつ Up は上・Down は下へ積む（段 239／283px より小さくして「段」と「行」を見分けられるようにした）。足元は全部中心の行のままなので床は伸びない。`Scene.limited` が 3D のとき Up／Down を先に確保してから残りの枠を帯に配る。実機（2026-09-21、CDP、`artifacts/3d-wrap-e2e/record.md`）: Up 7 つが 5＋2 の 2 行（2 行目は 93px 上）、Down 7 つも 5＋2（2 行目は 92px 下）、Down が 4 → 7 に戻り、3D のオンオフで 2D の座標に差分なし。 LEV-128 で本人の追記 3（柱と影をやめ、床を手前に伸ばし、上下と帯を離す）を入れた: 柱・影の描画（`renderPillar`／`renderShadow`、`VIEW_3D` の定数、`Projection.pillarTickLevels`、`floorDrop` の影ぶん）を削除し、`ProjectionParams` を `upHeight`／`downHeight` に分けて `Projection.liftOf` が段の符号で選ぶようにし、`verticalRow` の間隔を設定 `verticalGapFactor` に、level 0 の Parents／Children の帯を `Projection.bandShift` で中心から `bandDistanceFactor` の位置へ、`Projection.floorPlan` に床の最低の広がり（`FloorReach`）を足した。設定 `view3D` は本人が決めた値（Up 3.1・Down 3.6・間隔 3.8・帯 3.9・床 奥 7.1／手前 5.75／余白 1.5、どれも nodeHeight 倍）。fixture に level 0 の子 2 つ（`leads to::`）を足して Down と重ならないことを見る。実機（2026-09-21、CDP、`artifacts/3d-floor-depth-e2e/record.md`）: 柱 0・影 0、Up は中心から 238 上・Down は 277 下で間隔 293、Parents／Children は中心から画面上 90（2D 300）、床は画面 y -140〜157（2D で奥 546・手前 443）、全 12 箱の重なり 0、3D を戻すと 2D の座標が完全一致、console.error なし。本人の目視は未。

### 3D-3 実測と重なりの追加対策

- 親 20・子 30 の fixture で要素数と描画時間を `artifacts/` に記録し、重なりの残りを判断する。

現在の実装（LEV-144）: 初期ズーム（`zoomToFit`）を 3D の床と方角を除いたノード・リンクに合わせる。`Scene.render()` が `render3D()` の戻り値の id を集め、`zoomTargets`（`src/graph/zoom.ts`）がそれを外した配列を `zoomToFit` に渡す（`tests/graph/zoom.test.ts`）。床は最低の広がりを持つ（`floorNorthFactor`／`floorSouthFactor`）ので、8 ノートでは床がビューポートを決めて倍率が 35% まで落ちていた。床と方角は画面からはみ出してよい。タブが隠れている間に描いた場合の遅延ズーム（`zoomToFitOnNextBrainLeafActivate`）も同じ経路にした。2D は床の id が無く、上流がその呼び出しで渡していた対象をそのまま渡すので、対象も倍率も従来どおり。**実機は未実施**: 倍率が 2D と ±10% に収まるか（受入条件）は CDP の `getAppState().zoom.value` を 2D／3D で比べて確かめる必要があり、床と方角が画面からどれだけ外れるかは本人の目視待ち（`docs/3d-design.md` §7）。

### H1 引き継ぎコードの整地（3D-1 の後）

- `eslint.config.mjs` の「引き継ぎ時のベースライン」ブロックが空になる。
- `tsconfig` に `strict: true` が入り `npm run typecheck` が通る。
- 設定画面の見出しを `Setting.setHeading()` に変え、実機（E09）で確認して証跡を残す。
- `Pages`／`Page` の関係判定に plugin スタブ付きの単体テストが付く。

3D-1 と同じファイル（`Scene.ts`、`Layout.ts`、`Link.ts`）を触るので、3D-1 の merge 後に始める。

### JEV-1 リンクに型を付ける別プラグイン

- 別リポジトリ（本人の判断）。受入条件は `docs/jev-link-typer-design.md` §3 の流れが 1 リンクで動くこと。
- 着手前に Jev の API とキーの扱いを決める（同 §4）。

## 4. 応答性の目安

未計測。上流の `maxItemCount` と `compactView` の既定値のまま。3D-3 で fixture を使って計る。

## 5. 主要な判断と残る課題

| 論点 | 現時点の判断 | 決める人・時期 |
| --- | --- | --- |
| plugin ID と名前 | 決定: ID `jevbrain`、名前 JevBrain、作者 Hiroya Iizuka（上流版と同時インストール可）。BRAT 配布は Jev の実装後まで保留 | 決定済み（2026-09-21） |
| 「Jev 支援」の意味 | 決定: 貼った後の `[[X]]` にオントロジーのフィールドを順位付けして付ける別プラグイン。既存サジェスターには足さない | 決定済み（2026-09-20） |
| 「3D」の意味 | 決定: Up／Down 領域を高さにした疑似 3D の検査モード。本物の 3D はやらない | 決定済み（2026-09-20） |
| 抽象度のデータ | 決定: ノート属性は使わず、オントロジーの領域（Up／Down）で決める。既定値で決め打ちしない | 決定済み（2026-09-20） |
| 領域の名前 | 暫定: 表示は Up (abstract) / Down (concrete)、コードは `abstract` / `concrete` | 本人。ONT-1 の前 |
| 3D の永続化 | 決定: 起動時は常に 2D。数値の設定だけ保存 | 決定済み |
| モバイル | 3D は対象外（トグルを出さない）。2D は上流のまま `isDesktopOnly: false` | 決定済み |
| 上流追従 | `upstream` remote を切って手動 merge。設定ファイルは取り込まない | 各 merge 時 |
| Linear | Project「Jevbrain」（Team LEV）に親 LEV-96〜104、子 LEV-105〜115 を起票済み（`docs/linear-workflow.md`） | 決定済み（2026-09-20） |
| Jev の API・キー | 未確認 | 本人。JEV-1 の前 |
