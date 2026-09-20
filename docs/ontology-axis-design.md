# Up／Down 領域（抽象と具体の軸）：設計

更新日: 2026-09-20。本人の方針（2026-09-20）: 既存の Parents / Children / Left / Right / Previous / Next と並ぶ領域として **Up（抽象）** と **Down（具体）** を設定に足す。そこに入れたオントロジーのフィールドは、2D では専用の色で描かれ、3D では高さになる。既定値で決め打ちしない。

## 1. 振る舞い

| 領域 | 2D での位置 | 2D でのリンク | 3D での高さ |
| --- | --- | --- | --- |
| Up（抽象） | 親と同じ北 | 領域のスタイル（既定: 緑・太さ 4.5、`upLinkStyle`）。フィールド別スタイルがあればそれが優先 | +1 |
| Down（具体） | 子と同じ南 | 領域のスタイル（既定: 緑・太さ 4.5、`downLinkStyle`） | −1 |
| Parents / Children | 今のまま | 今のまま | 0（由来の親は地面） |
| 左右・前後の友 | 今のまま | 今のまま | 0 |

- 1 つのフィールドは 1 つの領域にだけ入る（今の Parents／Children と同じ排他）。Up と Parents の両方に書かれていたら Up が勝つ。
- 推論リンク（フィールド無し）、フォルダ・タグ・URL・未解決リンクは領域を持たない → 0。
- 「Ontology に追加」モーダルとサジェスターの選択肢に Up／Down を足す。
- 名前は暫定。設定画面の表示は「Up (abstract)」「Down (concrete)」、内部キーは `up` / `down`（既存のフィールド名 `up` `down` と紛れるので、コード上は `hierarchy.abstract` / `hierarchy.concrete` にする）。本人が決める。

## 2. 当たり所（ソース確認済み）

| ファイル | 変更 |
| --- | --- |
| `src/Types.ts` `Hierarchy` | `abstract: string[]`、`concrete: string[]` を追加 |
| `src/constants/constants.ts` `DEFAULT_HIERARCHY_DEFINITION` | 両方とも空配列。既存ユーザーの設定は変えない |
| `src/excalibrain-main.ts` `loadSettings` 付近（`hierarchyLowerCase` の組み立て、`masterHierarchyList` の排他） | `abstract` / `concrete` を **parents / children より先** に処理し、重複は後の領域から落とす（Up が勝つ）。未定義なら空配列で移行 |
| `src/graph/Page.ts` `addDVFieldLinksToPage` | `hierarchyLowerCase.abstract` を親のループと同じ処理、`concrete` を子のループと同じ処理に通す（関係の判定は変えず、`item.field` がそのまま定義名として残る） |
| `src/graph/Link.ts` コンストラクタ | スタイルの重ね順を base → inferred → **領域（up/down）** → フィールド別 にする。領域の判定は `hierarchyDefinition` のフィールドが `plugin.hierarchyLowerCase.abstract / concrete` に入るか |
| `src/Settings.ts` | Ontology 節に text area を 2 つ（Parents の前）、`assigned` の集合（1388 行付近）と demo link の役割判定（321／356 行付近）に領域を追加。Link style 節に `upLinkStyle` / `downLinkStyle` |
| `src/Components/AddToOntologyModal.ts` `Ontology` enum | `Up = "up"`、`Down = "down"` を追加。追加／削除の分岐を 2 つ足す |
| `src/Suggesters/OntologySuggester.ts` | 全フィールド一覧に `abstract` / `concrete` を含める。専用トリガーは任意 |
| `src/lang/locale/en.ts` | `UP_NAME` / `DOWN_NAME` / `UP_LINK_STYLE` / `DOWN_LINK_STYLE` など。他の 23 言語は `t()` が en にフォールバックするので必須ではない |
| `src/graph/Projection.ts`（3D-1） | `levelOf(typeDefinition)` がこの領域を見る（`docs/3d-design.md` §3-1） |

`Neighbour.typeDefinition`（カンマ区切りのフィールド名）は今のまま Scene と Link に渡るので、3D 側は追加の配線なしに領域を引ける。

## 3. 既存ユーザーの移行

- 新しい領域は空で始まる。本人は設定画面で `up, part of, subtopic of, instance of, member of` を Parents から Up へ、`down, next level detail, example, examples, illustrates` を Children から Down へ移す（Up 側に書けば Parents 側の重複は起動時に落ちる）。
- フィールド別に付けていた緑の `hierarchyLinkStyles` は残しても動く（フィールド別が領域より優先）。領域のスタイルに寄せるなら、フィールド別を消す。

## 4. 受入条件（ONT-1）

- 設定画面の Ontology 節に Up (abstract) と Down (concrete) の text area があり、保存・再起動後も残る。
- Up に入れたフィールドの関係は北に、Down は南に、2D で今までどおりの位置に出る。フィールド別スタイルが無いとき、リンクは領域のスタイル（既定: 緑・太さ 4.5）で描かれる。
- 「Ontology に追加」モーダルとサジェスターで Up／Down を選べる。
- Up と Parents の両方に同じフィールドを書いたとき、Up として扱われ、Parents 側から消える。
- 既存の設定（Up／Down が無い data.json）を読み込んでも今までどおり動く（回帰なし。実機 E01〜E05）。
- `Link` のスタイル重ね順と `hierarchyLowerCase` の排他に Vitest の単体テストがある（plugin スタブで）。
