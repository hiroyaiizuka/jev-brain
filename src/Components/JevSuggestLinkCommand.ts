import { Editor, MarkdownFileInfo, MarkdownView, Notice, TFile } from "obsidian";
import type ExcaliBrain from "src/excalibrain-main";
import type { JevLinkSuggest, OpenAtResult } from "src/Suggesters/JevLinkSuggest";
import { t } from "src/lang/helpers";
import { fill } from "src/lang/jev";

/**
 * コマンド「Jev: カーソルのリンクに型を付ける（候補から選ぶ）」（LEV-172、docs/jev-link-typer-design.md §4-1、
 * 受入条件は docs/product-plan.md §3「JEV-2」）。カーソル上の `[[X]]` に `]]` の直後と同じ候補を出し、
 * 型付きなら今のフィールドを先頭にした付け替え候補にする。中身は {@link JevLinkSuggest.openAt} にあり、
 * ここは開けなかったときの Notice 1 本だけ。
 *
 * 既定のホットキーは付けない（Obsidian の慣例。本人が設定のホットキーで割り当てる）。
 * 登録は `excalibrain-main.ts` の `registerJev()` から。
 */
export const registerJevSuggestLinkCommand = (plugin: ExcaliBrain, suggest: JevLinkSuggest): void => {
  plugin.addCommand({
    id: "excalibrain-jev-suggest-link",
    name: t("JEV_SUGGEST_COMMAND"),
    editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
      const file = ctx.file;
      if (!(file instanceof TFile) || file.extension !== "md") return false;
      if (checking) return true;
      const message = suggestNoticeFor(suggest.openAt(editor, file));
      if (message) new Notice(message, 5000);
      return true;
    },
  });
};

/** 開けなかった理由を 1 行に。開けたときは null（ポップアップが答え）。 */
export const suggestNoticeFor = (result: OpenAtResult): string | null => {
  switch (result.status) {
    case "opened":
      return null;
    case "inactive":
      return t("JEV_SUGGEST_INACTIVE");
    case "no-dataview":
      return t("JEV_COMMAND_NO_DATAVIEW");
    case "excluded":
      return t("JEV_COMMAND_EXCLUDED");
    case "no-link":
      return t("JEV_SUGGEST_NO_LINK");
    case "typed-elsewhere":
      return fill(t("JEV_SUGGEST_TYPED_ELSEWHERE"), { target: result.target });
    case "hidden":
      return fill(t("JEV_SUGGEST_HIDDEN"), { target: result.target });
    case "other-field":
      return fill(t("JEV_SUGGEST_OTHER_FIELD"), { target: result.target, field: result.field });
    case "typed-outside-body":
      return fill(t("JEV_SUGGEST_OUTSIDE_BODY"), { target: result.target, field: result.field });
  }
};
