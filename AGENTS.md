# jev-brain 開発ハーネス

- 英語で考え、日本語で報告する。
- 製品要件は `docs/product-plan.md`、設計判断は `docs/architecture.md`（上流の仕様は `EXCALIBRAIN_DETAILED_SPECIFICATION.md`）、順序は `docs/roadmap.md`、Up／Down 領域は `docs/ontology-axis-design.md`、3D は `docs/3d-design.md`（経緯は `docs/3d-brief.md`）、Jev 連携は `docs/jev-link-typer-design.md`、検証手順は `docs/harness.md`、チケット運用は `docs/linear-workflow.md`。
- 実装前に受入条件を確認する。修正時は対象の再現ケースを先に用意する。
- 完了前に `npm run check` を実行する。失敗を無効化や広範な lint 抑制で回避しない。`eslint.config.mjs` の「引き継ぎ時のベースライン」は上流コードの既知の指摘をファイル単位で止めているだけで、新しいファイルや触ったファイルで増やさない。直したファイルはベースラインから外す。
- UI・描画・インデックス更新・設定を変更した場合は専用テスト Vault（Dataview と Excalidraw を有効化した `test-vault/`）で実機確認し、実行条件・結果・証跡を `artifacts/` に残す。未実施なら明記する。モックの成功を実機の成功と呼ばない。
- `src/excalibrain-main.ts` は登録・ライフサイクル・外部プラグインとの接続に限定。`src/graph/` はインデックスと関係の判定、`src/Scene.ts`・`src/Components/` は Excalidraw 上の描画と操作。graph 層に描画 API を持ち込まない。
- 上流は zsviczian/excalibrain（MIT）。上流の挙動を変える変更は `docs/architecture.md` の判断記録に理由を書く。ユーザーの Vault のノートを書き換えるのは Ontology への追加など明示的な操作だけ。
- Dataview と Excalidraw の API は `src/utils/ExternalPluginTypes.ts` と `src/utils/ExcalidrawAutomateCompatibility.ts` の型を通して使い、`any` を広げない。
- Jev との通信は `src/jev/client.ts` だけ。`src/jev/` は収集・判定・書き込みで UI を持たず、UI は `src/Components/Jev*`・`src/Suggesters/Jev*`。graph 層と `Scene` は jev を import しない。API キーが空なら Jev の機能を登録しない。単体テストは記録した応答（`tests/fixtures/jev/`）で行い、実際の Jev を呼ばない。キー、Vault の内容、生の応答はコミットしない（`docs/jev-link-typer-design.md` §9・§10）。
- runtime はブラウザ互換。Node/Electron や個人パスを持ち込まない。`isDesktopOnly: false` を維持し、デスクトップ専用の分岐は `ea.DEVICE.isDesktop` で守る。
- ランタイム依存を追加する前に、必要性・バンドル増分・モバイル互換性を記録する。`styles.css` が唯一のスタイル正本で、`src/styles/style.scss` はビルドに使わない。
- 本番 Vault をテスト対象にしない。自動準備はプロジェクト配下の `test-vault/` のみ。
- プライマリー（`projects/Jev-brain` のチェックアウト）は常に `main` に置く。ブランチ作業は `orca worktree create` で作った worktree で行い、プライマリーで `git checkout -b`／`git switch` を実行しない。
- `main.js`、`node_modules/`、`dist/`、`test-vault/`、証跡をコミットしない。plugin ID は `jevbrain`、名前は JevBrain、作者は Hiroya Iizuka（本人の決定、2026-09-21）。ID が違うので上流版（`excalibrain`）と別プラグインとして入る（実機での同時インストールは未確認。既定の図面ファイルがどちらも `excalibrain.md` なので、並べて使うには片方の設定を変える）。command ID・CSS クラス・設定のキー・既定の図面ファイル・`APPNAME` の "ExcaliBrain" は上流との diff を小さく保つため変えない。

現在はフォーク直後（上流 0.2.18 ＋ code scanner fixes）。配布は未公開で、リリース手順は用意済みだが未実行。実装の存在と受入条件の達成は分けて扱い、実機テストの完成を先取りして報告しない。
