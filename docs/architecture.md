# jev-brain の設計と引き継ぎ

更新日: 2026-09-20

上流 ExcaliBrain の設計は `EXCALIBRAIN_DETAILED_SPECIFICATION.md`（英語、上流作者による技術仕様）が正本で、ここでは繰り返さない。本書はモジュール境界、外部プラグインとの接続、フォークで加えた判断だけを記す。

## 1. モジュール境界

| 層 | ファイル | 役割 | 依存してよいもの |
| --- | --- | --- | --- |
| 登録・ライフサイクル | `src/excalibrain-main.ts` | プラグインの load/unload、コマンド、設定の読み書き、Dataview／Excalidraw／Hover Editor／Bookmarks の検出、`Scene` の起動 | Obsidian API、外部プラグインの型 |
| インデックス | `src/graph/Pages.ts`、`Page.ts`、`URLParser.ts`、`src/utils/dataview.ts` | `metadataCache` と Dataview から関係（親・子・左右の友・前後）を組み立てる | Obsidian API、Dataview の型。描画 API は持ち込まない |
| 描画・レイアウト | `src/Scene.ts`、`src/graph/Node.ts`、`Link.ts`、`Links.ts`、`Layout.ts` | ExcalidrawAutomate で Excalidraw ファイル上にノードとリンクを描く。中心ノードの切替、履歴、イベント購読 | ExcalidrawAutomate（`src/utils/ExcalidrawAutomateCompatibility.ts` の型） |
| UI 部品 | `src/Components/*`、`src/Suggesters/*`、`src/Settings.ts` | ツールパネル、履歴、フィルタ、Ontology 追加モーダル、設定タブ、候補表示 | Obsidian の UI API、`Scene` |
| 共有 | `src/Types.ts`、`src/constants/*`、`src/lang/*`、`src/utils/*` | 型、既定値、24 言語の文言、ユーティリティ | なし（`obsidian` の `moment` を除く） |

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

## 4. 判断記録

| ID | 判断 | 理由 |
| --- | --- | --- |
| D1 | plugin ID・名前は上流と同じ `excalibrain`／ExcaliBrain のまま | 変えると別プラグインになり設定も引き継げない。公開時に本人が決める |
| D2 | ビルドの出力は Mappy と同じ配置（ルート `main.js` → `dist/excalibrain/`） | 2 プロジェクトで同じスクリプト・同じ手順にする。上流の `dist/main.js` と `manifest-beta.json` は使わない |
| D3 | `tsconfig` は上流の緩さ（`strict` なし、`strictPropertyInitialization: false`）を維持し、`moduleResolution: Bundler`・`isolatedModules`・`noFallthroughCasesInSwitch` を足した。`esModuleInterop` は外した | strict 化は 262 件の作業で、ハーネス整備と分ける（product-plan H1）。`esModuleInterop` は obsidian の `moment` の型を壊す |
| D4 | lint のベースラインはルール×ファイルで止める（グローバルに off にしない） | 新しいファイルと直したファイルには recommended が全部かかる。内訳は `docs/harness.md` |
| D5 | 上流の型エラー 26 件は型だけの変更で解消した | 内訳: `InternalPluginsLike.getPluginById` の戻り型を 1 つに統合、`App` 拡張に `commands`、EA 型に `newFilePrompt` と `getActiveEmbeddableViewOrEditor` の戻り型、`querySelector<HTMLElement>`、`errorlog` の `message` 追加、`startPromise !== null`、`editor-menu` ハンドラの未使用引数削除、`Page.getTitle` の alias の型絞り込み（`String()` で従来と同じ値）、`Settings` の `strokeShaprness` を文字列のときだけ渡す |
| D6 | 実機の前提として Dataview と Excalidraw を preflight で必須にする | 無いと起動しないので、欠けた状態の実機結果に意味がない |
| D7 | Ontology の読み込み（既定値・領域間の排他・ソート）を `src/utils/hierarchy.ts` の純関数に移し、排他を hidden → Up → Down → Parents → Children → 左右 → 前後 → exclusions の一本の順序に揃えた（LEV-106） | 上流の `loadSettings` は Parents だけ hidden との重複を落としておらず（hidden の追加時の抜け）、同じフィールドが両方に残った。他の全領域と同じく hidden が勝つ排他にする。差が出るのは hidden と Parents に同じフィールドを書いた設定だけ。その場合、書いた側のノートでは上流も新コードも相手を隠すので同じだが、相手側のノートを中心にしたとき上流は定義済みの子（フィールドのスタイル・ラベル付き）として描き、新コードでは Parents から落ちるので推論リンクになる。意図した変更として受け入れる。上流との差はほかに 3 点: (1) 返り値を新しい配列にして `DEFAULT_HIERARCHY_DEFINITION` をその場でソートしない、(2) `parents`／`children` が無い・配列でない data.json でも落ちずに既定値を使う（他の領域は上流と同じく falsy を既定値に置き換える）、(3) 旧 `friends` は `leftFriends` への移行で消費し、data.json に書き戻さない。小文字化・空白→ハイフン・ソートの比較関数・hidden の `[""]` 既定は上流と同じ結果で、`tests/utils/hierarchy.test.ts` が上流アルゴリズムの写しと突き合わせている |

## 5. フォークで変えていないもの

`src/` と `styles.css` の挙動は上流 0.2.18（＋作者による code scanner fixes）のまま。例外は D7（Ontology 読み込みの排他の順序と Up／Down 領域の追加）。D5 の変更は型のみで、実機での差分確認は未実施（`docs/harness.md` E01〜E11）。
