import { Editor, MarkdownFileInfo, MarkdownView, Notice, TFile } from "obsidian";
import type ExcaliBrain from "src/excalibrain-main";
import { typeLinkAtCursor, type TypeLinkResult } from "src/jev/typeLink";
import { t } from "src/lang/helpers";
import { errorlog } from "src/utils/utils";

/**
 * コマンド「Jev: カーソルのリンクに型を付ける（第一候補で確定）」（docs/jev-link-typer-design.md §4-1、
 * 受入条件は docs/product-plan.md §3「JEV-1」の E18）。通しの中身は `src/jev/typeLink.ts` にあり、
 * ここはエディタから本文とカーソルを取り、結果を Notice 1 本にするだけ。
 *
 * 登録は `excalibrain-main.ts` の `registerJev()` から。キーと有効化が揃わない Vault では呼ばれない。
 */

/** 自信なしのときに名前を並べる候補の数。全部並べると Notice が読めなくなる。 */
const CANDIDATES_SHOWN = 3;

export const registerJevTypeLinkCommand = (plugin: ExcaliBrain): void => {
  plugin.addCommand({
    id: "excalibrain-jev-type-link",
    name: t("JEV_COMMAND_TYPE_LINK"),
    editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
      const file = ctx.file;
      if (!(file instanceof TFile) || file.extension !== "md") return false;
      if (checking) return true;
      void run(plugin, editor, file);
      return true;
    },
  });
};

const run = async (plugin: ExcaliBrain, editor: Editor, file: TFile): Promise<void> => {
  try {
    if (!plugin.DVAPI) {
      new Notice(t("JEV_COMMAND_NO_DATAVIEW"), 5000);
      return;
    }
    // 判定はこのノートの `Page` の neighbours を見る（設計 §2-1）ので、JevBrain を一度も開いていない
    // Vault ではここで索引を作る。開いたあとの再構築は Scene が自分でやり直す。
    if (!plugin.pages?.has(file.path)) await plugin.createIndex();
    const message = notice(await typeLinkAtCursor(plugin, {
      file,
      // エディタのバッファ。保存前の編集も `metadataCache` と同じ版で読むための本文（設計 §2-1）。
      content: editor.getValue(),
      cursor: editor.getCursor(),
    }));
    if (message) new Notice(message, 8000);
  } catch (error) {
    errorlog({
      fn: "registerJevTypeLinkCommand",
      where: "src/Components/JevTypeLinkCommand.ts",
      message: error instanceof Error ? error.message : "the command failed",
    });
    new Notice(t("JEV_COMMAND_ERROR"), 5000);
  }
};

/** 1 回の結果を 1 行の文言に。Jev に届かなかったときは null で、Notice は `client.ts` が出した 1 本だけにする。 */
const notice = (result: TypeLinkResult): string | null => {
  switch (result.status) {
    case "no-index":
      return t("JEV_COMMAND_NO_INDEX");
    case "no-untyped-link":
      return t("JEV_COMMAND_NO_LINK");
    case "failed":
      return null;
    case "unconfident":
      return t("JEV_COMMAND_UNCONFIDENT")
        .replace("{target}", result.target)
        .replace("{candidates}", result.candidates.slice(0, CANDIDATES_SHOWN).join(", "));
    case "unchanged":
      return t("JEV_COMMAND_UNCHANGED")
        .replace("{field}", result.field)
        .replace("{target}", result.target);
    default:
      return t(result.logged ? "JEV_COMMAND_WROTE" : "JEV_COMMAND_WROTE_UNLOGGED")
        .replace("{field}", result.field)
        .replace("{target}", result.target)
        .replace("{probability}", percent(result.probability))
        .replace("{tokens}", String(result.inputTokens ?? 0));
  }
};

/** 確率のパーセント表記。応答がその候補の確率を返さなかったときは「?」。 */
const percent = (probability?: number): string =>
  typeof probability === "number" ? `${Math.round(probability * 100)}` : "?";
