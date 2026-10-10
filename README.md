# JevBrain

Obsidian のノートどうしのつながりを、そのまま編集できるグラフで見るプラグインです。抽象（Up）と具体（Down）の軸、立体風の 3D 表示、Jev によるリンクの型付けを持ちます。

> ベータ版（0.0.x）です。BRAT で入れて試す段階で、コミュニティプラグインには未登録です。

## できること

- **グラフ表示**: 開いているノートを中心に、親・子・友・前後のノートを Excalidraw の図面に並べます。ノードをクリックすると中心が移り、戻る／進むで履歴をたどれます。
- **Up／Down 領域**: 設定の Ontology に「Up（抽象）」「Down（具体）」のフィールドを登録すると、その関係は北（Up）と南（Down）に出て、緑の太い線になります。
- **3D 表示**: ツールパネルのボタンで、Up を上・Down を下に置いた立体風の表示に切り替わります。起動時は常に 2D です（デスクトップのみ）。
- **Jev でリンクに型を付ける**: 型の付いていない `[[リンク]]` に、Jev が `up::` や `down::` などのフィールドを提案します。入口は 3 つあります。
  - コマンド「Jev: カーソルのリンクに型を付ける」
  - `]]` を閉じた直後やホットキーで出る候補の一覧
  - ツールパネルの Jev ボタンで開く「型付け待ち」の一覧

## 必要なもの

- Obsidian 1.8.7 以上
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) と [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin)（どちらも有効にしておく）
- Jev を使う場合は Jev の API キー

## インストール（BRAT）

1. コミュニティプラグインから [BRAT](https://github.com/TfTHacker/obsidian42-brat) を入れて有効にする。
2. 設定 → BRAT →「Add beta plugin」に `hiroyaiizuka/jev-brain` を入れ、最新の版を選んで追加する。
3. コミュニティプラグインの一覧で JevBrain を有効にする。
4. コマンドパレットで「JevBrain Normal」を実行する。Vault の直下に図面ファイル `jevbrain.md` ができ、グラフが開きます（場所は設定で変えられます）。

## Jev について（外部への送信）

- API キーが空のあいだは、Jev の機能は何も登録されません。
- 判定のたびに、リンクの前後の文とノートの frontmatter を Jev（`api.typesafe.ai`）に送ります。送信先はここだけです。
- ノートを書き換えるのは、候補を確定したときだけです。書き込みは `jev-log.json` に記録され、取り消せます。

## いまの状態と既知の課題

- 実機で確認済み: グラフ表示、Up／Down 領域、3D 表示、Jev のコマンド。
- 実機で未確認: 候補の一覧（`]]` のあと）、型付け待ちの一覧。
- 箇条書きの行に書いた `- down:: [[X]]` は Dataview がページのフィールドとして読まないため、グラフでは型の無いリンクのまま出ます（LEV-193）。設定で書き込み先を `## Relations` 節にすると避けられます。
- モバイルでの動作は未確認です。3D と型付け待ちの一覧はモバイルを対象にしていません。
- 本家 ExcaliBrain と同じ Vault に入れたときの動作は未確認です（plugin ID と既定の図面ファイルは別です）。

## 開発

- 規約: `AGENTS.md`（`CLAUDE.md` から参照）。要件は `docs/product-plan.md`、設計は `docs/architecture.md`、検証は `docs/harness.md`、チケットは `docs/linear-workflow.md`。
- 準備: Node は `.nvmrc`（22.22.3）。`npm ci` のあと `npm run check`（validate → lint → test → build → package）。任意で `npm run hooks:install`。
- 開発中: `npm run dev`（esbuild watch、ルートに `main.js`）。実機は `npm run harness:prepare` で作る `test-vault/` に Dataview と Excalidraw を入れて `npm run harness:preflight`。
- リリース: `npm version x.y.z` → タグ push → GitHub Actions が Release に配布物を添付（`docs/harness.md`「リリース手順」）。
- 元にしたコードの技術仕様: `EXCALIBRAIN_DETAILED_SPECIFICATION.md`。

## クレジットとライセンス

JevBrain は Zsolt Viczián さんの [ExcaliBrain](https://github.com/zsviczian/excalibrain)（0.2.18）をもとにしています。グラフ表示の大部分は ExcaliBrain のコードです。ライセンスは MIT（`LICENSE`）。
