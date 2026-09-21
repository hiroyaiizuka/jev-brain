import { Notice, TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";

/**
 * 書き込みの記録と取り消し（docs/jev-link-typer-design.md §3）。記録はプラグインのデータフォルダの
 * `jev-log.json`（`data.json` とは別ファイル）に足していく。取り消すのは、書いたときの行がそのまま
 * 残っているものだけで、手で変わっていれば残して Notice を出す。
 */

/**
 * 1 回の書き込み。`line` は 0 始まりの行番号、`after` はそのとき書いた塊（複数行なら改行で連結）、
 * `before` は同じ場所にもとからあった塊で、空文字は「行が無かった」＝取り消しで行ごと消すことを表す。
 * `source` は書いた入口（サジェスター・キュー・一括）、`batchId` は一括の単位。
 */
export type JevLogEntry = {
  id: string;
  batchId: string;
  file: string;
  line: number;
  before: string;
  after: string;
  at: string;
  source: string;
};

export type JevLogInput = Omit<JevLogEntry, "id" | "at">;

export type JevUndoOutcome = "undone" | "line-changed" | "file-missing" | "not-found";

export type JevUndoBatchResult = { undone: number; skipped: number };

const LOG_FILE = "jev-log.json";

/** 1 件足して、付けた `id` と `at` を返す。`manifestDir` はプラグインのデータフォルダ（`manifest.dir`）。 */
export const appendLogEntry = async (
  app: App,
  manifestDir: string,
  input: JevLogInput,
): Promise<JevLogEntry> => {
  const entry: JevLogEntry = {
    ...input,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  };
  await queued(async () => {
    const entries = await readLog(app, manifestDir);
    await writeLog(app, manifestDir, [...entries, entry]);
  });
  return entry;
};

/** 1 行の取り消し。戻せたら記録から消す。戻せなければ記録もノートもそのままで Notice を出す。 */
export const undo = async (app: App, manifestDir: string, id: string): Promise<JevUndoOutcome> => {
  const outcome = await queued(async () => {
    const entries = await readLog(app, manifestDir);
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return "not-found";
    const reverted = await revert(app, entry);
    if (reverted.outcome === "undone") {
      const rest = entries.filter((candidate) => candidate !== entry);
      await writeLog(app, manifestDir, shifted(rest, entry.file, reverted));
    }
    return reverted.outcome;
  });
  noticeSkipped(outcome === "line-changed" ? 1 : 0, outcome === "file-missing" ? 1 : 0);
  return outcome;
};

/** 一括の取り消し。戻せたものだけ記録から消し、戻せなかった件数はまとめて 1 回 Notice に出す。 */
export const undoBatch = async (
  app: App,
  manifestDir: string,
  batchId: string,
): Promise<JevUndoBatchResult> => {
  const result = await queued(async () => {
    const entries = await readLog(app, manifestDir);
    // 一括の書き込みは並列に走る（設計 §4-3）ので、記録の順は行の順とは限らない。同じノートの下の行から
    // 戻せば、まだ戻していない上の行の位置が動かない。
    const batch = entries
      .filter((entry) => entry.batchId === batchId)
      .sort((a, b) => (a.file === b.file ? b.line - a.line : a.file.localeCompare(b.file)));
    let rest = entries;
    let undone = 0;
    let lineChanged = 0;
    let fileMissing = 0;
    for (const entry of batch) {
      const reverted = await revert(app, entry);
      if (reverted.outcome === "undone") {
        undone++;
        rest = shifted(rest.filter((candidate) => candidate !== entry), entry.file, reverted);
      } else if (reverted.outcome === "line-changed") lineChanged++;
      else fileMissing++;
    }
    if (undone > 0) await writeLog(app, manifestDir, rest);
    return { undone, skipped: batch.length - undone, lineChanged, fileMissing };
  });
  noticeSkipped(result.lineChanged, result.fileMissing);
  return { undone: result.undone, skipped: result.skipped };
};

/** 戻したときの、行が消えた（足りた）場所と増減。同じノートのこれより下の記録は行番号がずれる。 */
type Reverted = { outcome: JevUndoOutcome; at: number; delta: number };

/** 取り消しで動いたぶん、同じノートの下にある記録の行番号を直す。 */
const shifted = (entries: JevLogEntry[], file: string, reverted: Reverted): JevLogEntry[] =>
  reverted.delta === 0
    ? entries
    : entries.map((entry) =>
      entry.file === file && entry.line > reverted.at
        ? { ...entry, line: entry.line + reverted.delta }
        : entry);

/** 書いた塊がそのまま残っていれば、もとの塊（空なら行ごと）に戻す。 */
const revert = async (app: App, entry: JevLogEntry): Promise<Reverted> => {
  const file = app.vault.getAbstractFileByPath(entry.file);
  if (!(file instanceof TFile)) return { outcome: "file-missing", at: entry.line, delta: 0 };

  const state: Reverted = { outcome: "undone", at: entry.line, delta: 0 };
  await app.vault.process(file, (data) => {
    // 記録の改行は常に `\n`。ノート自身の改行（CRLF もありうる）はそのまま書き戻す。
    const eol = data.includes("\r\n") ? "\r\n" : "\n";
    const lines = data.split(/\r?\n/u);
    const written = entry.after.split("\n");
    if (lines.slice(entry.line, entry.line + written.length).join("\n") !== entry.after) {
      state.outcome = "line-changed";
      return data;
    }
    // 見出しごと足した記録でも、そのあと同じ節に別の行が入っていれば、足した行だけ消して見出しは残す。
    const keepHeading = written.length > 1 && hasContent(lines, entry.line + written.length);
    const count = keepHeading ? 1 : written.length;
    const restored = entry.before === "" ? [] : entry.before.split("\n");
    state.at = keepHeading ? entry.line + written.length - 1 : entry.line;
    state.delta = restored.length - count;
    lines.splice(state.at, count, ...restored);
    return lines.join(eol);
  });
  return state;
};

/** `from` から次の見出しまでに、空行でない行があるか。 */
const hasContent = (lines: string[], from: number): boolean => {
  for (let i = from; i < lines.length; i++) {
    if (/^#{1,6}\s/u.test(lines[i])) return false;
    if (lines[i].trim() !== "") return true;
  }
  return false;
};

const noticeSkipped = (lineChanged: number, fileMissing: number): void => {
  if (lineChanged > 0) {
    new Notice(`Jev did not undo ${lineChanged} line(s) that changed after they were written.`);
  }
  if (fileMissing > 0) {
    new Notice(`Jev did not undo ${fileMissing} line(s) because the note is gone.`);
  }
};

const logPath = (manifestDir: string): string => normalizePath(`${manifestDir}/${LOG_FILE}`);

const readLog = async (app: App, manifestDir: string): Promise<JevLogEntry[]> => {
  const path = logPath(manifestDir);
  if (!(await app.vault.adapter.exists(path))) return [];
  return JSON.parse(await app.vault.adapter.read(path)) as JevLogEntry[];
};

const writeLog = async (app: App, manifestDir: string, entries: JevLogEntry[]): Promise<void> => {
  await app.vault.adapter.write(logPath(manifestDir), JSON.stringify(entries, null, 2));
};

// 一括確定は判定を並列に走らせる（設計 §4-3）ので、読んで足して書き戻す間に別の書き込みが割り込むと
// 記録が消える。`jev-log.json` に触る処理は 1 本に並べる。
let pending: Promise<unknown> = Promise.resolve();

const queued = <T>(task: () => Promise<T>): Promise<T> => {
  const run = pending.then(task, task);
  pending = run.catch((): void => undefined);
  return run;
};
