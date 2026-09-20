# ハーネスと検証手順

更新日: 2026-09-20

## 現在の範囲

AI エージェントと人間が同じ条件で開発・検証するため、自動検査、テスト用 fixture、専用 Vault、配布物一致の確認、実装時の規約を用意している。製品コードは上流 ExcaliBrain 0.2.18 をそのまま引き継いでおり、自動テストがあるのはリリース用ツーリングと純ロジック（URL 正規表現、ファイル名ユーティリティ）だけ。描画（Excalidraw）とインデックス（Dataview）を含む挙動は実機でしか確認できない。

件数・バンドルサイズ・実機の PASS/FAIL をこの文書に固定せず、実行日時とビルドのハッシュを付けた `artifacts/` の記録で追う。GitHub 上の CI、モバイル、性能計測、長時間利用の検証は、個別の証跡が揃うまで未完了として扱う。

| ゲート | コマンド / 設定 | 検出するもの |
| --- | --- | --- |
| メタデータ | `npm run validate` | manifest/package/lock/versions の不整合、必須文書の欠落 |
| lint | `npm run lint` | 製品ソースの公式 Obsidian 推奨ルール、型情報付き ESLint、JSON 構文、スクリプトの未使用変数 |
| 型検査 | `npm run typecheck` | 上流設定＋`noImplicitAny`、switch の fallthrough、Bundler 解決。strict は未導入（下記） |
| 単体テスト | `npm test` | リリース検証・バージョン更新・release.yml の形・preflight／Vault 準備の安全性、URL 抽出、ファイル名 |
| production bundle | `npm run build` | ブラウザ互換 CJS バンドル（`main.js`）。Obsidian 提供 API は external |
| 配布物 | `npm run package` | `dist/excalibrain/` の必要ファイルと元ビルドとの一致、`dist/build-info.json` に SHA256 |
| Vault 初期準備 | `npm run harness:prepare` | `check` 後、生成専用 Vault に配布物・fixture を配置。有効プラグインは excalibrain と、すでに有効なら Dataview／Excalidraw だけを残す |
| 実機前確認 | `npm run harness:preflight` | root / dist / 検証 Vault の SHA256、一致する ID/version、有効プラグインが excalibrain・dataview・obsidian-excalidraw-plugin の 3 つちょうどであること |

まとめて実行するコマンドは `npm run check`。ローカルと GitHub Actions で同じコマンドを使う。ブランチと PR の CI（`check.yml`）は成果物を artifact に保存するだけで、公開を行わない。`manifest.version` と同じタグを push したときだけ `release.yml` が同じ check を通し、配布物 3 ファイルを GitHub Release に添付する（[リリース手順](#リリース手順)）。CodeQL（`codeql-analysis.yml`）は上流から引き継ぎ、停止済みの v1 action を v3 に更新した。Git hook は任意の `npm run hooks:install` で有効にする。

## lint の対象とベースライン

`eslint-plugin-obsidianmd` の recommended は `src/**/*.ts` に適用する。推奨ルールを手書きでコピーしない。テストと設定は `typescript-eslint` の型情報付き recommended、スクリプト（`scripts/*.mjs`）は Node 用の JS recommended。`--max-warnings 0` が品質基準。

上流コードには 2026-09-20 時点で次の指摘があり、`eslint.config.mjs` の「引き継ぎ時のベースライン」でファイル単位でだけ止めている。新しいファイルには適用されず、該当ファイルを直したらその行を消す。lint の通過はコミュニティ審査の通過を保証しない。

| ルール | 件数 | ファイル | 扱い |
| --- | --- | --- | --- |
| `obsidianmd/commands/no-plugin-id-in-command-id` | 11 | excalibrain-main.ts | 恒久。command ID を変えると既存ユーザーのホットキーと `obsidian://` URI が壊れる |
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
- 純ロジック: `linkRegex`（Markdown リンクと生 URL の抽出。括弧付き URL が途中で切れる上流の挙動もそのまま固定）、`getFilenameFromPath`／`splitFolderAndFilename`。
- `obsidian` モジュールは `tests/mocks/obsidian.ts` に置き換える（`TFile`／`TFolder`／`normalizePath`／`Vault.recurseChildren`／`moment.locale`）。`import ... from "src/..."` は `vitest.config.ts` の alias で解決する。

### 未カバー（実機のみ）

- `Pages`／`Page` の関係判定は `plugin.settings`・`metadataCache`・Dataview API に依存する。テスト用の最小 plugin スタブを作るのは H1 の候補。
- `Scene`・`Node`・`Link`・`Layout` の描画は ExcalidrawAutomate に依存する。Mappy のようなブラウザ検証ページは、Excalidraw 本体を外せないため今は作らない。

### Obsidian 実機の初回準備

1. まだ試用していない専用環境で `npm run harness:prepare` を実行する。生成するのはこのプロジェクト内の `test-vault/` のみ。
2. Obsidian でそのフォルダを Vault として開き、コミュニティプラグインの制限モードを解除して Dataview（`dataview`）と Excalidraw（`obsidian-excalidraw-plugin`、`MINEXCALIDRAWVERSION` 以上）をインストール・有効化する。ハーネスは他プラグインをダウンロードしない。
3. `npm run harness:preflight` を実行する。これはファイルと設定の検査であり、実行中プラグインが最新である証明ではない。有効プラグインが 3 つちょうどでなければ失敗し、実機確認の条件に含めない。
4. ExcaliBrain を有効化し、コマンド「ExcaliBrain」でグラフを開く。`Fixtures/` の 6 ノート（Asimov の著作と関係）が期待するグラフになるかを画面で確認する。
5. 下記ケースを再現し、UI の状態と（ノートを変えた場合は）変更後の Markdown を両方保存する。

`harness:prepare` は fixture を初期化するため、ユーザーが試用中の Vault には再実行しない。再実行した場合、`community-plugins.json` は excalibrain と、すでに有効なら Dataview／Excalidraw だけを残して書き直す（それらの配布物と設定には触れない）。本人の Vault や他プロジェクトの配布物は操作しない。

### 試用中の更新

製品コードを変更したら、配布物だけを更新する。

```sh
npm run check
cp dist/excalibrain/main.js dist/excalibrain/manifest.json dist/excalibrain/styles.css test-vault/.obsidian/plugins/excalibrain/
npm run harness:preflight
```

その後、専用 Obsidian 環境で ExcaliBrain だけを再読込して対象画面を開き直す。`preflight` の成功だけでは実行中コードの更新は確認できないので、新しい表示・操作も確認する。

| ID | 実機ケース | 期待する結果 |
| --- | --- | --- |
| E01 | `Fixtures/Foundation` を中心に開く | 親に Isaac Asimov（Author）と Science Fiction（Genre）、右友に Foundation and Empire（next）、子に Psychohistory（ゴースト）と Robot Series（推論）が出る |
| E02 | ノードをクリック／Shift＋クリック | クリックで中心が移り履歴に積まれる。ゴースト Psychohistory の Shift＋クリックで新規ノート作成のプロンプトが出る |
| E03 | 戻る／進む（HistoryPanel） | 直前の中心に戻り、進むで復帰。中心ノードのファイルが開く設定なら同期して開く |
| E04 | `Reading List` を開く | `https://www.gutenberg.org/` が URL ノードとして子に出る。origin ノードが有効なら gutenberg.org の下に並ぶ |
| E05 | エディタで `Author:: ` の行を右クリック | 「Add "Author" to ExcaliBrain Ontology」が出て、選ぶと Ontology に追加され設定に反映される |
| E06 | フォルダ／タグノードの表示切替 | ツールパネルのトグルでフォルダ・タグのノードが出入りし、レイアウトが崩れない |
| E07 | 推論リンクの表示切替 | Robot Series（推論の子）が消え、定義済みの関係だけ残る |
| E08 | Power filter | 指定タグのノードだけ残る。解除で戻る |
| E09 | 設定画面を開く | 全セクションが描画され、ノード／リンクのデモ画像が更新される |
| E10 | Excalidraw を無効化して起動 | 起動せず警告 Notice。有効化後に復帰する |
| E11 | Dataview のインデックス更新中に起動 | 待機の Notice が出て、完了後にグラフが描画される |
| E12 | モバイル（`isDesktopOnly: false`） | 未実施。証跡が揃うまで対応と言わない |

## 証跡

`artifacts/<チケットまたは日付-短い名前>/record.md` に、実行条件（コミット、`dist/build-info.json` の SHA256、Obsidian と Dataview／Excalidraw のバージョン）、ケース ID ごとの結果、スクリーンショットのファイル名を書く。未実施のケースは「未実施」と書く。`artifacts/` は gitignore 済みで、PR には要点だけを転記する。

## リリース手順

1. `main` を最新にし、`npm run check` を通す。
2. `npm version x.y.z`（`v` なし）。`scripts/version-bump.mjs` が `manifest.json` と `versions.json` を更新し、npm が `package.json`／`package-lock.json` とタグ `x.y.z` を作る。
3. コミットとタグを push する。`release.yml` が check を通し、`dist/excalibrain/` の 3 ファイルを Release に添付する。0.x は pre-release。
4. BRAT にリポジトリを登録して配布物が取れることを確認し、`artifacts/` に記録する。

コミュニティプラグインへの登録は plugin ID と名前（上流と同じ）を決めてから。上流との同時インストールはできない。

## 上流との同期

上流は `https://github.com/zsviczian/excalibrain`。取り込むときは `git remote add upstream <URL>` の上で `git fetch upstream` し、worktree で `git merge upstream/master` する。ハーネスが置き換えた設定ファイル（上記「引き継ぎ時に削除」）は上流側の変更を採用せず、`src/` と `styles.css` の変更だけを取り込む。取り込み後は `npm run check` と実機ケースを再確認し、判断記録に版を書く。
