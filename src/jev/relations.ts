import type { App, TFile } from "obsidian";
import { toHierarchyKey } from "src/utils/hierarchy";

/**
 * Vault のノートを書き換える唯一の場所（docs/jev-link-typer-design.md §3）。本文の文章は触らず、
 * `## Relations` 節に `field:: [[X]]` を 1 行足すだけにする。UI も Jev への問い合わせもここには無い。
 */

/** 書き込み方式（設計 §3、設定 `writeMode`）。既定は `## Relations` 節、`inline` は本文の `[[X]]` を `(field:: [[X]])` にする。 */
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
 * `## <heading>` 節（無ければ末尾に空行付きで作る）に `field:: [[target]]` を 1 行足す（設計 §3）。
 * 同じ相手を同じフィールドで指す行が節にあれば何もしない。`mode: "inline"` のときは本文の最初の
 * 型の付いていない `[[target]]` を `(field:: [[target]])` にする。戻り値 `null` は「変えなかった」。
 */
export const appendRelation = async (
  app: App,
  file: TFile,
  field: string,
  target: string,
  options: { heading: string; mode?: RelationWriteMode },
): Promise<RelationEdit | null> =>
  rewriteFile(app, file, (data) =>
    options.mode === "inline"
      ? writeInlineField(data, field, target)
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
): Promise<RelationEdit | null> =>
  rewriteFile(app, file, (data) => replaceField(data, oldField, newField, target));

type Rewrite = { text: string; edit: RelationEdit | null };

/** `vault.process` のコールバックは同期で新しい本文を返すだけなので、書いた場所は閉包で受け取る。 */
const rewriteFile = async (
  app: App,
  file: TFile,
  rewrite: (data: string) => Rewrite,
): Promise<RelationEdit | null> => {
  const written: { edit: RelationEdit | null } = { edit: null };
  await app.vault.process(file, (data) => {
    const result = rewrite(data);
    written.edit = result.edit;
    return result.text;
  });
  return written.edit;
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
    return { text: after, edit: { line: 0, before: "", after } };
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
      edit: { line: lines.length, before: "", after: block.join("\n") },
    };
  }

  const end = sectionEnd(note, headingIndex);
  if (lines.slice(headingIndex + 1, end).some((line) => isSameRelation(line, field, target))) {
    return { text: data, edit: null };
  }
  // 節の末尾は、次の見出し（またはファイルの末尾）の前にある空行より上。空行は残す。
  let insertAt = end;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  return {
    text: [...lines.slice(0, insertAt), relationLine, ...lines.slice(insertAt)].join(note.eol),
    edit: { line: insertAt, before: "", after: relationLine },
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

/** その行が `target` を指す `[[…]]`（別名・見出し付きを含む）を、前から順に。 */
const linksTo = (line: string, target: string): { at: number; text: string }[] => {
  const open = `[[${target}`;
  const links: { at: number; text: string }[] = [];
  for (let at = line.indexOf(open); at !== -1; at = line.indexOf(open, at + 1)) {
    const next = line.charAt(at + open.length);
    if (next !== "]" && next !== "|" && next !== "#") continue;
    const close = line.indexOf("]]", at + open.length);
    if (close !== -1) links.push({ at, text: line.slice(at, close + 2) });
  }
  return links;
};

/** `[[X]]` の直前に付いているフィールド（`up:: ` や `(up:: `）と、その名前が始まる位置。無ければ null。 */
const fieldBefore = (line: string, at: number): { name: string; start: number } | null => {
  const written = line.slice(0, at).match(/(?:^|\()(\s*)([^()]*?)\s*::\s*$/u);
  if (!written || written.index === undefined) return null;
  const paren = line.charAt(written.index) === "(" ? 1 : 0;
  return { name: written[2], start: written.index + paren + written[1].length };
};

const writeInlineField = (data: string, field: string, target: string): Rewrite => {
  const note = readNote(data);
  const { lines, usable } = note;
  for (let i = 0; i < lines.length; i++) {
    if (!usable[i]) continue;
    for (const link of linksTo(lines[i], target)) {
      if (link.at > 0 && lines[i].charAt(link.at - 1) === "!") continue; // 埋め込みは対象外（設計 §2-1）
      const written = fieldBefore(lines[i], link.at);
      if (written) {
        // 同じフィールドが既に付いていれば何もしない。別のフィールドなら見直し（replaceRelation）の仕事。
        if (toHierarchyKey(written.name) === toHierarchyKey(field)) return { text: data, edit: null };
        continue;
      }
      const before = lines[i];
      const after = `${before.slice(0, link.at)}(${field}:: ${link.text})${before.slice(link.at + link.text.length)}`;
      return { text: replaceLine(note, i, after), edit: { line: i, before, after } };
    }
  }
  return { text: data, edit: null };
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
      return { text: replaceLine(note, i, after), edit: { line: i, before, after } };
    }
  }
  return { text: data, edit: null };
};
