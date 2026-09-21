# ハーネスと検証手順

更新日: 2026-09-20

## 現在の範囲

AI エージェントと人間が同じ条件で開発・検証するため、自動検査、テスト用 fixture、専用 Vault、配布物一致の確認、実装時の規約を用意している。製品コードは上流 ExcaliBrain 0.2.18 をそのまま引き継いでおり、自動テストがあるのはリリース用ツーリングと純ロジック（URL 正規表現、ファイル名ユーティリティ、Ontology の領域判定、Layout の配置、3D の投影）だけ。描画（Excalidraw）とインデックス（Dataview）を含む挙動は実機でしか確認できない。

件数・バンドルサイズ・実機の PASS/FAIL をこの文書に固定せず、実行日時とビルドのハッシュを付けた `artifacts/` の記録で追う。GitHub 上の CI、モバイル、性能計測、長時間利用の検証は、個別の証跡が揃うまで未完了として扱う。

| ゲート | コマンド / 設定 | 検出するもの |
| --- | --- | --- |
| メタデータ | `npm run validate` | manifest/package/lock/versions の不整合、必須文書の欠落 |
| lint | `npm run lint` | 製品ソースの公式 Obsidian 推奨ルール、型情報付き ESLint、JSON 構文、スクリプトの未使用変数 |
| 型検査 | `npm run typecheck` | 上流設定＋`noImplicitAny`、switch の fallthrough、Bundler 解決。strict は未導入（下記） |
| 単体テスト | `npm test` | リリース検証・バージョン更新・release.yml の形・preflight／Vault 準備の安全性、URL 抽出、ファイル名、Ontology の領域判定、Layout の配置（列・行・top/bottom）と描画順、3D の投影（高さ・回転・帯の圧縮） |
| production bundle | `npm run build` | ブラウザ互換 CJS バンドル（`main.js`）。Obsidian 提供 API は external |
| 配布物 | `npm run package` | `dist/jevbrain/` の必要ファイルと元ビルドとの一致、`dist/build-info.json` に SHA256 |
| Vault 初期準備 | `npm run harness:prepare` | `check` 後、生成専用 Vault に配布物・fixture を配置。有効プラグインは jevbrain と、すでに有効なら Dataview／Excalidraw だけを残す |
| 実機前確認 | `npm run harness:preflight` | root / dist / 検証 Vault の SHA256、一致する ID/version、有効プラグインが jevbrain・dataview・obsidian-excalidraw-plugin の 3 つちょうどであること |

まとめて実行するコマンドは `npm run check`。ローカルと GitHub Actions で同じコマンドを使う。ブランチと PR の CI（`check.yml`）は成果物を artifact に保存するだけで、公開を行わない。`manifest.version` と同じタグを push したときだけ `release.yml` が同じ check を通し、配布物 3 ファイルを GitHub Release に添付する（[リリース手順](#リリース手順)）。CodeQL（`codeql-analysis.yml`）は上流から引き継ぎ、停止済みの v1 action を v3 に更新した。Git hook は任意の `npm run hooks:install` で有効にする。

## lint の対象とベースライン

`eslint-plugin-obsidianmd` の recommended は `src/**/*.ts` に適用する。推奨ルールを手書きでコピーしない。テストと設定は `typescript-eslint` の型情報付き recommended、スクリプト（`scripts/*.mjs`）は Node 用の JS recommended。`--max-warnings 0` が品質基準。

上流コードには 2026-09-20 時点で次の指摘があり、`eslint.config.mjs` の「引き継ぎ時のベースライン」でファイル単位でだけ止めている。新しいファイルには適用されず、該当ファイルを直したらその行を消す。lint の通過はコミュニティ審査の通過を保証しない。

| ルール | 件数 | ファイル | 扱い |
| --- | --- | --- | --- |
| `obsidianmd/ui/sentence-case` | 14 | Scene.ts、Settings.ts、excalibrain-main.ts、utils/Prompts.ts | H1。文言は 24 言語の locale と一緒に決める |
| `obsidianmd/no-static-styles-assignment` | 18 | Settings.ts、Suggesters/Suggest.ts | H1。CSS クラスへ移し、実機で見た目を確認する |
| `obsidianmd/settings-tab/no-manual-html-headings` | 4 | Settings.ts | H1。`Setting.setHeading()` へ。見出しの見た目が変わるので実機確認と一緒に |
| `obsidianmd/settings-tab/prefer-setting-definitions` | 1 | Settings.ts | H1。設定検索用の `getSettingDefinitions()` を実装する |
| `@typescript-eslint/no-unsafe-*`（4 ルール） | 22 | multiselect.class.ts、Settings.ts、OntologySuggester.ts、Suggest.ts、excalibrain-main.ts、graph/Pages.ts | H1。Dataview／Excalidraw／ts-multiselect の `any` を型付きの境界に置き換える |
| `@typescript-eslint/no-base-to-string` | 5 | Scene.ts、excalibrain-main.ts、graph/Page.ts | H1。`String(unknown)` の誤検知。`strictNullChecks` を有効にすると消える |

引き継ぎ時に削除した上流のツーリング: `.eslintrc`／`.eslintignore`（ESLint 9 の flat config に置換）、`rollup.config.js`（依存が無く動かない）、`esbuild.config.json`・`hot-reload.bat`（Windows の個人パス前提）、`.replit`、`findUpdated.js`（CJS の個人用ツール）、`manifest-beta.json`（BRAT のベータは 0.x タグの pre-release で配る）。ルートの `version-bump.mjs` は `scripts/version-bump.mjs` に置き換え、`dist/` の追跡を外した。

## 型検査の段階

上流は `tsc` を通していなかった（26 件）。引き継ぎ時に型だけの変更で 0 件にした（`docs/architecture.md` の判断記録 D5）。`strict` 系は未導入で、2026-09-20 時点の件数は次の通り。H1 で `strictNullChecks` から順に入れる。

| オプション | 件数（引き継ぎ時の型修正後） |
| --- | --- |
| `--strict` | 241（上流のまま計ると 262） |
| `--noImplicitReturns` | 16 |
| `--noUncheckedIndexedAccess` | 0。ただし `strictNullChecks` が無いと効かないので、strict 化と同時に入れる |

`esModuleInterop` は無効にしてある。有効だと obsidian の `moment`（`export const moment: typeof Moment`）が呼び出せない型になる。esbuild の出力には影響しない。

## テスト階層

### 自動テスト（Vitest、Node）

- ツーリング: `validate-release`（manifest／package／lock／versions の整合、配布物一致）、`version-bump`（`npm version x.y.z` の流れ）、`release-workflow`（release.yml がタグ限定・read-only トークン・配布物 3 ファイルであること）、`preflight`／`prepare-test-vault`（生成 Vault のマーカー、symlink・hard link 拒否、有効プラグインの集合、fixture の配置）。
- 純ロジック: `linkRegex`（Markdown リンクと生 URL の抽出。括弧付き URL が途中で切れる上流の挙動もそのまま固定）、`getFilenameFromPath`／`splitFolderAndFilename`、`buildHierarchyLowerCase`／`axisOf`（Ontology の既定値・領域間の排他・正規化。上流 0.2.18 の `loadSettings` の写しをオラクルにして Up／Down の無い設定の回帰を固定）、`Layout`（`title`／`setCenter()`／`render()` だけを持つ Node スタブで、`place()` が決める中心と `render()` の順序を固定。余りの行の置き方も上流のまま）、`Projection`（`levelOf` の領域判定と兄弟の除外（未解決ページにも段が付く。LEV-124）、`project` の斜投影・段差（上下別）・高さの傾き・depth と `compareDrawOrder`、`friendBandShift`、Up／Down を中心の真上・真下に並べる `verticalSpread`／`verticalRow`（帯に残る level 0、2D の読み順、設定の間隔、5 列での折り返しと行ごとの高さ）、床に残る帯を中心から離す `bandShift`、画面の距離を地面の距離に戻す `groundGapNorthSouth`、床まわりの `floorOf`／`floorPlan`（最低の広がり、方角の面ごとの隙間）／`floorDrop`。3d-brief §7 の 8 ノートを fixture にしている）、`Link`（`hierarchyLinkStylesExtended`／`hierarchyLowerCase`／`settings` だけを持つ plugin スタブと `style`・`connectObjects`・`addLabelToLine` だけを持つ EA スタブで、スタイルの重ね順 base → inferred → 領域 → フィールド別を領域のみ・フィールド別のみ・両方・inferred の 4 通りと file-tree／tag-tree の回帰で固定し、`render()` が EA に渡す色・太さ・不透明度・ゲートも確認する）、`Page` の関係（`settings`／`hierarchyLowerCase`／`app.vault`／`app.metadataCache`／`DVAPI.page` だけを持つ plugin スタブで、`addDVFieldLinksToPage()` が Up のフィールドを親・Down を子に載せること、Up／Down が空なら従来どおりなこと、`addParent`／`addChild` の定義の重複判定が ", " 区切りの完全一致であることを固定。推論リンク・URL・タグ・フォルダは未カバー）。
- Ontology の UI: `AddToOntologyModal`（`settings.hierarchy`／`hierarchyLowerCase`／`loadSettings`／`saveSettings` だけを持つ plugin スタブと `Modal`／`Setting`／`Notice` の最小スタブで、ボタンの並び（Hidden・Up・Down・Parents・…）と現在の領域の CTA、Parents → Up／Up → Down → Children の移動で両方の配列と Dataview キーが更新され保存が 1 回・Notice が出ること、同じ領域なら何もしないこと）、`FieldSuggester.getKeys()`（全フィールド一覧に Up／Down が入りソートされること、方向別一覧は従来どおり）。設定タブ（`Settings.ts`）は Obsidian の `Setting` API 依存で実機のみ（E09）。
- `Link` のゲート（LEV-113）: 4 つのゲート id・`getCenter()`・`page.path` だけを持つ Node スタブと `connectObjects` の始点・終点を記録する EA スタブで、2D は役割どおり（中心を読まない）、3D は投影後の中心の上下で親子のゲートを入れ替える（同じ y なら役割どおり、左右は友ゲートのまま、始点は nodeA 側のまま）こと、`project()` の実値で由来の親（level 0）が中心より下に来る例、`Links.render()` の `view3D` の受け渡しを固定する。
- `Projection` の斜投影（LEV-119。上の `project` の回転・`compressBands`・`groundLevelOf` の記述と下の「未カバー」の関数名はこれで置き換え。`compressBands`／`extentOf` は削除、`groundLevelOf` は `floorOf`）: 3d-brief §7 の 8 ノートと `artifacts/3d1-e2e` の実座標で、`DEFAULT_VIEW_3D_SETTINGS`（0.40／0.30／2.2）、if-then／中心／意志力の y が等しいこと、中心が原点に留まること、親の影は東西軸の右上・子は左下・友は軸の上（床 −1／0 とも）、隣り合う level の差が `levelHeight`、`depth` が north で level に依らないこと、既定値と northRise の下限 0.2 で親の最下行（Layout の bottom −2·nodeHeight）が友と重ならないこと、`friendBandShift` が実座標の友（−38）を中心の行（−12）に乗せて 3 つが同じ y に投影されること、`floorOf` が最小 level（空と +1 だけなら 0）、`compareDrawOrder` が `depth` 降順・同値は画面 x 昇順で実座標を 親 → 友 → 中心 → 子 に並べることを固定する（`boundsOf` は LEV-120 で `floorPlan` に置き換え）。
- `Projection` の床と柱（LEV-120）: `artifacts/3d1-e2e` の実座標（友は friendBandShift 後）と nodeHeight 76 で、`floorPlan` の範囲が足元の最小の長方形＋四方 nodeHeight であり東西は箱の横幅も覆うこと、十字が中心の足元を通り床（`FLOOR_LEVEL` = 0）に投影した東西軸の上に友の足元があること、グリッドが十字から nodeHeight 間隔で外周の内側だけ（十字と重なる 2 本と外周に乗る線は含まない）、N／S／W／E が十字の両端の外側（既定 nodeHeight/2、南北は `northRise` で割った gap で画面の間隔が揃うこと）、足元が無くても origin の周りの床になること、spacing が正でなければグリッド無し、`floorDrop` が床の段の最も高い箱の半分＋影の半分（nodeHeight より高い箱は無視、床の下の箱の上端より下げない、スライダー下限で 0 以上）、`pillarTickLevels` が床と箱の段の間の各段（上下どちら向きも。+1 と −1 で [0]、3 段のままでは常に空）を固定する。`Scene.renderFloor`／`renderShadow`／`renderPillar` は EA 依存で実機のみ（LEV-122）。
- `Projection` の斜投影（LEV-119。上の `project` の回転・`compressBands`・`groundLevelOf` の記述と下の「未カバー」の関数名はこれで置き換え。`compressBands`／`extentOf` は削除、`groundLevelOf` は `floorOf`）: 3d-brief §7 の 8 ノートと `artifacts/3d1-e2e` の実座標で、`DEFAULT_VIEW_3D_SETTINGS`（0.40／0.30／2.2）、if-then／中心／意志力の y が等しいこと、中心が原点に留まること、親の影は東西軸の右上・子は左下・友は軸の上（床 −1／0 とも）、隣り合う level の差が `levelHeight`、`depth` が north で level に依らないこと、既定値と northRise の下限 0.2 で親の最下行（Layout の bottom −2·nodeHeight）が友と重ならないこと、`friendBandShift` が実座標の友（−38）を中心の行（−12）に乗せて 3 つが同じ y に投影されること、`floorOf` が最小 level（空と +1 だけなら 0）、`compareDrawOrder` が `depth` 降順・同値は画面 x 昇順で実座標を 親 → 友 → 中心 → 子 に並べること、`boundsOf` を固定する。
- 3D のリンク・ノード（LEV-121。上の「`Link` のゲート」の 3D 側はこれで置き換え）: `link-gates.test.ts` は 2D が役割どおりのゲート（箱の `id` を読まない）、3D が箱同士（`Node.id`。ゲートを読まない）を太さ 1・不透明度 50%（隠すときは 10）で領域の色のまま結ぶこと、`Links.render()` の受け渡しを固定する。`node-render.test.ts` は `measureText`／`addText`（box 付き）／`addEllipse`／`addToGroup`／`getElement` を記録する EA スタブと近傍数だけを持つ Page スタブで、2D の呼び出し列（箱 → ゲート 4 つと近傍数 → グループ）とゲートの位置、3D（`render({floor})`）が箱だけを描いて `levelColors[level − floor]` を箱に solid で塗り文字色を読める側に寄せること（肩の「L{n}」ラベルは LEV-130 でやめた）、level／floor の組ごとの色、`levelColors` が足りないときの fallback、hachure の仮想ノードが solid になること、保持した埋め込みの枠は色を変えず削除済みの束縛矢印だけ落とすこと、枠 1 つだけのときはグループ化を呼ばないこと（`groupIds` を伸ばさない）、枠が無くても落ちないこと、`readableTextColor`（半透明の level 色はキャンバスに合成して測る）を固定する。
- 初期ズームの対象（LEV-144）: `zoomTargets`（`src/graph/zoom.ts`）が 3D の床・グリッド・十字・方角の id を外してノードとリンクだけを返すこと、2D（床の id が空）と外すと空になるときは入力そのもの（同じ参照）を返すこと、床の id が画面に無いときは同じ内容の配列を返すこと、入力の配列も要素も書き換えず入力の要素そのものを返すことを固定する。`zoomToFit` を呼ぶ `Scene.zoomToFitNodes()`（2D は上流が渡していた対象をそのまま渡し、3D だけ置き換える）は EA 依存で実機のみ（倍率は CDP の `getAppState().zoom.value` を 2D／3D で比べる）。
- 3D の帯の組み直し（LEV-145）: `regridBand` が帯に残った level 0 だけを行ごとに中央揃えし（満杯の行は `Layout.place()` と同じ位置、半端な行は中心を挟んで対称）、読み順（北から南、同じ行は西から東）を保ち、中心にいちばん近い行を `origin.y` に置いて外へ `rowHeight` ずつ積むこと、入力を書き換えないこと、列数が壊れていたら 1 列に落ちることを固定する。8 ノート fixture の帯は上流の `Layout.place()` に実寸（親 2 列 236・子 3 列 280・行 77）で置かせてから渡し、`origin` の親が中心の真北（x が中心と同じ）に、`leads to` の子 2 つが中心を挟んで対称に来ること、丸ごと空いた行があれば帯が中心側へ詰まって `bandShift` がそこから測ること、軸へ抜けたノードが無い帯でも半端な行が中心に揃うことを受入条件のまま確かめる。`Scene.render3D()` の当てはめ（帯ごとの内側の縁の選び方と `regridded` の引き当て）は EA 依存で実機のみ。
- fixture: `tests/fixtures/` 直下は小さなグラフ（Asimov の 6 つ、3d-brief §7 の 3D 用 11）、`tests/fixtures/big/` は 3D の実測用の 75 ノート（中心「大きな脳」＋ level 0 の親 20（`origin::`）・level 0 の子 30（`leads to::`）・Up 7（`up::`）・Down 7（`down::`／`example::`）・左右の友 5 ずつ（`similar::`／`next::`）。中心から見た件数は親 27・子 37・友 10。タイトルの長さは揃えず、最長は `maxLabelLength` ちょうどの 30 文字）。`npm run harness:prepare` はサブフォルダごと `test-vault/Fixtures/` に写す（LEV-143、下記「3D の実測手順」）。
- `obsidian` モジュールは `tests/mocks/obsidian.ts` に置き換える（`TFile`／`TFolder`／`normalizePath`／`Vault.recurseChildren`／`moment.locale`）。`import ... from "src/..."` は `vitest.config.ts` の alias で解決する。

### 未カバー（実機のみ）

- `Pages`／`Page` の関係判定は `plugin.settings`・`metadataCache`・Dataview API に依存する。テスト用の最小 plugin スタブを作るのは H1 の候補。
- `Scene`・`Node`・`Link` の描画と、`Layout` が描く側（`node.render()` の中身）は ExcalidrawAutomate に依存する。Mappy のようなブラウザ検証ページは、Excalidraw 本体を外せないため今は作らない。
- `Scene` の 3D 分岐（LEV-112: 帯の圧縮のずれ適用・投影・depth 順の描画・地面・影・柱）は EA の `addLine`／`addEllipse`／`addText` で描くので実機のみ（LEV-115）。純関数の部分（`levelOf`／`compressBands`／`extentOf`／`project`／`groundLevelOf`／`boundsOf`）は `Projection` のテストで固定済み。
- `ToolsPanel` の 3D トグル（LEV-114: `ea.DEVICE?.isDesktop` のときだけ作る `ToggleButton`、`scene.view3D` の切替、`setVal` が false を返して保存しないこと）は Obsidian の DOM（`createDiv`／`setIcon`）と `PageSuggest`／`LinkTagFilter` に依存するので実機のみ（LEV-115 で見る: トグルで 3D／2D が切り替わり、再起動後は 2D。17 個目のボタンと 3 本目の区切り線が `.excalibrain-buttons` の `max-width: 37em` に収まるか（収まらなければ `styles.css` で広げる）。描画中に 3D を連打しても要素が二重にならないか。`autoOpenCentralDocument` が on のとき 3D の切替で中心ノートが開くのは他のトグルと同じ挙動）。

### Obsidian 実機の初回準備

1. まだ試用していない専用環境で `npm run harness:prepare` を実行する。生成するのはこのプロジェクト内の `test-vault/` のみ。
2. Obsidian でそのフォルダを Vault として開き、コミュニティプラグインの制限モードを解除して Dataview（`dataview`）と Excalidraw（`obsidian-excalidraw-plugin`、`MINEXCALIDRAWVERSION` 以上）をインストール・有効化する。ハーネスは他プラグインをダウンロードしない。
3. `npm run harness:preflight` を実行する。これはファイルと設定の検査であり、実行中プラグインが最新である証明ではない。有効プラグインが 3 つちょうどでなければ失敗し、実機確認の条件に含めない。
4. JevBrain を有効化し、コマンド「ExcaliBrain」（表示名は上流のまま。LEV-147 で変えたのは plugin ID・名前・作者だけ）でグラフを開く。`Fixtures/` の 14 ノート（Asimov の著作と関係 6 つ、3D 用の 8 つ＝`docs/3d-brief.md` §7）が期待するグラフになるかを画面で確認する。
4. ExcaliBrain を有効化し、コマンド「ExcaliBrain」でグラフを開く。`Fixtures/` 直下の 17 ノート（Asimov の著作と関係 6 つ、3D 用の 11 ＝`docs/3d-brief.md` §7 の 8 つと LEV-124・LEV-128 の追加）が期待するグラフになるかを画面で確認する。`Fixtures/big/` の 75 ノートは 3D の実測（E17）専用で、ここでは開かない。
5. 下記ケースを再現し、UI の状態と（ノートを変えた場合は）変更後の Markdown を両方保存する。

`harness:prepare` は fixture を初期化するため、ユーザーが試用中の Vault には再実行しない。再実行した場合、`community-plugins.json` は jevbrain と、すでに有効なら Dataview／Excalidraw だけを残して書き直す（それらの配布物と設定には触れない）。本人の Vault や他プロジェクトの配布物は操作しない。

### 試用中の更新

製品コードを変更したら、配布物だけを更新する。

```sh
npm run check
cp dist/jevbrain/main.js dist/jevbrain/manifest.json dist/jevbrain/styles.css test-vault/.obsidian/plugins/jevbrain/
npm run harness:preflight
```

plugin ID を変える前（LEV-147 より前）に作った `test-vault/` には `plugins/jevbrain/` が無いので、この `cp` は失敗する。その Vault は消してから `npm run harness:prepare` をやり直す。`harness:prepare` は古い `plugins/excalibrain/` を消さない（`community-plugins.json` からは外れるので次回起動では読み込まれないが、Obsidian を開いたままだと古い版が動き続ける）。

その後、専用 Obsidian 環境で JevBrain だけを再読込して対象画面を開き直す。`preflight` の成功だけでは実行中コードの更新は確認できないので、新しい表示・操作も確認する。

検証用 Obsidian は Mappy と同じもの（`projects/Mappy/artifacts/obsidian-profile` のプロファイル、CDP ポート 9231）で、この Vault を開いておく。エージェントは `artifacts/e2e/cdp.mjs`（Mappy の `lev-71-map-search-e2e/cdp.mjs` を Vault パスだけ変えて複製。gitignore 内）で renderer に JS を流し、`node artifacts/e2e/cdp.mjs eval <probe.js> <out.json>` と `shot <out.png>` で結果と画面を取る。プローブでは `app.workspace.getLeaf(false)` を使わない（brain のリーフを返して scene を閉じる）。E01〜E10 の一式は `artifacts/e2e/*.js`。

| ID | 実機ケース | 期待する結果 |
| --- | --- | --- |
| E01 | `Fixtures/Foundation` を中心に開く | 既定のオントロジーでは `Author::` `Genre::` はフィールドとして扱われず推論リンクになる。北に Reading List（片方向リンクの推論の親）、左に Isaac Asimov・Science Fiction・Robot Series（相互リンク＝左友）、東に Foundation and Empire（`next::`）、南に Psychohistory（ゴースト）。確認 2026-09-21（`artifacts/h0-e2e/record.md`） |
| E02 | ノードをクリック／Shift＋クリック | クリックで中心が移り履歴に積まれる。ゴースト Psychohistory の Shift＋クリックで新規ノート作成のプロンプトが出る |
| E03 | 戻る／進む（HistoryPanel） | 直前の中心に戻り、進むで復帰。中心ノードのファイルが開く設定なら同期して開く |
| E04 | `Reading List` を開く | `https://www.gutenberg.org` が URL ノードとして子の行に出る（origin ノードは出ない）。確認 2026-09-21 |
| E05 | エディタで `Author:: ` の行を右クリック | 「Add "Author" to ExcaliBrain Ontology」が出て、選ぶと Ontology に追加され設定に反映される。`editor-menu` の項目追加は 2026-09-21 に確認済み。右クリックの表示自体は自動化できないので本人の目視 |
| E06 | フォルダ／タグノードの表示切替 | ツールパネルのトグルでフォルダ・タグのノードが出入りし、レイアウトが崩れない |
| E07 | 推論リンクの表示切替 | Robot Series（推論の子）が消え、定義済みの関係だけ残る |
| E08 | Power filter | 対象外。ツールパネルのボタンは上流でコメントアウトされていて UI が無い（設定 `applyPowerFilter` だけ残る） |
| E09 | 設定画面を開く | 全セクションが描画され、ノード／リンクのデモ画像が更新される |
| E10 | Excalidraw を無効化して起動 | 起動せず警告 Notice。有効化後に復帰する |
| E11 | Dataview のインデックス更新中に起動 | 待機の Notice が出て、完了後にグラフが描画される。自動では再現できない（再インデックスを起動と同時に強制する手段が無い）。大きな Vault で本人が試す |
| E12 | モバイル（`isDesktopOnly: false`） | 未実施。証跡が揃うまで対応と言わない |
| E13 | 設定画面の Ontology 節で Up (abstract) に `up`、Down (concrete) に `down, example` を入れる | 保存され、Parents／Children 側から同じフィールドが消える。再読込後も残る。確認 2026-09-21（CDP で text area に入力、`artifacts/3d1-e2e/record.md`） |
| E14 | `Fixtures/習慣はトリガー固定で続く` を中心に 2D で開く | 北に 行動デザイン・習慣ループ・抽象化のはしご（どれも up、緑 4.5。抽象化のはしごはファイルの無い未解決リンク）と 読書メモ：習慣の本（origin、既定色）、西に if-then プラン（similar）、東に 意志力で続ける（next）、南に 朝のルーティン手順（down）・歯磨き後に腕立て・9月20日 朝ランの記録（example）と、習慣トラッカーの使い方・週次レビューのテンプレート（leads to、Children 領域なので段は付かない）。Up／Down の線だけ緑・太さ 4.5。確認 2026-09-21（2 つ目の Up「習慣ループ」と未解決の Up「抽象化のはしご」を足した LEV-124 のあとも確認。`artifacts/3d2-vertical-e2e/record.md`） |
| E15 | ツールパネルの 3D トグルを押す | 斜投影（東西は水平、南北は右上がり、高さは東へ倒れる＝`heightShearX` 0.64、LEV-137）。if-then プラン／中心／意志力で続ける が水平一直線、Up の 3 つ（行動デザイン・習慣ループ・抽象化のはしご）は同じ高さで東西に等間隔、Down の 3 つは床の下で東西に等間隔。どちらも 2D では中心の真上・真下だが、画面では高さの傾き（`heightShearX` 0.64、LEV-137）のぶん Up が東・Down が西へ倒れる（既定値では Up が 153px 東、Down が 181px 西）。床の平行四辺形の上にいるのは level 0 だけ（読書メモ：習慣の本＝奥、if-then プラン＝西、意志力で続ける＝東、習慣トラッカーの使い方・週次レビューのテンプレート＝手前）で、Up と Parents、Down と Children は重ならない。床はグリッドと十字と N／S／W／E を持ち、手前（S）にも奥行きがあり、左右は中心ノート（垂直軸）に対して対称（LEV-135）。柱と影は描かない（LEV-128）。リンクは細く薄く箱同士、ゲートと数字なし、箱は level 別の色（L ラベルは LEV-130 でやめた）。方角の N と S は床の縁のすぐ外。console.error なし。確認 2026-09-21（3D-2 は `artifacts/3d2-e2e/record.md`、Up／Down の垂直軸と未解決の Up（LEV-124）は `artifacts/3d2-vertical-e2e/record.md`、柱と影の廃止・床の奥行き・帯の距離（LEV-128）は `artifacts/3d-floor-depth-e2e/record.md`。L ラベルの廃止と方角の位置（LEV-130）は `artifacts/3d-labels-e2e/record.md`（本人が編集中の Vault に対してで、確かめたのは L ラベル 0 個・方角の距離・2D の一致だけ）、床の左右の釣り合い（LEV-135）は `artifacts/3d-floor-centre-e2e/record.md`（同じく編集中の Vault で、確かめたのは床の 4 隅と中心までの距離・Up の列の中央・2D の一致だけ）、高さの傾き（LEV-137）は `artifacts/3d-height-shear-e2e/record.md`（同じく編集中の Vault で、確かめたのは上の段の東へのずれと 2D の一致だけ）、折り返しと上限（LEV-127）は `artifacts/3d-wrap-e2e/record.md`（同じく編集中の Vault で、確かめたのは 5 列での折り返し・行の高さ・Down が切られないこと・2D の一致）。この表の Up／Down の並びと床の上の顔ぶれは LEV-128 の証跡のまま。本人の目視は未） |
| E16 | 3D トグルを戻す／プラグインを再読込する | 2D の座標が押す前と完全一致。再読込後は常に 2D で、Up／Down の設定は残る。確認 2026-09-21 |
| E17 | `Fixtures/big/大きな脳` を中心に開き、2D → 3D → 2D と切り替える（3D-3 の実測用の大きな fixture。親 20（`origin::`）・子 30（`leads to::`）・Up 7・Down 7・左右の友 5 ずつ） | 2D は領域ごとに `maxItemCount`（既定 30）で切る。Up／Down は `Page` の `parentFields`／`childFields` の先頭なので残り、北は Up 7 ＋ 親 20 ＝ 27（上限内）、南は Down 7 ＋ 子 23（`leads to` の後ろ 7 件が落ちる）、左右は 5 ずつ＝箱 68。3D は帯が `maxItemCount3D`（既定 12）、垂直軸が `verticalColumns × maxVerticalRows`（5 × 3 ＝ 15）で別々に切られ（§6-7）、北は Up 7 ＋ 親 12、南は Down 7 ＋ 子 12、左右は 5 ずつ＝箱 49。Up 7 も Down 7 も 5＋2 の 2 行に折り返し、床の平行四辺形の上は level 0 だけ。3D を戻すと 2D の座標が完全一致、console.error なし。要素数・描画時間・箱の重なりは下記「3D の実測手順」で測り `artifacts/3d-3-measure/record.md` に記録する。未実施（箱の数はコードと既定値からの見積もりで、実測で確かめる） |
| E18 | （JEV-1）設定画面の「Jev」節を開いて API キーを入れ、有効化してタブを閉じ、Obsidian を再読込してから `Fixtures/習慣はトリガー固定で続く` の本文の未型付けリンクにカーソルを置いてコマンド「Jev: カーソルのリンクに型を付ける（第一候補で確定）」 | 設定（LEV-165）: 「Jev」節に注意書きと 10 個の項目が並び、API キーは伏せ字で、有効化して閉じると再読込を促す Notice が 1 回出る。キーを空にして再読込すると Jev の項目が何も登録されない。コマンド（LEV-170）: `## Relations` に `field:: [[X]]` が 1 行入り、本文は変わらない。JevBrain を開くと次の描画で X が型の位置に移る。`jev-log.json` に 1 件。未実施 |
| E19 | （JEV-2）JevBrain の view を閉じたままノートに `[[X]]` を書いて `]]` を閉じる | サジェストに候補・確率・方向が出て、Enter で `## Relations` に追記、Esc で消える。同じリンクで 2 度目は出ない。未実施 |
| E20 | （JEV-3）ツールパネルの Jev ボタンでキューを開き、中心を変える | 中心ノートの未型付けが並び、確定でノードが移り、取り消しで戻る。下部に呼び出し回数と概算費用。未実施 |
| E21 | （JEV-4）`Fixtures/big/大きな脳` を中心に「一括」→ Vault 全体 | 件数と概算費用が出て、実行後に確定 n・確認待ち m と「この一括を取り消す」。取り消しで全行が消える。見直しタブに型付きの提案だけが出る。未実施 |

### Jev の実機確認（JEV-1〜JEV-4、E18〜E21）

- API キーは検証用 Obsidian の `test-vault/.obsidian/plugins/jevbrain/data.json`（gitignore 内）に設定画面から入れる。リポジトリ、`artifacts/` の記録、Linear のコメント、スクリーンショットにキーを写さない。
- Jev は実際に呼ぶ（費用は 1 判定 0.01 円台）。記録には呼び出し回数・トークン・費用の実績を書く。
- 単体テスト（`tests/jev/`）は `tests/fixtures/jev/*.json` の記録した応答だけを使う。新しい応答の形を記録するときは Vault の内容を含まない fixture（`tests/fixtures/` の 3D 用 8 ノート）で取る。
- 精度テスト（JEV-0、`scripts/jev-accuracy.mjs`）は本人の Vault を読むのでプラグインの外で走らせ、`artifacts/jev-accuracy/` に集計だけを残す。

### 3D の実測手順（3D-3、E17）

`Fixtures/big/大きな脳`（75 ノート。タイトルの長さは揃えておらず、最長は `maxLabelLength` ちょうどの 30 文字＝いちばん広い箱）で、要素数・描画時間・箱の重なりを測る。先に E13 の設定（Up＝`up`、Down＝`down, example`）を入れ、`npm run harness:prepare`（`Fixtures/big/` はサブフォルダのまま入る）と `npm run harness:preflight` を通す。プローブは `artifacts/e2e/cdp.mjs`（gitignore 内）で renderer に流し、結果は `artifacts/3d-3-measure/record.md` に書く。先にコマンド「ExcaliBrain」でグラフを開いておく（`plugin.pages` が空だと `renderGraphForPath` は何もしないで戻る）。

```js
const scene = app.plugins.plugins.excalibrain.scene;
const measure = async (view3D) => {
  scene.view3D = view3D;
  const t0 = performance.now();
  await scene.reRender(false); // 索引は作り直さない。描画だけの時間
  const ms = performance.now() - t0;
  const elements = scene.ea.getViewElements();
  const byId = new Map(elements.map((el) => [el.id, el]));
  const boxes = [...scene.nodesMap.values()].flatMap((node) => {
    const box = byId.get(node.id); // node.id は箱（テキストの枠）の要素
    return box ? [{title: node.title, level: node.level, ...node.getCenter(), w: box.width, h: box.height}] : [];
  });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    // 同じ段（画面の y の差が箱の高さの和の半分未満）で、x の差が箱幅の和の半分未満なら重なり
    if (Math.abs(a.y - b.y) < (a.h + b.h) / 2 && Math.abs(a.x - b.x) < (a.w + b.w) / 2) overlaps.push([a.title, b.title]);
  }
  return {view3D, ms: Math.round(ms), elements: elements.length, nodes: scene.nodesMap.size, boxes: boxes.length, overlaps};
};
await scene.renderGraphForPath("Fixtures/big/大きな脳.md", false);
return {twoD: await measure(false), threeD: await measure(true), back: await measure(false)};
```

- **要素数**: `ea.getViewElements().length`（箱・リンク・床・方角をすべて含む）と、ノードの数 `scene.nodesMap.size`、箱が取れたノードの数の 3 つ。2D と 3D では上限が違うので両方を記録する。
- **描画時間**: `reRender(false)` の前後の `performance.now()` の差。同じ切り替えを 3 回続けて測り、中央値と最大値を書く（初回は Excalidraw の初期化を含むので分けて書く）。索引の再構築込みを見たいときだけ `reRender(true)` で別に測る。
- **重なり**: 上の組数と、どのノート同士かを記録する。2D と 3D の両方を測り、その差を「3D で増えた重なり」として読む。`docs/3d-design.md` §7 の開いている論点（埋め込みの中心、帯に残る level 0 の位置）に当たるものは分けて書く。
- **戻り**: 最後に `view3D` を false に戻し、`back` と `twoD` の座標が一致すること（E16 と同じ確認）と console.error が無いことを見る。
- 見た目の確認（E17 の並びと重なり）はツールパネルのトグルで行う。プローブが直接書き替える `scene.view3D` はトグルの表示に反映されない。
- 判断は `docs/product-plan.md` §3「3D-3」の受入条件に戻す。重なりが残る場合は、上限（`maxItemCount3D`・`verticalColumns`）を下げるのか配置を変えるのかを証跡の数字と一緒に書く。

## 証跡

`artifacts/<チケットまたは日付-短い名前>/record.md` に、実行条件（コミット、`dist/build-info.json` の SHA256、Obsidian と Dataview／Excalidraw のバージョン）、ケース ID ごとの結果、スクリーンショットのファイル名を書く。未実施のケースは「未実施」と書く。`artifacts/` は gitignore 済みで、PR には要点だけを転記する。

## リリース手順

1. `main` を最新にし、`npm run check` を通す。
2. `npm version x.y.z`（`v` なし）。`scripts/version-bump.mjs` が `manifest.json` と `versions.json` を更新し、npm が `package.json`／`package-lock.json` とタグ `x.y.z` を作る。
3. コミットとタグを push する。`release.yml` が check を通し、`dist/jevbrain/` の 3 ファイルを Release に添付する。0.x は pre-release。
4. BRAT にリポジトリを登録して配布物が取れることを確認し、`artifacts/` に記録する。

plugin ID は `jevbrain`、名前は JevBrain で、上流版（`excalibrain`）とは別プラグインとして入る（LEV-147）。実機での同時インストールは未確認で、既定の図面ファイルがどちらも `excalibrain.md` なので並べて使うには片方の設定を変える。BRAT での配布は Jev の実装後まで保留。

## 上流との同期

上流は `https://github.com/zsviczian/excalibrain`。取り込むときは `git remote add upstream <URL>` の上で `git fetch upstream` し、worktree で `git merge upstream/master` する。ハーネスが置き換えた設定ファイル（上記「引き継ぎ時に削除」）は上流側の変更を採用せず、`src/` と `styles.css` の変更だけを取り込む。取り込み後は `npm run check` と実機ケースを再確認し、判断記録に版を書く。
