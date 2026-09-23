import { TFile } from "obsidian";
import type ExcaliBrain from "src/excalibrain-main";
import { normalizeRelationsHeading } from "src/Settings";
import { errorlog } from "src/utils/utils";
import { DEFAULT_JEV_TIMEOUT_MS, askJev, type JevQuestion, type JevRequest } from "./client";
import { collectUntypedLinks } from "./collect";
import { pluginCriteria } from "./criteria";
import { buildQuestions, judge, type Questions } from "./judge";
import { appendLogEntry } from "./log";
import { appendRelation, isRelationEdit } from "./relations";
import { buildState } from "./state";

/**
 * 1 リンクの通し（docs/jev-link-typer-design.md §2〜§3）: カーソルのリンクを取り、未型付けか確かめ、
 * state と 2 問を組んで Jev に聞き、整合したらそのリンクにフィールドを付けて記録する。
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

export type TypeLinkDeps = {
  /** Jev の呼び出し。既定は `client.ts` の `askJev` で、テストだけがここを差し替える。 */
  ask?: typeof askJev;
  /**
   * 書く直前にエディタのバッファをファイルへ流す（`MarkdownView.save()`）。読むのはバッファ、書くのは
   * `vault.process`＝ファイルなので、揃えないと次の自動保存で追記した行が消える。判定を待つ間ではなく
   * 書く直前に呼ぶので、取りこぼす窓はミリ秒で済む。エディタが無い呼び出し（テスト）では何もしない。
   */
  flush?: () => Promise<void>;
};

export type TypeLinkResult =
  /** インデックスがまだ無い（このノートの `Page` が取れない）。 */
  | { status: "no-index" }
  /** カーソルの位置に未型付けのリンクが無い（リンクが無い・埋め込み・既に型が付いている・除外）。 */
  | { status: "no-untyped-link" }
  /** このノート自身が除外パスか図面ファイル（設定 `excludeFilepaths`・`excalibrainFilepath`）。 */
  | { status: "excluded" }
  /** Jev に届かなかった。Notice は `client.ts` が既に 1 回出している。 */
  | { status: "failed" }
  /**
   * `judge` が自信なしとしたとき（設計 §2-3）。候補は自信ありと同じ確率順の上位 5 件で、何も書かない。
   * `reason` は Q1 と Q2 の食い違い（`direction`）か、Q1 の答えがオントロジーに無い語（`unknown-field`）。
   */
  | { status: "unconfident"; reason: "direction" | "unknown-field"; target: string; answer: string; candidates: string[] }
  /** そのリンクに既にフィールドが付いていた（`relations` なら同じ行が既にあった）。 */
  | { status: "unchanged"; field: string; target: string }
  /** カーソルが指した出現がその位置に無かった（判定を待つ間に本文が動いた・消えた）。 */
  | { status: "link-gone"; field: string; target: string }
  | {
      status: "written";
      field: string;
      target: string;
      /** Q1 の第一候補の確率。応答がその候補の確率を返さなければ undefined。 */
      probability?: number;
      /** 費用の記録（E18）用の入力トークン。 */
      inputTokens?: number;
      /** その数字が応答の実測ではなく `client.ts` の見積もりか。記録に実測として残さないための印。 */
      estimatedTokens?: boolean;
      /** `jev-log.json` に記録できたか。false のときは取り消せない。 */
      logged: boolean;
    };

/**
 * カーソルのリンクに型を付ける。書くのはカーソルが指した本文のリンク 1 つだけ（設定 `writeMode` が
 * `relations` なら `## Relations` の 1 行だけ）で、同じ相手が本文に 2 つあっても他は触らない。
 * 描画は Obsidian の `metadataCache` の更新に任せる（設計 §3）。
 */
export const typeLinkAtCursor = async (
  plugin: ExcaliBrain,
  request: TypeLinkRequest,
  deps: TypeLinkDeps = {},
): Promise<TypeLinkResult> => {
  const { app, settings } = plugin;
  const { file, content, cursor } = request;
  // `collect` は除外パスと図面ファイルを「リンクの相手」としてだけ落とす（collect.ts）。書き込む先は
  // このノート自身なので、同じ除外をこちら側にも掛ける。図面ファイルは JevBrain の生成物でもある。
  if (file.path === settings.excalibrainFilepath) return { status: "excluded" };
  if (settings.excludeFilepaths.some((path) => file.path.startsWith(path))) return { status: "excluded" };
  const page = plugin.pages?.get(file.path);
  if (!page) return { status: "no-index" };

  const written = writtenLinkAt(content.split("\n")[cursor.line] ?? "", cursor.ch);
  if (!written) return { status: "no-untyped-link" };
  // 本文の書き方（`[[X|別名]]`・`[[X#見出し]]`・markdown リンク）と、`collect` が使う鍵（解決したパス）は
  // 別物。未型付けかどうかは解決したパスで確かめる。
  const targetFile = app.metadataCache.getFirstLinkpathDest(written.linkpath, file.path);
  const target = targetFile?.path ?? written.linkpath;
  if (!collectUntypedLinks(app, page, file, content).some((link) => link.target === target)) {
    return { status: "no-untyped-link" };
  }
  // 聞くのも書くのも本文のとおりの `X`。ただし markdown リンクの相手は相対パス（`../notes/B.md`）が
  // ありうるので、`[[…]]` に入れて意味が変わらない解決後のパスを使う。
  const name = written.wiki ? written.linkpath : targetFile?.path ?? written.linkpath;

  const state = buildState({
    note: { frontmatter: app.metadataCache.getFileCache(file)?.frontmatter, text: content },
    link: { target: name, offset: offsetOf(content, cursor.line, written.start), length: written.length },
    // ファイルの無い未解決リンクは名前だけを送る（設計 §2-2）。
    targetNote: targetFile instanceof TFile
      ? {
          frontmatter: app.metadataCache.getFileCache(targetFile)?.frontmatter,
          text: await app.vault.cachedRead(targetFile),
        }
      : null,
    contextChars: settings.jev.contextChars,
  });

  const response = await (deps.ask ?? askJev)(
    {
      apiKey: settings.jev.apiKey,
      endpoint: settings.jev.endpoint,
      model: settings.jev.model,
      timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
    },
    { state, questions: toRequestQuestions(buildQuestions(settings.hierarchy, pluginCriteria(plugin))) },
  );
  if (!response) return { status: "failed" };

  const judgement = judge(response, settings.hierarchy);
  // `judge` の `field` は Jev の答えそのままなので、書くのは設定に書いてある綴り（`judge` が
  // オントロジーの中で解決した `chosen`）。応答が "Up" と返しても Vault には `up::` が入る。
  // 出す候補（`ordered`）は上位 5 件に絞ってあるので、書く綴りをそこから探してはいけない。
  const chosen = judgement.chosen;
  if (!judgement.confident) {
    return {
      status: "unconfident",
      // オントロジーに無い語が返ったときは方向の食い違いではない（judge.ts の `confident` は両方を
      // まとめて false にする）。E18 で原因を取り違えないよう分ける。
      reason: chosen ? "direction" : "unknown-field",
      target: name,
      answer: judgement.field,
      candidates: judgement.ordered.map((candidate) => candidate.field),
    };
  }
  // confident は「Q1 の答えがオントロジーの領域に在る」ことを含む（judge.ts）ので chosen は必ずある。
  const field = chosen?.field ?? judgement.field;

  await deps.flush?.();
  const outcome = await appendRelation(app, file, field, name, {
    // 設定タブを開いたまま見出しを打ち替えている最中は `## Notes` のような値が入っているので、
    // 節を作る側と同じ正規化を通す（`normalizeSettings` はタブを閉じたときにしか走らない）。
    heading: normalizeRelationsHeading(settings.jev.relationsHeading),
    mode: settings.jev.writeMode,
    // 書き換えるのはカーソルが指したその出現だけ（設計 §3、LEV-185）。markdown リンクは
    // その中にフィールドを書けないので、`relations.ts` が節に落とす。
    at: { line: cursor.line, ch: written.start, wiki: written.wiki },
  });
  if (!isRelationEdit(outcome)) {
    return { status: outcome.skipped === "not-found" ? "link-gone" : "unchanged", field, target: name };
  }

  return {
    status: "written",
    field,
    target: name,
    probability: chosen?.probability,
    inputTokens: response.usage?.inputTokens,
    estimatedTokens: response.usage?.estimated,
    // 書いたあとに記録だけ落ちても、行は入っている。取り消せないことだけを呼び出し側に伝える。
    logged: await logEdit(plugin, file.path, outcome),
  };
};

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
    errorlog({
      fn: "typeLinkAtCursor",
      where: "src/jev/typeLink.ts",
      message: error instanceof Error ? error.message : "could not write jev-log.json",
    });
    return false;
  }
};

/** `[[X]]`・`[[X|別名]]`・`[[X#見出し]]`・`[ラベル](X)` と、その埋め込み（`!` 付き）を行の中の順に。 */
const LINK = /(!?)\[\[([^\][]+?)\]\]|(!?)\[([^\][]*)\]\(([^()\s]+)\)/gu;

type WrittenLink = {
  /** 行の中の位置と長さ（リンク全体）。 */
  start: number;
  length: number;
  /** リンクの相手を本文が書いているとおりに（別名と `#見出し` を落としたもの）。 */
  linkpath: string;
  /** `[[…]]` で書かれているか。markdown リンクは相手が相対パスのことがあるので書き戻しに使えない。 */
  wiki: boolean;
};

/**
 * カーソルが乗っているリンク。乗っていなければ null。埋め込み（`![[X]]`・`![ラベル](X)`）は型を付ける
 * 相手ではない（設計 §2-1）。相手の読み取りは `collect.ts` の `linkpathOf` と同じ（markdown の percent 符号は
 * 戻し、空白は落とさない）で、両方が同じ鍵に解決するようにしてある。
 * 両端を含むので、`]]` の直後に置いたカーソルもそのリンクを指す。隣り合う 2 つの境目では先の（＝いま閉じた）
 * リンクを取る。
 */
const writtenLinkAt = (line: string, ch: number): WrittenLink | null => {
  for (const match of line.matchAll(LINK)) {
    const [original, wikiEmbed, wiki, markdownEmbed, , markdown] = match;
    const start = match.index;
    if (ch < start || ch > start + original.length) continue;
    if (wikiEmbed === "!" || markdownEmbed === "!") return null;
    const linkpath = wiki === undefined ? decodeLinkpath(markdown) : wiki.split("|")[0];
    const withoutHeading = linkpath.split("#")[0];
    return withoutHeading.trim() === ""
      ? null
      : { start, length: original.length, linkpath: withoutHeading, wiki: wiki !== undefined };
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
