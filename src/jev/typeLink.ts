import { TFile } from "obsidian";
import type ExcaliBrain from "src/excalibrain-main";
import { toHierarchyKey } from "src/utils/hierarchy";
import { DEFAULT_JEV_TIMEOUT_MS, askJev, type JevQuestion, type JevRequest } from "./client";
import { collectUntypedLinks } from "./collect";
import { buildQuestions, judge, type Questions } from "./judge";
import { appendLogEntry } from "./log";
import { appendRelation } from "./relations";
import { buildState } from "./state";

/**
 * 1 リンクの通し（docs/jev-link-typer-design.md §2〜§3）: カーソルのリンクを取り、未型付けか確かめ、
 * state と 2 問を組んで Jev に聞き、整合したら `## Relations` に 1 行足して記録する。
 *
 * ここには Notice も Obsidian の UI も無い。何が起きたかは {@link TypeLinkResult} で返し、文言は
 * `src/Components/JevTypeLinkCommand.ts` が付ける。中核（collect／state／judge／relations／log）は
 * どれもそのまま呼ぶだけで、この層は順番と受け渡しだけを持つ。
 */

/** `jev-log.json` の `source`。サジェスター（JEV-2）とキュー（JEV-3）は自分の名前で書く。 */
export const TYPE_LINK_SOURCE = "command";

export type TypeLinkRequest = {
  file: TFile;
  /** `metadataCache` が読んだのと同じ版のノート本文（エディタのバッファ）。 */
  content: string;
  /** 0 始まりの行と桁。 */
  cursor: { line: number; ch: number };
};

/** Jev の呼び出し。既定は `client.ts` の `askJev` で、テストだけがここを差し替える。 */
export type TypeLinkDeps = { ask: typeof askJev };

export type TypeLinkResult =
  /** インデックスがまだ無い（このノートの `Page` が取れない）。 */
  | { status: "no-index" }
  /** カーソルの位置に未型付けのリンクが無い（リンクが無い・埋め込み・既に型が付いている・除外）。 */
  | { status: "no-untyped-link" }
  /** Jev に届かなかった。Notice は `client.ts` が既に 1 回出している。 */
  | { status: "failed" }
  /** Q1 と Q2 が食い違った（設計 §2-3）。確率は伏せ、候補は設定の順。何も書かない。 */
  | { status: "unconfident"; target: string; candidates: string[] }
  /** 同じ行が既にあった（`appendRelation` が何も変えなかった）。 */
  | { status: "unchanged"; field: string; target: string }
  | {
      status: "written";
      field: string;
      target: string;
      /** Q1 の第一候補の確率。応答がその候補の確率を返さなければ undefined。 */
      probability?: number;
      /** 費用の記録（E18）用。応答に無ければ `client.ts` の見積もり。 */
      inputTokens?: number;
      /** `jev-log.json` に記録できたか。false のときは取り消せない。 */
      logged: boolean;
    };

/**
 * カーソルのリンクに型を付ける。書くのは `## Relations`（設定 `writeMode` が `inline` なら本文）の 1 行だけで、
 * 本文の `[[X]]` は触らない。描画は Obsidian の `metadataCache` の更新に任せる（設計 §3）。
 */
export const typeLinkAtCursor = async (
  plugin: ExcaliBrain,
  request: TypeLinkRequest,
  deps: TypeLinkDeps = { ask: askJev },
): Promise<TypeLinkResult> => {
  const { app, settings } = plugin;
  const { file, content, cursor } = request;
  const page = plugin.pages?.get(file.path);
  if (!page) return { status: "no-index" };

  const written = writtenLinkAt(content.split("\n")[cursor.line] ?? "", cursor.ch);
  if (!written) return { status: "no-untyped-link" };
  // 本文の書き方（`[[X|別名]]`・`[[X#見出し]]`・markdown リンク）と、`collect` が使う鍵（解決したパス）は
  // 別物。聞くのと書くのは本文のとおりの `X` で、未型付けかどうかだけを解決したパスで確かめる。
  const target = app.metadataCache.getFirstLinkpathDest(written.linkpath, file.path)?.path ?? written.linkpath;
  const untyped = collectUntypedLinks(app, page, file, content).find((link) => link.target === target);
  if (!untyped) return { status: "no-untyped-link" };

  const targetFile = app.vault.getAbstractFileByPath(target);
  const state = buildState({
    note: { frontmatter: app.metadataCache.getFileCache(file)?.frontmatter, text: content },
    link: {
      target: written.linkpath,
      offset: offsetOf(content, cursor.line, written.start),
      length: written.length,
    },
    targetNote: targetFile instanceof TFile
      ? {
          frontmatter: app.metadataCache.getFileCache(targetFile)?.frontmatter,
          text: await app.vault.cachedRead(targetFile),
        }
      : null,
    contextChars: settings.jev.contextChars,
  });

  const response = await deps.ask(
    {
      apiKey: settings.jev.apiKey,
      endpoint: settings.jev.endpoint,
      model: settings.jev.model,
      timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
    },
    { state, questions: toRequestQuestions(buildQuestions(settings.hierarchy)) },
  );
  if (!response) return { status: "failed" };

  const judgement = judge(response, settings.hierarchy);
  if (!judgement.confident) {
    return {
      status: "unconfident",
      target: written.linkpath,
      candidates: judgement.ordered.map((candidate) => candidate.field),
    };
  }

  const edit = await appendRelation(app, file, judgement.field, written.linkpath, {
    heading: settings.jev.relationsHeading,
    mode: settings.jev.writeMode,
  });
  if (!edit) return { status: "unchanged", field: judgement.field, target: written.linkpath };

  return {
    status: "written",
    field: judgement.field,
    target: written.linkpath,
    probability: probabilityOfChoice(judgement.ordered, judgement.field),
    inputTokens: response.usage?.inputTokens,
    // 書いたあとに記録だけ落ちても、行は入っている。取り消せないことだけを呼び出し側に伝える。
    logged: await logEdit(plugin, file.path, edit),
  };
};

/** Q1 の答えの確率。`judge` が並べた候補から引く（応答のキーの大文字小文字と空白は問わない）。 */
const probabilityOfChoice = (
  ordered: { field: string; probability?: number }[],
  field: string,
): number | undefined =>
  ordered.find((candidate) => toHierarchyKey(candidate.field) === toHierarchyKey(field))?.probability;

/** `judge.ts` の 2 問を `client.ts` が送る形にする。どちらの側も相手の形を知らずに済むよう、変換はここだけ。 */
const toRequestQuestions = (questions: Questions): JevRequest["questions"] =>
  Object.fromEntries(
    Object.entries(questions).map(([name, choice]): [string, JevQuestion] => [
      name,
      { kind: "choice", instructions: choice.question, criteria: choice.criteria },
    ]),
  );

/** 記録は `manifest.dir` の下に書く。書けなくても行は入っているので、投げずに false を返す。 */
const logEdit = async (
  plugin: ExcaliBrain,
  path: string,
  edit: { line: number; before: string; after: string },
): Promise<boolean> => {
  if (!plugin.manifest.dir) return false;
  try {
    await appendLogEntry(plugin.app, plugin.manifest.dir, {
      // コマンドは 1 行ずつなので、一括（JEV-4）と違って束ねる相手がいない。記録の形は同じにしておく。
      batchId: `${TYPE_LINK_SOURCE}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      file: path,
      line: edit.line,
      before: edit.before,
      after: edit.after,
      source: TYPE_LINK_SOURCE,
    });
    return true;
  } catch (error) {
    console.warn({
      plugin: "ExcaliBrain",
      fn: "typeLinkAtCursor",
      where: "src/jev/typeLink.ts",
      message: error instanceof Error ? error.message : "could not write jev-log.json",
    });
    return false;
  }
};

/** `[[X]]`・`[[X|別名]]`・`[[X#見出し]]`・`![[X]]`・`[ラベル](X)` を、行の中の順に。 */
const LINK = /(!?)\[\[([^\][]+?)\]\]|\[([^\][]*)\]\(([^()\s]+)\)/gu;

type WrittenLink = {
  /** 行の中の位置と長さ（`[[` から `]]` まで）。 */
  start: number;
  length: number;
  /** リンクの相手を本文が書いているとおりに（別名と `#見出し` を落としたもの）。 */
  linkpath: string;
};

/**
 * カーソルが乗っているリンク。乗っていなければ null。埋め込み `![[X]]` は型を付ける相手ではない（設計 §2-1）。
 * markdown リンクの percent 符号は `collect.ts` の `linkpathOf` と同じく戻す。
 */
const writtenLinkAt = (line: string, ch: number): WrittenLink | null => {
  for (const match of line.matchAll(LINK)) {
    const [original, embed, wiki, , markdown] = match;
    const start = match.index;
    if (ch < start || ch > start + original.length) continue;
    if (embed === "!") return null;
    const linkpath = wiki === undefined ? decodeLinkpath(markdown) : wiki.split("|")[0];
    const withoutHeading = linkpath.split("#")[0].trim();
    return withoutHeading === "" ? null : { start, length: original.length, linkpath: withoutHeading };
  }
  return null;
};

const decodeLinkpath = (linkpath: string): string => {
  try {
    return decodeURIComponent(linkpath);
  } catch {
    return linkpath;
  }
};

/** 行と桁を本文の先頭からの文字数に。改行が CRLF でも `\r` は行の一部として数えられる。 */
const offsetOf = (content: string, line: number, ch: number): number => {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + ch;
};
