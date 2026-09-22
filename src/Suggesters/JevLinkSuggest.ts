import { EditorSuggest, Notice } from "obsidian";
import type {
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import type ExcaliBrain from "src/excalibrain-main";
import { normalizeRelationsHeading } from "src/Settings";
import { DEFAULT_JEV_TIMEOUT_MS, askJev } from "src/jev/client";
import type { JevQuestion } from "src/jev/client";
import { buildQuestions, directionOfField, judge } from "src/jev/judge";
import type { Direction, Judgement, Questions } from "src/jev/judge";
import { appendLogEntry } from "src/jev/log";
import { appendRelation } from "src/jev/relations";
import { buildState } from "src/jev/state";
import { getDVFieldLinksForPage } from "src/utils/dataview";
import { HIERARCHY_REGIONS } from "src/utils/hierarchy";

/**
 * `]]` を閉じた直後に Jev の候補を出すサジェスター（docs/jev-link-typer-design.md §4-1）。
 * 判定と書き込みは `src/jev/` のものをそのまま使い、ここにあるのはエディタとの接点だけ:
 * いつ出すか（{@link JevLinkSuggest.onTrigger}）、待つ間に何を見せるか、選ばれた候補をどう確定するか。
 *
 * 出るのは 1 リンクにつき 1 回で、ブレインの view を開いていなくても動く（設計 §4-1）。
 */

/** ポップアップの 1 行。答えを待つ間の 1 行と、フィールドの候補。 */
export type JevSuggestion =
  | { kind: "asking" }
  | {
    kind: "candidate";
    field: string;
    /** 自信のある判定のときだけ付く（設計 §2-3）。 */
    probability?: number;
    direction: Direction | null;
    confident: boolean;
  };

/** 候補の行に出す方向。`judge.ts` の日本語のラベルは Jev に送る criteria の説明なので、画面はプラグインの言語で書く。 */
const DIRECTION_TEXT: Record<Direction, string> = {
  parent: "parent",
  child: "child",
  leftFriend: "left friend",
  rightFriend: "right friend",
  previous: "previous",
  next: "next",
};

const ASKING: JevSuggestion = { kind: "asking" };

/**
 * `EditorSuggest` が候補を取り直す入口。obsidian.d.ts には無い（公開されているのは `onTrigger` と
 * `getSuggestions` だけ）が、非同期で届いた答えに描き直す手段がほかに無い: `close()`／`open()` は
 * 候補を取り直さないので、閉じて開くだけでは待ちの 1 行が残る（設計 §4-1）。
 * 無くなっていたら何もしない＝次の入力までプレースホルダのまま、で止める。
 */
type EditorSuggestInternals = {
  trigger(editor: Editor, file: TFile | null, manual: boolean): void;
};

/** 問い合わせ中、または候補を出している 1 リンク。 */
type LinkAsk = {
  /** ノートと相手の組。`onTrigger` が「これは今出しているリンクか」を見るのに使う。 */
  key: string;
  file: TFile;
  /** `Pages` と同じ鍵: 解決したパス、未解決ならリンクの文字列。 */
  target: string;
  /** `[[X#見出し|別名]]` の X。`field:: [[X]]` もこの書き方をそのまま使う。 */
  linkpath: string;
  /** ノート本文の中の `[[` の位置と `[[…]]` の長さ（state の窓、設計 §2-2）。 */
  offset: number;
  length: number;
  status: "asking" | "answered" | "failed";
  judgement?: Judgement;
};

/** カーソルの直前で閉じたリンク。 */
type ClosedLink = { start: number; linkpath: string };

/** カーソルの直前で閉じた `[[…]]`。入れ子の `[` は許さない。 */
const CLOSED_LINK = /(!)?\[\[([^[\]]+)\]\]$/u;

/** 自分でフィールドを書いている行（`up:: [[` や `(up:: [[`）。そこはサジェストの出番ではない。 */
const FIELD_BEFORE = /(?:^|\()\s*[^()[\]]*?\s*::\s*$/u;

/** 行とカーソルの桁から、今閉じたリンク。閉じていない・埋め込み・同じノートの中の見出しなら null。 */
const closedLinkAt = (line: string, ch: number): ClosedLink | null => {
  const before = line.slice(0, ch);
  const match = CLOSED_LINK.exec(before);
  if (!match || match[1]) return null; // 埋め込み ![[X]] は対象外（設計 §2-1）
  const start = match.index;
  if (FIELD_BEFORE.test(before.slice(0, start))) return null;
  const inner = match[2];
  const bar = inner.indexOf("|");
  const linkpath = (bar === -1 ? inner : inner.slice(0, bar)).split("#")[0].trim();
  return linkpath === "" ? null : { start, linkpath };
};

/** オントロジーのフィールドを Dataview のキーで。hidden も入れる: そこで結ばれた相手はもう聞かない（設計 §2-1）。 */
const ontologyFields = (plugin: ExcaliBrain): string[] =>
  HIERARCHY_REGIONS.flatMap((region) => plugin.hierarchyLowerCase[region]);

/** `from` のノートのオントロジーのフィールドが `to` を指しているか。 */
const fieldLinksTo = (plugin: ExcaliBrain, from: string, to: string, fields: string[]): boolean => {
  const dvPage = plugin.DVAPI?.page(from);
  return dvPage ? getDVFieldLinksForPage(plugin, dvPage, fields).some((item) => item.link === to) : false;
};

/** `judge.ts` の質問を `client.ts` の形に。Choice しか無い（Score と Noul は JEV-5）。 */
const toRequestQuestions = (questions: Questions): Record<string, JevQuestion> =>
  Object.fromEntries(
    Object.entries(questions).map(([name, choice]): [string, JevQuestion] => [
      name,
      { kind: "choice", instructions: choice.question, criteria: choice.criteria },
    ]),
  );

export class JevLinkSuggest extends EditorSuggest<JevSuggestion> {
  plugin: ExcaliBrain;
  /** 今出している（または問い合わせ中の）1 件。ここに入っている間は同じ場所の `onTrigger` を通す。 */
  private ask: LinkAsk | null = null;
  /** セッション中に一度聞いた相手。ノートのパス → 相手（設計 §4-1）。 */
  private readonly asked = new Map<string, Set<string>>();

  constructor(plugin: ExcaliBrain) {
    super(plugin.app);
    this.plugin = plugin;
    // 設計 §4-1「ノートを閉じたら消す」。閉じたことを知らせるイベントは無いので、別のノートを
    // 開いたときにそれ以外のぶんを忘れる。
    plugin.registerEvent(
      plugin.app.workspace.on("file-open", (file) => { this.forgetOtherNotes(file ? file.path : null); }),
    );
  }

  /**
   * 出す条件（設計 §4-1）: 設定が真、カーソルの直前で `[[X]]` が閉じた、その相手にまだフィールドが
   * 無い、このノートのその相手はまだ聞いていない。通ったところで問い合わせを始める（答えは非同期で、
   * 待つ間は {@link getSuggestions} がプレースホルダ 1 行を返す）。
   *
   * 今出している 1 件だけは「もう聞いた」を素通りする。答えが届いたときの描き直しがこの関数を
   * もう一度通るので、ここで閉じてしまうと候補に入れ替わらない。
   */
  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.jev.suggestOnLinkClose || !file || !this.plugin.DVAPI) return null;
    const closed = closedLinkAt(editor.getLine(cursor.line), cursor.ch);
    if (!closed) return null;
    const start: EditorPosition = { line: cursor.line, ch: closed.start };
    const target = this.plugin.app.metadataCache
      .getFirstLinkpathDest(closed.linkpath, file.path)?.path ?? closed.linkpath;
    // 場所まで鍵に入れる: 答えが届いたときの描き直しは同じ場所なので素通りし、同じ相手の
    // 2 件目のリンクは別の鍵になって「もう聞いた」で止まる。
    const key = `${file.path}\n${cursor.line}:${closed.start}\n${target}`;
    if (this.ask?.key !== key) {
      if (this.asked.get(file.path)?.has(target)) return null;
      if (!this.isUntyped(file, target)) return null;
      this.startAsk({
        key,
        file,
        target,
        linkpath: closed.linkpath,
        offset: editor.posToOffset(start),
        length: cursor.ch - closed.start,
        status: "asking",
      }, editor.getValue());
    }
    return { start, end: cursor, query: closed.linkpath };
  }

  /** 待つ間は 1 行、答えが届いたら `judge` の並び、失敗したら空＝ポップアップを閉じる（Notice は `client.ts` が出す）。 */
  getSuggestions(_context: EditorSuggestContext): JevSuggestion[] {
    const ask = this.ask;
    if (!ask || ask.status === "failed") return [];
    const judgement = ask.judgement;
    if (ask.status === "asking" || !judgement) return [ASKING];
    const hierarchy = this.plugin.settings.hierarchy;
    return judgement.ordered.map((candidate): JevSuggestion => ({
      kind: "candidate",
      field: candidate.field,
      probability: candidate.probability,
      direction: directionOfField(candidate.field, hierarchy),
      confident: judgement.confident,
    }));
  }

  renderSuggestion(suggestion: JevSuggestion, el: HTMLElement): void {
    if (suggestion.kind === "asking") {
      el.createSpan({ text: "Jev is answering…", cls: "suggestion-note" });
      return;
    }
    el.createEl("code", { text: suggestion.field });
    // 自信なしのときは確率を伏せ、そのことを書く（設計 §2-3）。
    const note = [
      suggestion.probability === undefined ? null : `${Math.round(suggestion.probability * 100)}%`,
      suggestion.direction ? DIRECTION_TEXT[suggestion.direction] : null,
      suggestion.confident ? null : "Jev is not confident",
    ].filter((part): part is string => part !== null).join(" · ");
    if (note !== "") el.createSpan({ text: ` ${note}`, cls: "suggestion-note" });
  }

  selectSuggestion(suggestion: JevSuggestion): void {
    const ask = this.ask;
    if (suggestion.kind !== "candidate" || !ask) return;
    // 確定したリンクはもう候補を出す相手ではない。「もう聞いた」に残るので出し直しもしない。
    this.ask = null;
    void this.confirm(ask, suggestion.field);
  }

  /**
   * ホットキー版（LEV-172）の入口。カーソルの位置で {@link onTrigger} からやり直す。
   * 今は onTrigger の条件（`]]` の直後・未型付け・セッション中 1 回）がそのまま効くので、
   * 「カーソル上の型付きリンクを付け替える」は LEV-172 で条件を緩めて足す。
   */
  openAt(editor: Editor, file: TFile): void {
    this.retrigger(editor, file);
  }

  /**
   * その相手にまだオントロジーのフィールドが付いていないか（設計 §2-1）。`collect.ts` の
   * `collectUntypedLinks` と同じ判断を 1 件について、`metadataCache` のリンク一覧と `Pages` の索引
   * なしで行う: 今閉じたばかりのリンクは再解析が追いつかずリンク一覧にまだ載らず、サジェスターは
   * ブレインを開いていなくても動く（設計 §4-1）ので索引がまだ無い。見るのは両ノートの Dataview の
   * フィールドだけで、隣のノートが書いたフィールドもここで拾う（片側が型を付けていれば聞かない）。
   */
  private isUntyped(file: TFile, target: string): boolean {
    const settings = this.plugin.settings;
    if (target === file.path || target === settings.excalibrainFilepath) return false;
    if (settings.excludeFilepaths.some((path) => target.startsWith(path))) return false;
    const fields = ontologyFields(this.plugin);
    return !fieldLinksTo(this.plugin, file.path, target, fields)
      && !fieldLinksTo(this.plugin, target, file.path, fields);
  }

  /** 1 リンクにつき 1 回。答えが届いたら {@link refresh} でポップアップを描き直す。 */
  private startAsk(ask: LinkAsk, text: string): void {
    this.ask = ask;
    const targets = this.asked.get(ask.file.path) ?? new Set<string>();
    targets.add(ask.target);
    this.asked.set(ask.file.path, targets);
    void this.run(ask, text);
  }

  private async run(ask: LinkAsk, text: string): Promise<void> {
    const app = this.plugin.app;
    const jev = this.plugin.settings.jev;
    const targetFile = app.metadataCache.getFirstLinkpathDest(ask.linkpath, ask.file.path);
    const state = buildState({
      note: { frontmatter: app.metadataCache.getFileCache(ask.file)?.frontmatter, text },
      link: { target: ask.linkpath, offset: ask.offset, length: ask.length },
      targetNote: targetFile
        ? {
          frontmatter: app.metadataCache.getFileCache(targetFile)?.frontmatter,
          text: await app.vault.cachedRead(targetFile),
        }
        : null,
      contextChars: jev.contextChars,
    });
    const response = await askJev(
      { apiKey: jev.apiKey, endpoint: jev.endpoint, model: jev.model, timeoutMs: DEFAULT_JEV_TIMEOUT_MS },
      { state, questions: toRequestQuestions(buildQuestions(this.plugin.settings.hierarchy)) },
    );
    if (this.ask !== ask) return; // 別のリンクへ移ったあとに届いた答えは捨てる
    if (response) {
      ask.judgement = judge(response, this.plugin.settings.hierarchy);
      ask.status = "answered";
    } else {
      ask.status = "failed";
    }
    this.refresh();
  }

  /** 確定は設計 §3 のまま: `## Relations` に 1 行足し、取り消せるよう `jev-log.json` に記録する。 */
  private async confirm(ask: LinkAsk, field: string): Promise<void> {
    const { app, manifest, settings } = this.plugin;
    const edit = await appendRelation(app, ask.file, field, ask.linkpath, {
      heading: normalizeRelationsHeading(settings.jev.relationsHeading),
      mode: settings.jev.writeMode,
    });
    if (!edit) {
      new Notice(`Jev: ${field}:: [[${ask.linkpath}]] is already there.`);
      return;
    }
    if (manifest.dir) {
      await appendLogEntry(app, manifest.dir, {
        batchId: `suggest-${Date.now().toString(36)}`,
        file: ask.file.path,
        line: edit.line,
        before: edit.before,
        after: edit.after,
        source: "suggest",
      });
    }
    new Notice(`Jev: added ${field}:: [[${ask.linkpath}]]`);
  }

  /** 届いた答えでポップアップを描き直す。開いていなければ何もしない。 */
  private refresh(): void {
    const context = this.context;
    if (context) this.retrigger(context.editor, context.file);
  }

  private retrigger(editor: Editor, file: TFile): void {
    const trigger = (this as unknown as Partial<EditorSuggestInternals>).trigger;
    if (typeof trigger !== "function") return;
    // 前と同じ context なら候補を取り直さないことがあるので、先に捨ててから `onTrigger` を
    // やり直させる（設計 §4-1: `close()`／`open()` ではなく context の更新で描き直す）。
    this.context = null;
    trigger.call(this, editor, file, true);
  }

  /** 別のノートへ移ったら、そのノート以外のぶんは忘れる（設計 §4-1）。 */
  private forgetOtherNotes(keep: string | null): void {
    for (const path of Array.from(this.asked.keys())) {
      if (path !== keep) this.asked.delete(path);
    }
    if (this.ask && this.ask.file.path !== keep) this.ask = null;
  }
}
