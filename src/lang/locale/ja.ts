// 日本語

export default {
  // Jev のコマンド（docs/jev-link-typer-design.md §4-1、docs/harness.md E18）。ほかの文言は en に落ちる。
  JEV_COMMAND_TYPE_LINK: "Jev: カーソルのリンクに型を付ける（第一候補で確定）",
  JEV_COMMAND_NO_DATAVIEW: "Jev はノートのフィールドを読むのに Dataview が要ります。",
  JEV_COMMAND_NO_INDEX: "このノートはまだ索引にありません。少し待つか、除外パスを確かめてください。",
  JEV_COMMAND_NO_LINK: "まだ型の付いていないリンクにカーソルを置いてください。",
  JEV_COMMAND_UNCONFIDENT: "[[{target}]] は自信なし（フィールドと方向が食い違いました）。候補: {candidates}。何も書いていません。",
  JEV_COMMAND_UNCHANGED: "{field}:: [[{target}]] はこのノートに既にあります。何も書いていません。",
  JEV_COMMAND_WROTE: "Jev が {field}:: [[{target}]] を書きました（{probability}%、{tokens} トークン）。",
  JEV_COMMAND_WROTE_UNLOGGED: "Jev が {field}:: [[{target}]] を書きました（{probability}%、{tokens} トークン）が、記録できませんでした: この行は Jev では取り消せません。",
  JEV_COMMAND_ERROR: "Jev のコマンドが失敗しました。開発者コンソールを見てください。",
};
