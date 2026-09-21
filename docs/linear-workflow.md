# Linear 起票と Orca での進め方

更新日: 2026-09-22

Mappy の運用（`projects/Mappy/docs/linear-workflow.md`）をそのまま使う。要件と受入条件の正本は `product-plan.md`、検証手順の正本は `harness.md`、証跡は `artifacts/`。Linear は進捗と担当の正本であり、受入条件を Linear 側で書き換えない。

Linear を読み書きするのはエージェントだけである。本人は Linear の UI を使わず、Orca の worktree 一覧・コメントとチャットで進捗を見る。状態・優先度・親子関係の変更、Project への紐づけはすべて `orca linear` で行う。

Linear は Team LEV の Project「Jevbrain」（2026-09-20 に本人が作成）。`docs/roadmap.md` のフェーズごとに親 issue を切り、子 issue は受入条件 1 件ずつ。依存は Linear の blocks 関係で表す。

| フェーズ | 親 issue | 子 issue（2026-09-20 起票） |
| --- | --- | --- |
| H0 ハーネス整備 | LEV-96 | LEV-105（実機 E01〜E11、needs-human） |
| ONT-1 Up／Down 領域 | LEV-97 | LEV-106（型・読み込み・純関数）→ LEV-107（関係判定とリンクスタイル）→ LEV-108（設定画面・モーダル・サジェスター）→ LEV-109（実機、needs-human） |
| 3D-1 固定視点の 3D トグル | LEV-98 | LEV-110（Projection.ts）・LEV-111（Layout の分割）は今すぐ → LEV-112（Scene の分岐）→ LEV-113（ゲート選び直し）・LEV-114（トグル）→ LEV-115（実機、needs-human） |
| R1 ベータ配布 | LEV-99 | plugin ID の決定後 |
| 3D-2 視点と設定 | LEV-100 | 3D-1 の実機確認後 |
| 3D-3 実測と重なり | LEV-101 | 同上 |
| H1 整地 | LEV-102 | 3D-1 の merge 後 |
| JEV-0 精度テスト | LEV-157 | LEV-162（正解の抽出）→ LEV-163（Jev 判定と集計。本人のキーが要る）→ LEV-164（しきい値の決定、needs-human） |
| JEV-1 判定の中核 | LEV-103 | LEV-165（設定と登録の分岐。`Settings.ts`・`excalibrain-main.ts` はこの子だけ）→ LEV-166（client）・LEV-167（state と judge）・LEV-168（collect）・LEV-169（relations と log）は並行可 → LEV-170（実機 E18、needs-human） |
| JEV-2 エディタのサジェスター | LEV-158 | LEV-171（`]]` 直後の EditorSuggest）→ LEV-172（ホットキー、付け替え）→ LEV-173（実機 E19、needs-human）。JEV-1 の後 |
| JEV-3 型付け待ちキュー | LEV-159 | LEV-174（JevQueueView）→ LEV-175（ツールパネルのボタンと styles.css）→ LEV-176（実機 E20、needs-human）。JEV-1 の後、JEV-2 と並行可 |
| JEV-4 一括確定と見直し | LEV-160 | LEV-177（範囲と費用のモーダル）→ LEV-178（しきい値で自動確定、一括取り消し）→ LEV-179（見直しタブ）→ LEV-180（実機 E21、needs-human）。JEV-3 と JEV-0 の後 |
| JEV-5 関連候補 | LEV-161 | LEV-181（Backlog）。JEV-4 の後 |
| Ideas | LEV-104 | 区分 idea の子だけ |

## 正本の分担

| 内容 | 正本 | 更新のしかた |
| --- | --- | --- |
| 受入条件・段階 | `docs/product-plan.md` | PR で更新する。チケット完了時に「現在の実装」の該当行を同じ PR で直す |
| 検証手順・実機ケース | `docs/harness.md` | 同上 |
| 進捗・優先度・担当 | Linear | `orca linear` |
| 実行条件・結果・証跡 | `artifacts/` | ワーカーが PR に要点を転記する |

## チケットの構造

- 親 issue はフェーズ（`docs/roadmap.md` の H0 / ONT-1 / 3D-1 / R1 / 3D-2 / 3D-3 / H1 / JEV-0〜JEV-5）と「Ideas: 将来候補」。親自体は誰にも渡さない。
- 子 issue は `product-plan.md` の受入条件 1 件、または lint ベースラインのルール群 1 つ。Orca に渡すのは子だけ。
- 作業中に見つけた範囲外の不具合は `orca linear create --parent-current` で子として戻す。

## 状態と区分

状態（Backlog / Todo / In Progress / In Review / Done）と区分（`agent-ready` / `needs-human` / `verification` / `idea`）は Mappy と同じ。Excalidraw と Dataview を入れた実機での確認を含むものは `needs-human`。

## 子 issue のテンプレート

```
区分: agent-ready | needs-human | verification

## 目的
（1〜2行）

## 受入条件
product-plan.md §3 <フェーズ> より: （該当文を引用。書き換えない）

## 参照
- docs: product-plan.md §3 <フェーズ>、harness.md <E-番号 または ベースラインの行>
- src: 対象の層（main / graph / scene / components / shared）
- artifacts: 既存の証跡があれば

## 検証手順・再現ケース
（修正なら再現ケースを先に用意する）

## 完了の定義
- `npm run check` 合格
- lint ベースラインを触った場合は eslint.config.mjs の該当行を消し、harness.md の表を更新する
- 実機を要する場合は `artifacts/` に実行条件・結果・証跡を残す。未実施項目は明記する
- product-plan.md の「現在の実装」の該当行を同じ PR で更新する
- `src/` を変更した PR は `/code-review <PR番号> high` を実行し、指摘を直すか見送り理由を PR 本文に書く
- PR リンクを `orca linear attach`、完了コメント1本、In Review へ
```

## Orca への渡し方

1チケット＝1 worktree＝1エージェント。

```sh
orca worktree create --name jev-<番号>-<短い名前> --linear-issue <ISSUE-ID> \
  --agent claude --no-parent \
  --prompt "orca linear issue --current --full --json でチケットを読み、AGENTS.md と docs/linear-workflow.md に従って進める。完了フローは orca-linear スキルに従う。プライマリー（projects/Jev-brain）には触らず、この worktree だけで作業する"
```

ワーカーの手順は Mappy と同じ: チケットを読む → 受入条件とケースを確認 → 実装・検証・`npm run check` → 証跡 → product-plan 更新 → `/visual-pr` の形式で PR → `src/` 変更なら `/code-review <PR番号> high` → `orca linear attach`・完了コメント・In Review。

同時に走らせる worktree は層で分け、`src/excalibrain-main.ts` と `src/Settings.ts` を複数が触らないようにする。Obsidian 実機は 1 台なので、実機を使うチケットは同時に 1 本にする。Jev を実際に呼ぶチケット（LEV-163・170・173・176・180）は本人の API キーが要り、キーは worktree の外（環境変数 `JEV_API_KEY`、または検証用 Vault の `data.json`）に置いて PR・コメント・証跡に写さない。
