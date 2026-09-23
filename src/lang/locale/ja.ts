// 日本語

export default {
  // Jev のコマンド（docs/jev-link-typer-design.md §4-1、docs/harness.md E18）。ほかの文言は en に落ちる。
  JEV_COMMAND_TYPE_LINK: "Jev: カーソルのリンクに型を付ける（第一候補で確定）",
  JEV_COMMAND_NO_DATAVIEW: "Jev はノートのフィールドを読むのに Dataview が要ります。",
  JEV_COMMAND_NO_INDEX: "このノートはまだ索引にありません。少し待つか、除外パスを確かめてください。",
  JEV_COMMAND_NO_LINK: "まだ型の付いていないリンクにカーソルを置いてください。",
  JEV_COMMAND_EXCLUDED: "このノートはグラフの対象外（除外パス、または図面ファイル自身）なので Jev は書き込みません。",
  JEV_COMMAND_BUSY: "Jev が前のリンクを判定中です。答えを待ってください。",
  JEV_COMMAND_UNCONFIDENT: "[[{target}]] は自信なし（フィールドと方向が食い違いました）。候補: {candidates}。何も書いていません。",
  JEV_COMMAND_UNKNOWN_FIELD: "Jev は [[{target}]] に「{answer}」と答えましたが、オントロジーに無いフィールドです。何も書いていません。",
  JEV_COMMAND_UNCHANGED: "{field}:: [[{target}]] は書いていません: そのリンクには既にフィールドが付いています。",
  JEV_COMMAND_LINK_GONE: "{field}:: [[{target}]] は書いていません: カーソルのあった位置にリンクがありません。もう一度カーソルを置いてください。",
  JEV_COMMAND_WROTE: "Jev が {field}:: [[{target}]] を書きました（{probability}%、{tokens} トークン）。",
  JEV_COMMAND_WROTE_UNLOGGED: "Jev が {field}:: [[{target}]] を書きました（{probability}%、{tokens} トークン）が、記録できませんでした: この行は Jev では取り消せません。",
  JEV_COMMAND_ERROR: "Jev のコマンドが失敗しました。開発者コンソールを見てください。",
  // LEV-172: カーソルのリンクに候補を出すコマンド（docs/jev-link-typer-design.md §4-1）。
  JEV_SUGGEST_COMMAND: "Jev: カーソルのリンクに型を付ける（候補から選ぶ）",
  JEV_SUGGEST_INACTIVE: "Jev が無効か、API キーがありません。変えたあとはプラグインを再読み込みしてください。",
  JEV_SUGGEST_NO_LINK: "本文の [[リンク]] にカーソルを置いてください。",
  JEV_SUGGEST_TYPED_ELSEWHERE: "[[{target}]] は相手のノートのフィールドが型を付けています。このノートに付け替える行はありません。",
  JEV_SUGGEST_HIDDEN: "[[{target}]] は hidden のフィールドで結ばれているので、Jev は触りません。",
};
