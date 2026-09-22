import type { App, TFile } from "obsidian";
import { toHierarchyKey } from "src/utils/hierarchy";

/**
 * Vault のノートを書き換える唯一の場所（docs/jev-link-typer-design.md §3）。既定は入口が指した
 * 本文のリンクにフィールドを付けることで、設定 `writeMode: relations` を選んだときだけ
 * `## Relations` 節に 1 行足す。UI も Jev への問い合わせもここには無い。
 */

/** 書き込み方式（設計 §3、設定 `writeMode`）。既定の `inline` は本文のリンクに付け、`relations` は節に足す。 */
export type RelationWriteMode = "relations" | "inline";

/**
 * 書いた場所。`log.ts` の記録の `line`・`before`・`after` にそのまま渡す。
 *
 * `line` は 0 始まりの行番号、`after` はそのとき書いた塊（見出しごと作ったときは複数行を改行で連結）、
 * `before` は同じ場所にもとからあった塊で、空文字は「行が無かった」＝取り消しでは行ごと消すことを表す。
 * 記録の中の改行は常に `\n` で、ノート自身の改行（CRLF もありうる）とは分けて扱う。
 */
export type RelationEdit = {
  line: number;
  before: string;
  after: string;
};

/**
 * 何も書かなかった理由（設計 §3）。`already-typed` はその行・その出現に既にフィールドがある、
 * `not-found` は入口が指したリンクがその位置に無い（判定を待つ間に動いた・消えた）。
 * 呼び出し側は Notice の文言をこれで分ける。
 */
export type RelationSkip = { skipped: "already-typed" | "not-found" };

export type RelationResult = RelationEdit | RelationSkip;

/** 書いたのか、書かなかったのか。 */
export const isRelationEdit = (result: RelationResult): result is RelationEdit => !("skipped" in result);

/**
 * 入口が指した出現。0 始まりの行番号と、リンクの `[` の桁。
 *
 * `wiki` はそれが `[[…]]` かどうか。false（markdown リンク `[B](notes/B.md)`）なら本文は触らず
 * `## <heading>` 節に落とす（設計 §3）。どちらかは入口が知っているのでここでは調べ直さない:
 * 位置がずれたときに、たまたま重なった無関係な markdown リンクを相手と取り違えないため。
 */
export type LinkPosition = { line: number; ch: number; wiki: boolean };

export type AppendRelationOptions = {
  /** `relations` のときに書き足す節の見出し（設定 `relationsHeading`）。 */
  heading: string;
  mode?: RelationWriteMode;
  /**
   * 書き換える出現（コマンドのカーソル、サジェスターの閉じた `]]`、キューのカードが持つ位置）。
   * `inline` のときだけ意味を持つ。渡さない呼び出し（カーソルを持たない JEV-4 の一括）は
   * 今までどおり最初の型の付いていない出現を書き換える。
   */
  at?: LinkPosition;
};

/**
 * `target` へのリンクにフィールドを付ける（設計 §3）。既定の `inline` は入口が指した本文の出現に
 * 付け、`relations` は `## <heading>` 節（無ければ末尾に空行付きで作る）に `field:: [[target]]` を
 * 1 行足す。同じ相手が本文に 2 つあっても、指された出現以外は触らない。
 */
export const appendRelation = async (
  app: App,
  file: TFile,
  field: string,
  target: string,
  options: AppendRelationOptions,
): Promise<RelationResult> =>
  rewriteFile(app, file, (data) =>
    options.mode === "inline"
      ? writeInlineField(data, field, target, options)
      : appendToSection(data, field, target, options.heading),
  );

/**
 * 見直しの確定（設計 §3・§5）。`oldField` で `target` を指している行、または本文の
 * `(oldField:: [[target]])` のフィールド名だけを `newField` に替える。リンクの書き方（別名・見出し）と
 * 字下げ・前後の文字はそのまま残す。
 */
export const replaceRelation = async (
  app: App,
  file: TFile,
  oldField: string,
  newField: string,
  target: string,
): Promise<RelationResult> =>
  rewriteFile(app, file, (data) => replaceField(data, oldField, newField, target));

type Rewrite = { text: string; result: RelationResult };

/** 本文はそのままで、何も書かなかった。 */
const unchanged = (data: string, skipped: RelationSkip["skipped"]): Rewrite => ({ text: data, result: { skipped } });

/** `vault.process` のコールバックは同期で新しい本文を返すだけなので、書いた場所は閉包で受け取る。 */
const rewriteFile = async (
  app: App,
  file: TFile,
  rewrite: (data: string) => Rewrite,
): Promise<RelationResult> => {
  const written: { result: RelationResult } = { result: { skipped: "not-found" } };
  await app.vault.process(file, (data) => {
    const outcome = rewrite(data);
    written.result = outcome.result;
    return outcome.text;
  });
  return written.result;
};

/** 行に分けたノート。`usable` が false の行は frontmatter かコードブロックの中で、見出しもリンクも見ない。 */
type Note = {
  lines: string[];
  /** ノート自身の改行。Windows で書かれたノートに LF を混ぜないよう、書き戻すときはこれで連結する。 */
  eol: string;
  usable: boolean[];
};

const readNote = (data: string): Note => {
  const lines = data.split(/\r?\n/u);
  const usable = lines.map(() => true);
  let i = 0;
  if (lines[0].trim() === "---") {
    const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (close !== -1) for (; i <= close; i++) usable[i] = false;
  }
  let fenced = false;
  for (; i < lines.length; i++) {
    if (/^\s*(?:```|~~~)/u.test(lines[i])) {
      fenced = !fenced;
      usable[i] = false;
      continue;
    }
    usable[i] = !fenced;
  }
  return { lines, eol: data.includes("\r\n") ? "\r\n" : "\n", usable };
};

const replaceLine = (note: Note, index: number, line: string): string =>
  [...note.lines.slice(0, index), line, ...note.lines.slice(index + 1)].join(note.eol);

const appendToSection = (data: string, field: string, target: string, heading: string): Rewrite => {
  const relationLine = `${field}:: [[${target}]]`;
  const headingLine = `## ${heading}`;
  if (data === "") {
    const after = `${headingLine}\n${relationLine}`;
    return { text: after, result: { line: 0, before: "", after } };
  }

  const note = readNote(data);
  const { lines, usable } = note;
  const headingIndex = lines.findIndex((line, index) => usable[index] && line.trim() === headingLine);
  if (headingIndex === -1) {
    const block = lines[lines.length - 1].trim() === ""
      ? [headingLine, relationLine]
      : ["", headingLine, relationLine];
    return {
      text: [...lines, ...block].join(note.eol),
      result: { line: lines.length, before: "", after: block.join("\n") },
    };
  }

  const end = sectionEnd(note, headingIndex);
  if (lines.slice(headingIndex + 1, end).some((line) => isSameRelation(line, field, target))) {
    return unchanged(data, "already-typed");
  }
  // 節の末尾は、次の見出し（またはファイルの末尾）の前にある空行より上。空行は残す。
  let insertAt = end;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  return {
    text: [...lines.slice(0, insertAt), relationLine, ...lines.slice(insertAt)].join(note.eol),
    result: { line: insertAt, before: "", after: relationLine },
  };
};

/** 見出しの下の範囲の終わり（次の見出しの行。無ければファイルの末尾）。 */
const sectionEnd = (note: Note, headingIndex: number): number => {
  for (let i = headingIndex + 1; i < note.lines.length; i++) {
    if (note.usable[i] && /^#{1,6}\s/u.test(note.lines[i])) return i;
  }
  return note.lines.length;
};

/** その行が、同じフィールド（Dataview のキーとして）で同じ相手を指しているか。書き方の違いは見ない。 */
const isSameRelation = (line: string, field: string, target: string): boolean => {
  const written = line.match(/^\s*([^:[\]]+?)\s*::\s*(.+)$/u);
  if (!written || toHierarchyKey(written[1]) !== toHierarchyKey(field)) return false;
  const link = written[2].match(/\[\[([^\]|#]+)/u);
  return link !== null && link[1].trim() === target.trim();
};

/** 行の中の 1 つの `[[…]]`: `[` の桁と、書かれているとおりのリンク全体。 */
type Link = { at: number; text: string };

/** `[[X]]` の直前に付いているフィールド（`up:: ` や `(up:: `）と、その名前が始まる位置。無ければ null。 */
const fieldBefore = (line: string, at: number): { name: string; start: number } | null => {
  const written = line.slice(0, at).match(/(?:^|\()(\s*)([^()]*?)\s*::\s*$/u);
  if (!written || written.index === undefined) return null;
  const paren = line.charAt(written.index) === "(" ? 1 : 0;
  return { name: written[2], start: written.index + paren + written[1].length };
};

/** 行の中の `[[…]]`（入れ子の `[`・`]` は許さない。`typeLink.ts` の `writtenLinkAt` と同じ読み方）。 */
const WIKI_LINK = /(!?)\[\[[^[\]]+?\]\]/gu;

/**
 * 見出しの行（`## …`）。ここにフィールドを書くと見出しの文言が変わり、その見出しを指す
 * `[[Note#見出し]]` が Vault のどこかで壊れる。インラインの相手にはせず、節に落とす。
 */
const HEADING_LINE = /^#{1,6}\s/u;

/** `[[X|別名]]`・`[[X#見出し]]` の X。前後の空白は詰める（本文が `[[ X ]]` でも同じ相手）。 */
const linkpathOf = (text: string): string => text.slice(2, -2).split("|")[0].split("#")[0].trim();

/**
 * その行が `target` を指す `[[…]]`（別名・見出し付きを含む）を、前から順に。
 * 埋め込み `![[…]]` は型を付ける相手ではないので外す（設計 §2-1）。
 */
const linksTo = (line: string, target: string): Link[] =>
  Array.from(line.matchAll(WIKI_LINK))
    .filter((match) => match[1] !== "!")
    .map((match): Link => ({ at: match.index + match[1].length, text: match[0].slice(match[1].length) }))
    .filter((link) => linkpathOf(link.text) === target.trim());

/**
 * 入口が指した出現（LEV-185）。渡ってくる `ch` はリンクの `[` の桁だが、リンクの中を指していても
 * 同じ出現として扱う。隣り合う 2 つの境目では `[` の一致を先に見るので、どちらか一方に決まる。
 *
 * その桁に無ければ、同じ行にその相手の型の付いていない出現がちょうど 1 つあるときだけそれを使う。
 * 判定を待つ間に同じ行の前のほうが伸びること（同じ行の別のリンクに型が付く、文字を足す）は
 * ふつうに起きるので、行の中で 1 つに決まるなら拾う。2 つ以上あるなら、どれを指していたのか
 * 分からないので何もしない（同じ相手が 2 つある本文でこそ位置が要る）。
 */
const pointedLink = (line: string, target: string, ch: number): Link | undefined => {
  const links = linksTo(line, target);
  const pointed = links.find((link) => link.at === ch)
    ?? links.find((link) => ch > link.at && ch < link.at + link.text.length);
  if (pointed) return pointed;
  const untyped = links.filter((link) => !fieldBefore(line, link.at));
  return untyped.length === 1 ? untyped[0] : undefined;
};

/** 行頭の字下げとリスト記号（`-`／`*`／`+`／`1.`／`1)`）だけでできた前置き。 */
const LIST_PREFIX = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?$/u;

/**
 * 行頭（字下げとリスト記号を除く）から行末までがそのリンク 1 つだけか（設計 §3、本人の決定
 * 2026-09-22）。そういう行は括弧を付けずに `field:: [[X]]` と書く。
 */
const isWholeLine = (line: string, link: Link): boolean =>
  LIST_PREFIX.test(line.slice(0, link.at)) && line.slice(link.at + link.text.length).trim() === "";

/** その出現にフィールドを付けた行。字下げ・リスト記号・前後の文字はそのまま残す。 */
const typedLine = (line: string, link: Link, field: string): string => {
  const written = isWholeLine(line, link) ? `${field}:: ${link.text}` : `(${field}:: ${link.text})`;
  return `${line.slice(0, link.at)}${written}${line.slice(link.at + link.text.length)}`;
};

/**
 * 本文のリンクにフィールドを付ける（設計 §3）。`at` があるときはその出現だけを見て、そこに
 * `[[target]]` が無ければ何もしない。入口が markdown リンクを指していた（`at.wiki` が false）ときは
 * 本文を触らず節に落とす。
 */
const writeInlineField = (
  data: string,
  field: string,
  target: string,
  options: AppendRelationOptions,
): Rewrite => {
  const { at } = options;
  if (!at) return typeFirstLink(readNote(data), data, field, target);
  // markdown リンクの中にフィールドは書けない（設計 §3）。本文は触らず節に 1 行足す。
  if (!at.wiki) return appendToSection(data, field, target, options.heading);

  const note = readNote(data);
  const line = note.usable[at.line] ? note.lines[at.line] : undefined;
  if (line === undefined) return unchanged(data, "not-found");
  if (HEADING_LINE.test(line)) return appendToSection(data, field, target, options.heading);
  const link = pointedLink(line, target, at.ch);
  if (!link) return unchanged(data, "not-found");
  // 既にフィールドが付いている出現は、同じものでも別のものでも付け替え（replaceRelation）の仕事。
  if (fieldBefore(line, link.at)) return unchanged(data, "already-typed");
  const after = typedLine(line, link, field);
  return { text: replaceLine(note, at.line, after), result: { line: at.line, before: line, after } };
};

/** 位置を渡さない呼び出し（カーソルを持たない JEV-4 の一括）。最初の型の付いていない出現に付ける。 */
const typeFirstLink = (note: Note, data: string, field: string, target: string): Rewrite => {
  const { lines, usable } = note;
  for (let i = 0; i < lines.length; i++) {
    if (!usable[i] || HEADING_LINE.test(lines[i])) continue;
    for (const link of linksTo(lines[i], target)) {
      const written = fieldBefore(lines[i], link.at);
      if (written) {
        // 同じフィールドが既に付いていれば何もしない。別のフィールドなら見直しの仕事なので、次の出現へ。
        if (toHierarchyKey(written.name) === toHierarchyKey(field)) return unchanged(data, "already-typed");
        continue;
      }
      const after = typedLine(lines[i], link, field);
      return { text: replaceLine(note, i, after), result: { line: i, before: lines[i], after } };
    }
  }
  return unchanged(data, "not-found");
};

const replaceField = (data: string, oldField: string, newField: string, target: string): Rewrite => {
  const note = readNote(data);
  const { lines, usable } = note;
  for (let i = 0; i < lines.length; i++) {
    if (!usable[i]) continue;
    for (const link of linksTo(lines[i], target)) {
      const written = fieldBefore(lines[i], link.at);
      if (!written || toHierarchyKey(written.name) !== toHierarchyKey(oldField)) continue;
      const before = lines[i];
      const after = `${before.slice(0, written.start)}${newField}:: ${link.text}${before.slice(link.at + link.text.length)}`;
      return { text: replaceLine(note, i, after), result: { line: i, before, after } };
    }
  }
  return unchanged(data, "not-found");
};
