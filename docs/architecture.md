# jev-brain の設計と引き継ぎ

更新日: 2026-09-22

上流 ExcaliBrain の設計は `EXCALIBRAIN_DETAILED_SPECIFICATION.md`（英語、上流作者による技術仕様）が正本で、ここでは繰り返さない。本書はモジュール境界、外部プラグインとの接続、フォークで加えた判断だけを記す。

## 1. モジュール境界

| 層 | ファイル | 役割 | 依存してよいもの |
| --- | --- | --- | --- |
| 登録・ライフサイクル | `src/excalibrain-main.ts` | プラグインの load/unload、コマンド、設定の読み書き、Dataview／Excalidraw／Hover Editor／Bookmarks の検出、`Scene` の起動 | Obsidian API、外部プラグインの型 |
| インデックス | `src/graph/Pages.ts`、`Page.ts`、`URLParser.ts`、`src/utils/dataview.ts` | `metadataCache` と Dataview から関係（親・子・左右の友・前後）を組み立てる | Obsidian API、Dataview の型。描画 API は持ち込まない |
| 描画・レイアウト | `src/Scene.ts`、`src/graph/Node.ts`、`Link.ts`、`Links.ts`、`Layout.ts` | ExcalidrawAutomate で Excalidraw ファイル上にノードとリンクを描く。中心ノードの切替、履歴、イベント購読 | ExcalidrawAutomate（`src/utils/ExcalidrawAutomateCompatibility.ts` の型） |
| UI 部品 | `src/Components/*`、`src/Suggesters/*`、`src/Settings.ts` | ツールパネル、履歴、フィルタ、Ontology 追加モーダル、設定タブ、候補表示 | Obsidian の UI API、`Scene` |
| 共有 | `src/Types.ts`、`src/constants/*`、`src/lang/*`、`src/utils/*` | 型、既定値、24 言語の文言、ユーティリティ | なし（`obsidian` の `moment` を除く） |
| Jev（計画、JEV-1〜） | `src/jev/*` | 未型付けリンクの収集、state と判定（Q1 フィールド・Q2 方向・整合性）、`## Relations` への書き込みと取り消しログ、Jev クライアント。UI と描画を持たない | Obsidian API（`vault`、`metadataCache`、`requestUrl`）、`plugin.settings`。UI は `src/Components/Jev*`・`src/Suggesters/Jev*` に置き、`Scene` の描画 API は触らない |

`styles.css` が唯一のスタイル正本。`src/styles/style.scss` は上流の残骸でビルドに使わない。

## 2. データの流れ

```text
Obsidian metadataCache / Dataview index
  → Pages.createIndex()          資料ごとの Page と neighbours（Relation）
  → Page.addDVFieldLinksToPage() Ontology（dataview フィールド名）で定義済み関係を付ける
  → Pages.addResolvedLinks()     前方リンク＝子、後方リンク＝親を推論（設定で反転・友扱い）
  → Pages.addPageURLs()          本文の URL を URL ノードと origin ノードにする
  → Scene.renderGraphForPath()   中心ノードを決め、Layout で列に並べ、Node/Link を EA で描く
  → Excalidraw view              クリック／Shift＋クリック／履歴で次の中心へ
```

前提プラグイン: Dataview（インデックスと `tryEvaluate`）、Excalidraw（描画と `ExcalidrawAutomate`）。どちらも無いと `excalibrain-main.ts` が起動を止めて Notice を出す。任意: Hover Editor（ポップアウト表示）、Periodic Notes／Calendar（日付ノートの書式）、Bookmarks／Starred（お気に入り）。

## 3. 外部 API との境界

- Excalidraw の API 型は同梱せず、使う面だけを `ExcalidrawAutomateCompatibility.ts` に構造的な型として書く。上流はこの方針で code scanner の指摘を潰しており、フォークでも同じ場所に足す。
- Obsidian の非公開 API（`app.plugins`、`app.commands`、`internalPlugins`）は `excalibrain-main.ts` 冒頭の `declare module "obsidian"` と `ExternalPluginTypes.ts` にまとめる。
- `src/graph/` は `plugin.settings` と `plugin.app` を通じて Obsidian に触るが、EA は受け取らない。Node／Link の描画は `Scene` 側に置く。
- 外部への通信は Jev（TypeSafe）だけで、`src/jev/client.ts` の `requestUrl` に閉じる。`src/graph/` と `Scene` は `src/jev/` を import しない。API キーが空なら `excalibrain-main.ts` は Jev の view・suggest・command を登録しない（`docs/jev-link-typer-design.md` §9）。

## 4. 判断記録

| ID | 判断 | 理由 |
| --- | --- | --- |
| D1 | plugin ID は `jevbrain`、名前は JevBrain、作者は Hiroya Iizuka（LEV-147。本人の決定、2026-09-21。それまでは上流と同じ `excalibrain`／ExcaliBrain） | 上流版と並べて入れられるようにする。ID が違うと別プラグイン扱いで、上流版の設定と図面は引き継がれない（フォーク直後で配布前なので移行対象の利用者はいない）。ただし既定の図面ファイルがどちらも `excalibrain.md` なので、本当に並べて使うには片方の設定を変える必要がある。同時インストールの実機確認は未実施。command ID `excalibrain-*`・CSS クラス・設定のキー・既定の図面ファイル・`APPNAME` の表示文字列は据え置き。上流との diff を小さく保つためで、ホットキー互換のためではない: Obsidian は command を `<manifest.id>:<command id>` で登録するので、ID を変えた時点で保存済みのホットキーと `obsidian://` URI はどちらにせよ効かなくなる（未配布なので実害はない）。表示名の置き換えは別チケット。`constants.PLUGIN_NAME` は `disablePlugin()` に渡す自分の ID なので manifest と揃える。BRAT 配布は Jev の実装後 |
| D2 | ビルドの出力は Mappy と同じ配置（ルート `main.js` → `dist/<plugin ID>/`、現在は `dist/jevbrain/`） | 2 プロジェクトで同じスクリプト・同じ手順にする。上流の `dist/main.js` と `manifest-beta.json` は使わない |
| D3 | `tsconfig` は上流の緩さ（`strict` なし、`strictPropertyInitialization: false`）を維持し、`moduleResolution: Bundler`・`isolatedModules`・`noFallthroughCasesInSwitch` を足した。`esModuleInterop` は外した | strict 化は 262 件の作業で、ハーネス整備と分ける（product-plan H1）。`esModuleInterop` は obsidian の `moment` の型を壊す |
| D4 | lint のベースラインはルール×ファイルで止める（グローバルに off にしない） | 新しいファイルと直したファイルには recommended が全部かかる。内訳は `docs/harness.md` |
| D5 | 上流の型エラー 26 件は型だけの変更で解消した | 内訳: `InternalPluginsLike.getPluginById` の戻り型を 1 つに統合、`App` 拡張に `commands`、EA 型に `newFilePrompt` と `getActiveEmbeddableViewOrEditor` の戻り型、`querySelector<HTMLElement>`、`errorlog` の `message` 追加、`startPromise !== null`、`editor-menu` ハンドラの未使用引数削除、`Page.getTitle` の alias の型絞り込み（`String()` で従来と同じ値）、`Settings` の `strokeShaprness` を文字列のときだけ渡す |
| D6 | 実機の前提として Dataview と Excalidraw を preflight で必須にする | 無いと起動しないので、欠けた状態の実機結果に意味がない |
| D7 | Ontology の読み込み（既定値・領域間の排他・ソート）を `src/utils/hierarchy.ts` の純関数に移し、排他を hidden → Up → Down → Parents → Children → 左右 → 前後 → exclusions の一本の順序に揃えた（LEV-106） | 上流の `loadSettings` は Parents だけ hidden との重複を落としておらず（hidden の追加時の抜け）、同じフィールドが両方に残った。他の全領域と同じく hidden が勝つ排他にする。差が出るのは hidden と Parents に同じフィールドを書いた設定だけ。その場合、書いた側のノートでは上流も新コードも相手を隠すので同じだが、相手側のノートを中心にしたとき上流は定義済みの子（フィールドのスタイル・ラベル付き）として描き、新コードでは Parents から落ちるので推論リンクになる。意図した変更として受け入れる。上流との差はほかに 3 点: (1) 返り値を新しい配列にして `DEFAULT_HIERARCHY_DEFINITION` をその場でソートしない、(2) `parents`／`children` が無い・配列でない data.json でも落ちずに既定値を使う（他の領域は上流と同じく falsy を既定値に置き換える）、(3) 旧 `friends` は `leftFriends` への移行で消費し、data.json に書き戻さない。小文字化・空白→ハイフン・ソートの比較関数・hidden の `[""]` 既定は上流と同じ結果で、`tests/utils/hierarchy.test.ts` が上流アルゴリズムの写しと突き合わせている |
| D8 | `Page.addParent`／`addChild` などが関係の定義（", " 区切りのフィールド名の並び）に同じフィールドを二度足さないための判定を、上流の `String.contains()`（部分文字列）から「区切った項目の完全一致」に変えた（LEV-107） | 上流では "group" の後に "up" を足すと `"group".contains("up")` が真になり "up" が落ちた。ラベルが欠けるだけだった上流と違い、Up／Down の領域（`Link` の色・太さ）と 3D の高さ（`Projection.levelOf`）はこの並びから引くので、索引の順序でリンクの見た目が変わってしまう。差が出るのは、同じ隣接ノートへ「一方のフィールド名が他方の部分文字列になる 2 つのフィールド」で辿るノートだけで、その場合ラベルが両方のフィールドを並べるようになる。`tests/graph/page-relations.test.ts` で固定 |
| D9 | Jev 連携をフォーク本体に入れる（`src/jev/` ＋ `src/Components/Jev*`・`src/Suggesters/Jev*`）。2026-09-20 の「別プラグイン、フォークはネットワークなし」を撤回（本人の決定、2026-09-22） | 一括確定と型付け待ちキューがツールパネルと中心ノードの切替に密着するので、別プラグインだと本体に API を生やす二度手間になる。代償は上流との diff が増えることと、配布時にネットワーク利用の開示が要ること。境界で抑える: 通信は `client.ts` だけ、キーが無ければ何も登録しない、graph 層と `Scene` は jev を知らない、jev は描画 API を触らず `metadataCache` 経由の次の描画に任せる。書き込みは `## Relations` への追記で本文は触らず、`jev-log.json` で取り消せる。既存の型は自動更新しない |

## 5. フォークで変えていないもの

`src/` と `styles.css` の挙動は上流 0.2.18（＋作者による code scanner fixes）のまま。例外は D7（Ontology 読み込みの排他の順序と Up／Down 領域の追加）、D8（関係の定義の重複判定を完全一致に）、D1（`constants.PLUGIN_NAME` を廃止し、`disablePlugin()` に `this.manifest.id` を渡す）。D5 の変更は型のみで、実機での差分確認は未実施（`docs/harness.md` E01〜E11）。Jev 連携（D9）は着手済みで、設定（`ExcaliBrainSettings.jev`）と登録の分岐（`registerJev()`。キーが無ければ呼ばない）、`src/jev/` の `client.ts`（通信 `askJev`。LEV-166）・`state.ts`（`buildState`。LEV-167）・`judge.ts`（`buildQuestions`・`judge`。LEV-167）・`collect.ts`（未型付けリンクの収集。LEV-168）・`relations.ts`／`log.ts`（`## Relations` への追記と取り消し。LEV-169）が入っている。D9 の境界はここから実際の制約になる。これらを 1 リンクぶん通しで結ぶ `typeLink.ts` と、それを呼ぶコマンド（`src/Components/JevTypeLinkCommand.ts`、`registerJev()` から登録）が LEV-170 で入り、LEV-174 で型付け待ちキュー（`src/Components/JevQueueView.ts`、同じく `registerJev()` から `registerView`）がUI の最初の入口になった。上流のファイルに足したのは `Scene` の 2 行だけで、中心が決まったこと（`render()`）と無くなったこと（`unloadScene()`）を `workspace.trigger("jevbrain:central-page-changed", path | null)`（名前は `src/utils/jevEvents.ts`）で知らせる。渡すのはパスだけなので `Scene` は jev を import せず、描画 API も jev 側へ渡らない（D9 の境界のまま）。実機の確認はコマンドが E18（API キー待ちで未実施）、キューが LEV-176、サジェスターは JEV-2。
