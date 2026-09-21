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

現在の実装: LEV-106 で `Hierarchy` に `abstract`／`concrete`（既定は空配列）を足し、読み込み時の既定値・排他（hidden → Up → Down → Parents → Children → 左右 → 前後 → exclusions の順に後ろから落とす）・ソートを `src/utils/hierarchy.ts` の純関数 `buildHierarchyLowerCase` と `axisOf` に移し、`loadSettings` から呼ぶ。`tests/utils/hierarchy.test.ts` が上流 0.2.18 のアルゴリズムの写しをオラクルにして「Up／Down の無い設定は同じ結果」を固定し、Up 対 Parents の排他・正規化・`axisOf` を検証する。LEV-107 で `Page.addDVFieldLinksToPage` が `hierarchyLowerCase.abstract` を Parents と同じ処理（北）、`concrete` を Children と同じ処理（南）に通し（`item.field` はフィールド名のまま定義に残る）、`Link` のスタイルの重ね順を base → inferred → 領域（`axisOf` で判定、`upLinkStyle`／`downLinkStyle`）→ フィールド別にした。`ExcaliBrainSettings` に `upLinkStyle`／`downLinkStyle` の型と既定値（`DEFAULT_AXIS_LINK_STYLE`: `#22ec23cc`・太さ 4.5）を足した。`tests/graph/link-style.test.ts` が plugin／EA スタブで領域のみ・フィールド別のみ・両方・inferred の 4 通りと file-tree／tag-tree の回帰、`render()` が EA に渡す色・太さ・ゲートを固定し、`tests/graph/page-relations.test.ts` が Dataview／vault スタブで Up が親・Down が子になること、Up／Down が空なら従来どおりなこと、定義の重複判定が完全一致になったこと（`architecture.md` D8）を固定する。LEV-108 で設定画面の Ontology 節に Up (abstract)／Down (concrete) の text area を Parents の前に足し（`hierarchy.abstract`／`concrete` と `hierarchyLowerCase` を他の領域と同じ流れで更新）、Link style のドロップダウンに「Style of Up (abstract) links」「Style of Down (concrete) links」（`upLinkStyle`／`downLinkStyle`。キーは `up-axis`／`down-axis`。`plugin.linkStyles` は `loadSettings()` のたびに作り直されるので、設定タブが参照の前に無ければ登録する `ensureAxisLinkStyles`）を足した。`hierarchyStyleList`・unassigned の除外集合・demo link の役割判定（Up は北）・ドロップダウンの並びとラベル（Up > ／Down > ）が両領域を知り、フィールド別スタイルの継承値と demo 画像は base＋領域（`axisOf`）でキャンバスの重ね順に揃えた。「Ontology に追加」モーダルに Up／Down のボタン（Hidden と Parents の間）、`Ontology` enum に `Up`／`Down`、サジェスターの全フィールド一覧に `abstract`／`concrete` を足した（専用トリガーは無し）。`tests/components/add-to-ontology-modal.test.ts`（ボタンの並びと CTA、Parents → Up／Up → Down → Children の移動、保存回数と Notice）と `tests/suggesters/ontology-suggester.test.ts`（全フィールド一覧に Up／Down、方向別一覧は従来どおり）が plugin スタブと `Modal`／`Setting`／`EditorSuggest` の最小スタブで固定する。設定画面は Obsidian の `Setting` API 依存で単体テスト無し。実機 E01〜E05 の回帰確認と設定画面の目視（LEV-109）は未着手。

### 3D-1 固定視点の 3D トグル（ONT-1 の後）

受入条件は `docs/3d-design.md` §5。要点:
- ツールパネルに 3D トグル。デスクトップのみ。起動時は常に 2D で、トグルの状態は保存しない。
- Up の親が +1、Down の子が −1、それ以外は 0。8 ノートの fixture で「行動デザイン」が +1、「読書メモ：習慣の本」が北の地面、「歯磨き後に腕立て」が −1。
- 地面にいないノードから破線の柱と影。地面と方角ラベル。奥から手前の順に描き、由来の親が下に来てもリンクが箱を突っ切らない。
- 帯の間だけ潰し、帯の中の行間は 2D のまま。親 12・子 12 で箱が重ならない。`maxItemCount3D`（既定 12）。
- 3D オフで変更前とまったく同じ配置。クリック・ホバー・フィルター・ピン留めが 2D と同じ。
- `Projection.ts` の `levelOf` / `project` / `compressBands` に単体テスト。

現在の実装（LEV-110・LEV-111・LEV-112・LEV-114）: `src/graph/Projection.ts`（`levelOf` / `project` / `compressBands`）と `tests/graph/projection.test.ts` が LEV-110 で入った（規則は `docs/3d-design.md` §3-1・§3-2・§4-1）。`Layout.render()` を `place()`（中心を決める）と `renderNodes()`（配置済みノードを行順に描く）に分割し、`render()` は両方を順に呼ぶ。`Node.level`（−1 | 0 | 1、既定 0）を追加。描画は無改造で、2D は `render()` のまま、ノードの描画順も分割前と同じ（`tests/graph/layout.test.ts`）。LEV-112 で `Scene` に `view3D`（起動時 false、設定に保存しない）と `render()` の 3D 分岐を 1 つ入れた: 全レイアウトの `place()` → `compressBands`（帯の範囲は Layout の rowHeight から。兄弟は北と同じ量だけ動かす）→ `addNodes` が `levelOf` で付けた `Node.level` で `project` → 中心を置き換えて depth 昇順に逐次 `node.render()` → 地面（`boundsOf` の範囲を `groundLevelOf` の高さに投影した平行四辺形と、`t()` の方角ラベル N／S／W／E）・影（楕円）・柱（破線）を link 無し・グループ外で描き、リンクの後ろに並べる（柱・影・地面が変えた `ea.style` は戻す）。ヨー 20°・widthScale 0.8・levelHeight 1.5 × nodeHeight・depthScale 0.38 は `Scene.ts` の定数（3D-2 で設定へ）。`maxItemCount3D`（既定 12）を設定の型・既定値に足し、3D のときだけ `getNeighbors` の上限に使う。埋め込みの中心は Layout が原点に置き、原点は level 0 の投影の不動点なので `retainCentralNode` は 3D でもそのまま。3D オフの経路は分岐の外で変更なし。`Scene` は EA 依存で単体テスト無し（実機は LEV-115）。LEV-114 で `ToolsPanel` の末尾に 3D トグル（`ToggleButton`、`lucide-box`／`lucide-square`、tooltip は `TOGGLE_3D_VIEW`）を足した: `ea.DEVICE?.isDesktop` が偽なら作らない（モバイルは非対応）。`getVal` は `scene.view3D`、`setVal` は `scene.view3D = val` して false を返すので `saveSettings()` は呼ばれず、起動時は常に 2D。`updateIndex: false` でクリック時は `reRender(false)`（索引の再構築なし）。`ToolsPanel` は Obsidian の DOM 依存で単体テスト無し。ゲート選び直し（LEV-113）、実機（LEV-115、トグルで切替・再起動後は 2D・2D 回帰 E01〜E03 を含む）は未着手。

### R1 ベータ配布（3D-1 の後）

- plugin ID と名前を決める（上流と同じ `excalibrain` のままなら上流版と同時インストール不可）。
- `npm version x.y.z` → tag → Release → BRAT で導入できる。`artifacts/` に導入の記録。

### 3D-2 視点と設定

- ヨー角を 15° 刻みで変える UI。変更ごとに 1 回の再描画で済む。
- 設定画面に levelHeight / depthScale / widthScale / showPillars / showGround。

### 3D-3 実測と重なりの追加対策

- 親 20・子 30 の fixture で要素数と描画時間を `artifacts/` に記録し、重なりの残りを判断する。

### H1 引き継ぎコードの整地（3D-1 の後）

- `eslint.config.mjs` の「引き継ぎ時のベースライン」ブロックが空になる（恒久の command ID を除く）。
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
| plugin ID と名前 | 上流と同じ（`excalibrain`）。同時インストール不可 | 本人。R1 の前 |
| 「Jev 支援」の意味 | 決定: 貼った後の `[[X]]` にオントロジーのフィールドを順位付けして付ける別プラグイン。既存サジェスターには足さない | 決定済み（2026-09-20） |
| 「3D」の意味 | 決定: Up／Down 領域を高さにした疑似 3D の検査モード。本物の 3D はやらない | 決定済み（2026-09-20） |
| 抽象度のデータ | 決定: ノート属性は使わず、オントロジーの領域（Up／Down）で決める。既定値で決め打ちしない | 決定済み（2026-09-20） |
| 領域の名前 | 暫定: 表示は Up (abstract) / Down (concrete)、コードは `abstract` / `concrete` | 本人。ONT-1 の前 |
| 3D の永続化 | 決定: 起動時は常に 2D。数値の設定だけ保存 | 決定済み |
| モバイル | 3D は対象外（トグルを出さない）。2D は上流のまま `isDesktopOnly: false` | 決定済み |
| 上流追従 | `upstream` remote を切って手動 merge。設定ファイルは取り込まない | 各 merge 時 |
| Linear | Project「Jevbrain」（Team LEV）に親 LEV-96〜104、子 LEV-105〜115 を起票済み（`docs/linear-workflow.md`） | 決定済み（2026-09-20） |
| Jev の API・キー | 未確認 | 本人。JEV-1 の前 |
