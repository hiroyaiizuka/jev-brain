import { Editor, MarkdownFileInfo, MarkdownView, Notice, TFile } from "obsidian";
import type ExcaliBrain from "src/excalibrain-main";
import { percentOf } from "src/jev/judge";
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

export const registerJevTypeLinkCommand = (plugin: ExcaliBrain): void => {
  // 判定は 1 回 0.1〜10 秒かかり、その間コマンドは何も出さない。押し直しを放っておくと、同じリンクに
  // 有料の問い合わせが何本も飛び、どれもまだ行の無いノートを読むので `## Relations` に同じ行が並ぶ。
  let running = false;
  plugin.addCommand({
    id: "excalibrain-jev-type-link",
    name: t("JEV_COMMAND_TYPE_LINK"),
    editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
      const file = ctx.file;
      if (!(file instanceof TFile) || file.extension !== "md") return false;
      if (checking) return true;
      if (running) {
        new Notice(t("JEV_COMMAND_BUSY"), 5000);
        return true;
      }
      running = true;
      void run(plugin, editor, file, ctx).finally(() => { running = false; });
      return true;
    },
  });
};

const run = async (
  plugin: ExcaliBrain,
  editor: Editor,
  file: TFile,
  ctx: MarkdownView | MarkdownFileInfo,
): Promise<void> => {
  try {
    if (!plugin.DVAPI) {
      new Notice(t("JEV_COMMAND_NO_DATAVIEW"), 5000);
      return;
    }
    // 判定はこのノートの `Page` の neighbours を見る（設計 §2-1）ので、JevBrain を一度も開いていない
    // Vault ではここで索引を作る。開いたあとの再構築は Scene が自分でやり直す。
    if (!plugin.pages?.has(file.path)) await plugin.createIndex();
    const message = noticeFor(await typeLinkAtCursor(
      plugin,
      {
        file,
        // エディタのバッファ。保存前の編集も `metadataCache` と同じ版で読むための本文（設計 §2-1）。
        content: editor.getValue(),
        cursor: editor.getCursor(),
      },
      // 書き込みは `vault.process`＝ファイル。書く直前にバッファを流して、次の自動保存が追記した行を
      // 巻き戻さないようにする。エディタを持たない ctx（canvas の埋め込みなど）では何もしない。
      { flush: ctx instanceof MarkdownView ? () => ctx.save() : undefined },
    ));
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

/**
 * 1 回の結果を 1 行の文言に。Jev に届かなかったときは null で、Notice は `client.ts` が出した 1 本だけにする。
 * 文言だけを組む純関数なので、テスト（tests/components/jev-type-link-command.test.ts）はここを直接呼ぶ。
 */
export const noticeFor = (result: TypeLinkResult): string | null => {
  switch (result.status) {
    case "no-index":
      return t("JEV_COMMAND_NO_INDEX");
    case "excluded":
      return t("JEV_COMMAND_EXCLUDED");
    case "no-untyped-link":
      return t("JEV_COMMAND_NO_LINK");
    case "failed":
      return null;
    case "unconfident":
      return fill(
        result.reason === "direction" ? t("JEV_COMMAND_UNCONFIDENT") : t("JEV_COMMAND_UNKNOWN_FIELD"),
        {
          target: result.target,
          answer: result.answer,
          // 全部。`judge` が確率順の上位 5 件に絞ってあるので、Notice もサジェスターとキューと同じ
          // 並びの同じ候補になる（設計 §2-3）。
          candidates: result.candidates.join(", "),
        },
      );
    case "unchanged":
      return fill(t("JEV_COMMAND_UNCHANGED"), { field: result.field, target: result.target });
    case "link-gone":
      return fill(t("JEV_COMMAND_LINK_GONE"), { field: result.field, target: result.target });
    default:
      return fill(t(result.logged ? "JEV_COMMAND_WROTE" : "JEV_COMMAND_WROTE_UNLOGGED"), {
        field: result.field,
        target: result.target,
        probability: percent(result.probability),
        // 実測は数字だけ、見積もりは "~1234"。E18 の記録に見積もりを実測として書かないための印。
        tokens: `${result.estimatedTokens ? "~" : ""}${result.inputTokens ?? 0}`,
      });
  }
};

/**
 * `{name}` を値で埋める。ノートの名前は Vault のもので `$&` や `$'` が入りうるが、`replace` の置換
 * 文字列はそれを展開してしまう（`$'` は残り全部に化ける）ので、関数で返して素通しにする。
 */
const fill = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, () => value), template);

/** 確率のパーセント表記。応答がその候補の確率を返さなかったときは「?」。 */
const percent = (probability?: number): string =>
  typeof probability === "number" ? `${percentOf(probability)}` : "?";
