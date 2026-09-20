# jev-brain ロードマップ

更新日: 2026-09-20。受入条件の正本は `docs/product-plan.md`、各設計は下の表のリンク先。進捗は Linear（Project 作成後）。

## 順序と依存

```text
H0 ハーネス ──┬── ONT-1 Up/Down 領域（2D の色）──── 3D-1 固定視点トグル ──┬── 3D-2 視点と設定 ── 3D-3 実測と重なり
              │                                                          ├── R1 ベータ配布（BRAT）
              │                                                          └── H1 引き継ぎコードの整地
              └── JEV-1 別プラグイン（Jev の API 待ち。フォークとは独立）
```

| 順 | フェーズ | 何ができるようになるか | 設計 | 状態 |
| --- | --- | --- | --- | --- |
| 0 | H0 ハーネス | `npm run check`、test-vault、CI、docs。エージェントと人が同じ条件で検証できる | `docs/harness.md` | 完了（実機 E01〜E11 は未実施） |
| 1 | ONT-1 Up/Down 領域 | 設定に Up（抽象）／Down（具体）の領域。入れたフィールドの関係は 2D で専用の色になる | `docs/ontology-axis-design.md` | 未着手 |
| 2 | 3D-1 固定視点トグル | ツールパネルの 3D で、Up の親が上、Down の子が下、由来の親は地面に出る。柱・影・地面。起動時は 2D | `docs/3d-design.md` | 未着手（フェーズ 0 調査は完了） |
| 3 | R1 ベータ配布 | tag → GitHub Release → BRAT。本人と数名が日常で使う | `docs/harness.md`「リリース手順」 | 未着手（plugin ID の決定が要る） |
| 3 | 3D-2 視点と設定 | ヨー角の切り替え、高さ・潰し率・柱・地面の設定 | `docs/3d-design.md` §5 | 未着手 |
| 4 | 3D-3 実測と重なり | 親 20・子 30 での要素数・描画時間と重なりの追加対策 | 同上 | 未着手 |
| 4 | H1 整地 | strict 化、lint ベースラインの解消、設定画面の見出し | `docs/harness.md`「lint のベースライン」 | 未着手（3D-1 の merge 後） |
| 任意 | JEV-1 別プラグイン | `[[X]]` の上でホットキー → Jev がフィールドを順位付け → `(field:: [[X]])` | `docs/jev-link-typer-design.md` | 未着手（Jev の API・キー・リポジトリ名待ち） |

## Linear への写し方（案）

- Team LEV、Project「jev-brain」（Linear 側で作成。`orca linear` は Project を作れない）。
- 親 issue はフェーズごと（H0 / ONT-1 / 3D-1 / R1 / 3D-2 / 3D-3 / H1 / JEV-1）と「Ideas: 将来候補」。親は誰にも渡さない。
- 子 issue は受入条件 1 件ずつ。最初に切るのは ONT-1 と 3D-1 の子だけ。運用は `docs/linear-workflow.md`。

## やらないこと

- WebGL などの本物の 3D、ドラッグでの滑らかな回転。
- インデックス作成や関係判定の変更（ONT-1 は領域を足すだけで判定の仕組みは変えない）。
- フォーク本体からの外部 API 呼び出し（Jev は別プラグイン）。
- モバイルでの 3D。
