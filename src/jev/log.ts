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
    const result = await revert(app, entry);
    if (result === "undone") {
      await writeLog(app, manifestDir, entries.filter((candidate) => candidate !== entry));
    }
    return result;
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
    const batch = entries.filter((entry) => entry.batchId === batchId);
    const undone = new Set<JevLogEntry>();
    let lineChanged = 0;
    let fileMissing = 0;
    // 同じノートに足した行は後の記録ほど下にあるので、後ろから戻せば残りの行番号がずれない。
    for (const entry of [...batch].reverse()) {
      const outcome = await revert(app, entry);
      if (outcome === "undone") undone.add(entry);
      else if (outcome === "line-changed") lineChanged++;
      else fileMissing++;
    }
    if (undone.size > 0) {
      await writeLog(app, manifestDir, entries.filter((entry) => !undone.has(entry)));
    }
    return { undone: undone.size, skipped: batch.length - undone.size, lineChanged, fileMissing };
  });
  noticeSkipped(result.lineChanged, result.fileMissing);
  return { undone: result.undone, skipped: result.skipped };
};

/** 書いた塊がそのまま残っていれば、もとの塊（空なら行ごと）に戻す。 */
const revert = async (app: App, entry: JevLogEntry): Promise<JevUndoOutcome> => {
  const file = app.vault.getAbstractFileByPath(entry.file);
  if (!(file instanceof TFile)) return "file-missing";

  const state: { outcome: JevUndoOutcome } = { outcome: "undone" };
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const written = entry.after.split("\n");
    if (lines.slice(entry.line, entry.line + written.length).join("\n") !== entry.after) {
      state.outcome = "line-changed";
      return data;
    }
    // 見出しごと足した記録でも、そのあと同じ節に別の行が入っていれば、足した行だけ消して見出しは残す。
    const keepHeading = written.length > 1 && hasContent(lines, entry.line + written.length);
    const from = keepHeading ? entry.line + written.length - 1 : entry.line;
    const count = keepHeading ? 1 : written.length;
    lines.splice(from, count, ...(entry.before === "" ? [] : entry.before.split("\n")));
    return lines.join("\n");
  });
  return state.outcome;
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
