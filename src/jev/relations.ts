import type { App, TFile } from "obsidian";

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
 */
export type RelationEdit = {
  line: number;
  before: string;
  after: string;
};

/**
 * `## <heading>` 節（無ければ末尾に空行付きで作る）に `field:: [[target]]` を 1 行足す（設計 §3）。
 * 同じ行が節にあれば何もしない。`mode: "inline"` のときは本文の最初の素の `[[target]]` を
 * `(field:: [[target]])` にする。戻り値 `null` は「変えなかった」。
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
 * 見直しの確定（設計 §3・§5）。`oldField:: [[target]]` の行、または本文の `(oldField:: [[target]])` を
 * `newField` に置き換える。どちらの形で書かれているかは見つけた場所に合わせる。
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

const relationLineOf = (field: string, target: string): string => `${field}:: [[${target}]]`;

const inlineFieldOf = (field: string, target: string): string => `(${field}:: [[${target}]])`;

const appendToSection = (data: string, field: string, target: string, heading: string): Rewrite => {
  const relationLine = relationLineOf(field, target);
  const headingLine = `## ${heading}`;
  if (data.trim() === "") {
    const after = `${headingLine}\n${relationLine}`;
    return { text: after, edit: { line: 0, before: "", after } };
  }

  const lines = data.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === headingLine);
  if (headingIndex === -1) {
    const block = lines[lines.length - 1].trim() === ""
      ? [headingLine, relationLine]
      : ["", headingLine, relationLine];
    return {
      text: [...lines, ...block].join("\n"),
      edit: { line: lines.length, before: "", after: block.join("\n") },
    };
  }

  const end = sectionEnd(lines, headingIndex);
  if (lines.slice(headingIndex + 1, end).some((line) => line.trim() === relationLine)) {
    return { text: data, edit: null };
  }
  // 節の末尾は、次の見出し（またはファイルの末尾）の前にある空行より上。空行は残す。
  let insertAt = end;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  return {
    text: [...lines.slice(0, insertAt), relationLine, ...lines.slice(insertAt)].join("\n"),
    edit: { line: insertAt, before: "", after: relationLine },
  };
};

/** 見出しの下の範囲の終わり（次の見出しの行。無ければファイルの末尾）。 */
const sectionEnd = (lines: string[], headingIndex: number): number => {
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/u.test(lines[i])) return i;
  }
  return lines.length;
};

/** 素の `[[X]]` の直前が `field:: ` か `(field:: ` なら、その `[[X]]` は既に型が付いている。 */
const ALREADY_TYPED = /(?:^|\()[^()]*::\s*$/u;

const writeInlineField = (data: string, field: string, target: string): Rewrite => {
  const inlineField = inlineFieldOf(field, target);
  if (data.includes(inlineField)) return { text: data, edit: null };

  const link = `[[${target}]]`;
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (let at = lines[i].indexOf(link); at !== -1; at = lines[i].indexOf(link, at + link.length)) {
      if (ALREADY_TYPED.test(lines[i].slice(0, at))) continue;
      const before = lines[i];
      const after = `${before.slice(0, at)}${inlineField}${before.slice(at + link.length)}`;
      return {
        text: [...lines.slice(0, i), after, ...lines.slice(i + 1)].join("\n"),
        edit: { line: i, before, after },
      };
    }
  }
  return { text: data, edit: null };
};

const replaceField = (data: string, oldField: string, newField: string, target: string): Rewrite => {
  const oldLine = relationLineOf(oldField, target);
  const oldInline = inlineFieldOf(oldField, target);
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const before = lines[i];
    let after: string | null = null;
    if (before.trim() === oldLine) after = relationLineOf(newField, target);
    else if (before.includes(oldInline)) after = before.replace(oldInline, inlineFieldOf(newField, target));
    if (after === null) continue;
    return {
      text: [...lines.slice(0, i), after, ...lines.slice(i + 1)].join("\n"),
      edit: { line: i, before, after },
    };
  }
  return { text: data, edit: null };
};
