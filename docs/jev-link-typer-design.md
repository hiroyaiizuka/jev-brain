# Jev 連携の設計（エディタのサジェスター・型付け待ちキュー・一括確定）

更新日: 2026-09-22。2026-09-20 の設計メモ（別プラグイン案）を、本人の決定（2026-09-22: 「一括確定と既存の見直し」と「Markdown 上のサジェスター」の両方をやる、置き場所は jevbrain 本体）で置き換えた。図解は Design キャンバス <https://claude.ai/artifact/T3P4Uy5niqN8JNKWcsby9E>（キュー画面・別案・処理の流れ・コスト試算・一括画面・計画）。受入条件の正本は `docs/product-plan.md` §3「JEV-0〜JEV-5」。

## 1. 何をするか

Jev（TypeSafe の判定専用モデル。文章を生成せず、与えた候補に確率を付けて返す）で、ノートの `[[X]]` に ExcaliBrain のオントロジーのフィールド（`up::`、`origin::`、`similar::` …）を付ける。入口は 3 つで、判定と書き込みは 1 つの部品（§2、§3）を共有する。

| 入口 | いつ | 何が起きるか | フェーズ |
| --- | --- | --- | --- |
| エディタのサジェスター | `]]` を閉じた直後、またはホットキー。JevBrain の view を開いていなくても動く | ポップアップに候補と確率。Enter で確定 | JEV-2 |
| 型付け待ちキュー | JevBrain の中心ノートが変わったとき | 右パネルに未型付けの一覧と Jev の第一候補。1 件ずつ確定 | JEV-3 |
| 一括確定と見直し | キューの「一括」ボタン | 範囲を選んで一括判定。しきい値以上は自動確定、残りはキュー。既存の型は「見直し」タブ | JEV-4 |

Jev にできるのは既存の語彙の順位付けだけなので、新しいフィールド名の発案と「まだ無いリンク先の発見」はしない。後者は第 2 段階（§8）で、候補は Obsidian の信号から作る。

## 2. 判定の中核（`src/jev/`）

### 2-1 未型付けリンクの収集（`collect.ts`）

- 対象: ノート本文の `[[X]]`（エイリアス・見出し付きを含む）のうち、Dataview のインラインフィールド `(field:: [[X]])`、frontmatter、`## Relations` 節のどれにも同じ相手が無いもの。`metadataCache.getFileCache(file).links` から Page の定義済み neighbours（`Page.addDVFieldLinksToPage` が付けたもの）を引いて求める。
- 除外: 埋め込み `![[X]]`、URL、`excludeFilepaths` に当たるパス、hidden のフィールドで既に結ばれた相手。
- 既に型付きのリンクは見直し（§5）の対象で、ここには入れない。

### 2-2 state（`state.ts`）

- 今のノート: frontmatter（タグ・既存のフィールド）と、リンクの前後 N 文字（既定 500、設定 `contextChars`）。
- 相手 X: frontmatter と冒頭 300 文字。ファイルの無い未解決リンクなら名前だけ。
- 見直しのときは「現在のフィールド」。
- 送らないもの: 本文全文、他のノート、Vault のパス。1 判定 ≈ 2,000 トークン（日本語の実測は JEV-0 で）。

### 2-3 質問（`judge.ts`。1 回の呼び出しで 2 問、Jev は並列に評価する）

- Q1 Choice「このリンクに付けるフィールド」: criteria ＝ hierarchy の全フィールド（Up／Down／Parents／Children／左右の友／前後）。各候補の説明 ＝ 領域名＋方向＋（あれば）本人が設定に書いた説明文。
- Q2 Choice「このリンクの方向」: 親／子／左友／右友／前／次。
- 整合性: Q1 の第一候補が設定上持つ方向 ＝ Q2 の答え → 自信あり（確率つきで提示、第一候補を既定にする）。≠ → 自信なし（確率を伏せて設定の順で提示、既定なし）。
- 返り値: `{ field, probabilities: Record<string, number>, direction, directionProbability, confident }`。純関数で、Jev の応答は `client.ts` から受け取る。

### 2-4 しきい値（既定値。JEV-0 の結果で確定する）

- 一括の自動確定: 第一候補の確率 ≥ 0.8 かつ自信あり（`autoConfirmThreshold`）。
- 見直しの提示: 第一候補 ≠ 現在のフィールド かつ 確率 ≥ 0.9 かつ自信あり（`reviewThreshold`）。
- サジェスターとキュー: しきい値なし。必ず本人が押す。

## 3. 書き込みと取り消し（`relations.ts`、`log.ts`）

- 書き先: ノート末尾の `## Relations` 節（見出しは設定 `relationsHeading`、無ければ末尾に作る）に `field:: [[X]]` を 1 行追記する。本文の `[[X]]` は触らない。同じ行があれば何もしない。
- 理由: 可逆で diff が読みやすく、ExcaliBrain は Dataview のフィールドとして拾う（`Page.addDVFieldLinksToPage`）。本文のインライン `(field:: [[X]])` への書き換えは設定 `writeMode: inline` で選べる（既定は `relations`）。
- 見直しの確定: 既存の `field:: [[X]]` 行を置き換える。インラインなら `(old:: [[X]])` → `(new:: [[X]])`。
- ログ: プラグインのデータフォルダの `jev-log.json` に `{ id, batchId, file, line, before, after, at, source }` を追記する（`data.json` とは別ファイル。gitignore 済み）。取り消しは行単位 `undo(id)` と一括単位 `undoBatch(batchId)`。対象の行が手で変わっていたら取り消さずに Notice を出す。
- 反映: `metadataCache` の更新は Obsidian に任せ、JevBrain は既存の `indexUpdateInterval`（`Scene.setTimer()`）で次の描画に反映する。jev から `Scene` の描画 API は呼ばない。

## 4. 入口

### 4-1 エディタのサジェスター（JEV-2、`src/Suggesters/JevLinkSuggest.ts`）

- `EditorSuggest`。`onTrigger`: カーソルの直前が `]]` で、そのリンクが §2-1 の意味で未型付け。同じノートの同じリンクはセッション中 1 回だけ聞く（キャッシュ、ノートを閉じたら消す）。Jev の応答（0.1〜0.5 秒）は非同期で、待つ間はプレースホルダ 1 行。Esc で閉じる。設定 `suggestOnLinkClose` でオフ。
- ホットキー付きコマンド「Jev: カーソルのリンクに型を付ける」: カーソル上の `[[X]]` について同じサジェストを出す。型付きなら現在のフィールドを先頭に置いた付け替え候補。
- 確定は §3。JevBrain の view を開いていなくても動く（必要なのは設定の hierarchy と Jev だけ）。

### 4-2 型付け待ちキュー（JEV-3、`src/Components/JevQueueView.ts`）

- 右サイドの `ItemView`（view type `jevbrain-queue`）。中心ノートが変わるたび（`Scene` の中心変更）に §2-1 で収集し、カードごとに判定を非同期で埋める。判定は同時 3 本（一括の 5 より控えめ。中心を切り替えるたびに走り、本人が見ている 1 ノートぶんなので急がない）。
- カード: リンク先、前後の文、候補（フィールド・確率・方向）、「<第一候補> で確定」「あとで」。確定後は追記した行と「取り消す」。自信なしは確率を伏せ、候補ボタンだけ。
- 「あとで」はセッション内で覚える（プラグインデータには残さない）。
- 下部: このノートの呼び出し回数・トークン・概算費用。
- ツールパネルの「Jev」ボタンで開閉。キーが無ければボタンも view も登録しない。モバイルでは出さない（`ea.DEVICE.isDesktop`）。

### 4-3 一括確定と見直し（JEV-4、`src/Components/JevBulkModal.ts`）

- キューの「一括」ボタン → モーダル: 範囲（中心＋表示中のノード／Vault 全体）、件数、概算費用（件数 × 2,000 トークン × 単価）、実行。並列 5、進捗と中止。
- 自動確定は §2-4 の条件。結果サマリ「確定 n 件・確認待ち m 件」と「この一括を取り消す」（`undoBatch`）。確認待ちはキューに残る。
- 見直しタブ: 型付きリンクのうち §2-4 の条件を満たすものだけ。「現在 origin → 提案 up 92%」。手動確定のみ。
- Vault 全体は 1,200 req/分の上限内で数分（3,000 リンクで約 40 円）。

## 5. 見直し（既存の型の更新）の方針

自動更新はしない。既存の型は本人が付けた正解で、Jev の精度は 100% にならない。見直しは「第一候補が違い、確率が高い」ものだけを別タブで提案し、確定は本人。JEV-0 の結果で提示の価値そのものを判断する。

## 6. 設定（`ExcaliBrainSettings.jev`）

| キー | 既定 | 説明 |
| --- | --- | --- |
| `apiKey` | `""` | 空なら Jev の機能をすべて登録しない。`data.json` はプレーンテキストである旨を設定画面に明記 |
| `enabled` | `false` | 一時的にオフ |
| `suggestOnLinkClose` | `true` | `]]` の直後にサジェスト |
| `contextChars` | `500` | リンク前後の文字数 |
| `relationsHeading` | `"Relations"` | 書き込み先の見出し |
| `writeMode` | `"relations"` | `relations` ／ `inline` |
| `autoConfirmThreshold` | `0.8` | 一括の自動確定 |
| `reviewThreshold` | `0.9` | 見直しの提示 |
| `endpoint` | `https://api.typesafe.ai/v1/systemone` | 変更可 |
| `model` | `jev-latest` | 変更可 |

## 7. Jev の API と費用（2026-09-22、公開情報）

- `POST https://api.typesafe.ai/v1/systemone`、Bearer キー、モデル `jev-latest`。`state`（文字列か JSON）と `questions`（名前 → Choice／Score／Noul）。Choice の `criteria` はラベル→説明文の辞書で 255 候補まで。Score は 2〜10 段階、Noul は yes の確率。返り値は質問ごとの `choice`・`probabilities`・`confidence`。複数の質問は並列に評価される。
- 上限: 1 回 64k トークン、state＋最長の質問で 32k。1,200 req/分。前払い残高制。
- 料金: $0.042/M 入力トークン、出力無料。1 判定 2,000 トークン ≈ 0.013 円（150 円/$）。月 600 判定で約 8 円、3,000 リンクの一括で約 40 円。
- 出典: OpenRouter の `typesafe/jev-1.13`、DEV Community「How to Use Jev」。正式な SDK・レスポンスの形は TypeSafe のドキュメントが正で、キー発行時に照合して差があれば本節と `client.ts`・`tests/fixtures/jev/` を直す。
- 実測（2026-09-22、LEV-163。本人のキーで 600 回）: リクエストは上のとおりで 200 が返る。**返り値は上と違い**、トップレベルが `questions` ではなく `answers`、各回答に `type`（`"choice"`）が付き、`usage` は snake_case の `input_tokens`／`output_tokens`。`{"model":"jev-1.13.0","answers":{"<質問名>":{"type":"choice","choice":"up","confidence":0.19,"probabilities":{…}}},"usage":{"input_tokens":4371,"output_tokens":1376}}`。形の記録は `tests/fixtures/jev/systemone-answers-200.json`。`scripts/jev-accuracy-judge.mjs` はこの形で読む。`src/jev/client.ts` の `parseResponseBody` は `questions`／`inputTokens` のままなので実物の応答を取りこぼす（直すのは LEV-170）。
- 実測の量（同上）: オントロジー 162 フィールドを criteria にした Q1 と 6 方向の Q2 を 1 回で聞くと、日本語の state 約 1,300 字を含めて入力 **平均 4,444 トークン**（上の見積もり 2,000 の 2.2 倍）、出力 1,375。1 判定 0.028 円で、2,448 リンクの一括は約 69 円。レイテンシは 1 回 1.4 秒。
- 呼び出しは `src/jev/client.ts` だけ。Obsidian の `requestUrl` を使う（CORS を避け、モバイルでも同じ）。

## 8. 第 2 段階: 関連候補（JEV-5、Backlog）

- 候補集め（Obsidian の信号だけ）: 返していないバックリンク、同じタグ、同じ Up を持つノート、同じフォルダ、未解決リンク。上限 20。
- Jev: 候補ごとに Score「関連の強さ」（1〜5、言葉で定義）と Choice「付けるならどのフィールド」。Score 4 以上をキューの「関連候補」列に出す。承認で `## Relations` に追記、却下は覚えて次回出さない。

## 9. 置き場所と境界（`docs/architecture.md` D9）

- `src/jev/`: `client.ts`／`state.ts`／`judge.ts`／`collect.ts`／`relations.ts`／`log.ts`／`types.ts`。UI と描画を持たない。`plugin.settings`、`app.vault`、`app.metadataCache` に触る。
- UI: `src/Components/JevQueueView.ts`（ItemView）、`src/Components/JevBulkModal.ts`、`src/Suggesters/JevLinkSuggest.ts`。`ToolsPanel` にボタン 1 つ。スタイルは `styles.css`。
- 登録: `excalibrain-main.ts` で `settings.jev.apiKey` があるときだけ view・suggest・command を登録する。
- `src/graph/` と `Scene` は jev を import しない。jev は `Scene` の描画 API を触らない。
- ネットワークは `src/jev/client.ts` に閉じる。単体テストは記録した応答（`tests/fixtures/jev/*.json`）で行い、実際の Jev は呼ばない。

## 10. 精度テスト（JEV-0、着手前）

- `scripts/jev-accuracy.mjs`（Node、プラグインの外。キーは環境変数 `JEV_API_KEY`）。指定 Vault の `field:: [[X]]`（インラインと `## Relations`）を正解にし、§2-2 の state と §2-3 の質問で Jev に聞く。
- 出す数字: フィールド一致率、方向一致率、しきい値（0.5／0.6／0.7／0.8／0.9）ごとの適合率と対象率、混同の多いフィールドの組、日本語 state のトークン数、費用の実績。500 件以上。
- 判断: 一致率 7 割以上なら計画どおり。5 割なら criteria の説明文を厚くして再測。それ以下なら JEV-4 の自動確定をやめ、サジェスターとキューだけにする。
- 記録: `artifacts/jev-accuracy/record.md`。Vault の内容と生の応答はコミットしない。

## 11. 決定と残る課題

| 論点 | 判断 |
| --- | --- |
| 置き場所 | jevbrain 本体の `src/jev/`。別プラグイン案は撤回（2026-09-22、本人） |
| 書き込み先 | `## Relations` に統一。インラインは設定で選べる |
| 既存の型 | 自動更新しない。見直しタブで手動 |
| しきい値 | 既定 0.8／0.9。JEV-0 で確定 |
| API キー | 設定（`data.json`）。README に送信内容を明記。コミュニティ登録するならネットワーク利用の開示が要る |
| BRAT | JEV-3 の後 |
| 未確認 | Jev の正式 SDK、`requestUrl` のタイムアウト挙動。レスポンスの形と日本語 state のトークン数は LEV-163 で実測し §7 に書いた（`client.ts` の読み取りは LEV-170 で直す） |
