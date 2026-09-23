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
  // LEV-191: 既定の criteria（docs/jev-link-typer-design.md §2-4）と、既定で無効のしきい値。
  JEV_CANDIDATE_MIN_USES_NAME: "候補にするフィールドの最小使用回数",
  JEV_CANDIDATE_MIN_USES_DESC: "Vault でこの回数以上使われているフィールドだけから Jev に選ばせます。第一候補が当たりやすくなります。<b>使用回数がこれ未満のフィールドは提案されません</b>。オントロジーに足したばかりのフィールドも、この回数使われるまでは候補に出ません。0 にするとオントロジーの全フィールドを候補にします。この回数に届くフィールドが 1 つも無いときも全フィールドを候補にします。回数は索引から数え、索引を作り直したときに数え直します。",
  // しきい値の「0 で使わない」（JEV_THRESHOLD_OFF）は en の説明文の後ろに付くので、説明文と揃えて en のまま。
};
