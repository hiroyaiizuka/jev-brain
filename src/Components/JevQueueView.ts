import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type ExcaliBrain from "src/excalibrain-main";
import type { Page } from "src/graph/Page";
import { t } from "src/lang/helpers";
import { errorlog } from "src/utils/utils";
import { DEFAULT_JEV_TIMEOUT_MS, askJev } from "src/jev/client";
import type { JevClientConfig, JevQuestion } from "src/jev/client";
import { collectUntypedLinks } from "src/jev/collect";
import type { UntypedLink } from "src/jev/collect";
import { DIRECTION_QUESTION, FIELD_QUESTION, buildQuestions, judge } from "src/jev/judge";
import type { Choice, Judgement } from "src/jev/judge";
import { appendLogEntry, undo } from "src/jev/log";
import { JevQueueModel } from "src/jev/queue-model";
import type { JevQueueCard } from "src/jev/queue-model";
import { appendRelation } from "src/jev/relations";
import { buildState } from "src/jev/state";
import { JEV_CENTRAL_PAGE_CHANGED } from "src/utils/jevEvents";

/**
 * 型付け待ちキュー（docs/jev-link-typer-design.md §4-2、product-plan.md §3「JEV-3」）。中心ノートが
 * 変わるたびに未型付けリンクを集めてカードにし、カードごとに Jev に聞いて、確定・あとで・取り消しを出す。
 *
 * ここは描画と入出力だけで、カードの遷移は `src/jev/queue-model.ts`（DOM 無し）が持つ。Jev への
 * 問い合わせは `src/jev/client.ts`、ノートへの書き込みは `src/jev/relations.ts`・`log.ts` の外に出ない。
 * 本格的なスタイルとツールパネルのボタンは LEV-175、実機は LEV-176。
 */
export const JEV_QUEUE_VIEW_TYPE = "jevbrain-queue";

/** 同時に投げる判定の数（設計 §4-2 の「並列 3」）。一括の 5 とは別。 */
const CONCURRENCY = 3;

/** 右サイドにキューを開く。既に開いていればそれを表に出すだけ。 */
export const activateJevQueue = async (app: App): Promise<void> => {
  const open = app.workspace.getLeavesOfType(JEV_QUEUE_VIEW_TYPE);
  const leaf = open[0] ?? app.workspace.getRightLeaf(false);
  if (!leaf) return;
  if (open.length === 0) {
    await leaf.setViewState({ type: JEV_QUEUE_VIEW_TYPE, active: true });
  }
  await app.workspace.revealLeaf(leaf);
};

/** 中心ノートが Markdown のノートのときだけ、そのページとファイル。 */
type CentralNote = { page: Page; file: TFile };

export class JevQueueView extends ItemView {
  private readonly plugin: ExcaliBrain;
  private readonly model = new JevQueueModel();
  private readonly cardEls = new Map<string, HTMLElement>();
  /**
   * 中心が変わるたびに増える。判定は非同期で返るので、これが変わっていたら
   * 前の中心ノートの答えとして捨てる。
   */
  private generation = 0;
  /** Scene が最後に知らせた中心のパス。ノートでない中心（フォルダ・タグ・URL）も含む。 */
  private centre: string | null = null;
  private note: CentralNote | null = null;
  /** `metadataCache` が読んだのと同じ版の本文。state の前後の文をここから切る。 */
  private noteText = "";
  /** このノートでの確定をまとめる単位。`undoBatch` がノートをまたがないよう中心ごとに作る。 */
  private batchId = "";
  private headerEl: HTMLElement;
  private listEl: HTMLElement;
  private footerEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ExcaliBrain) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return JEV_QUEUE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("JEV_QUEUE_TITLE");
  }

  getIcon(): string {
    return "links-coming-in";
  }

  override onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("jevbrain-queue");
    this.headerEl = root.createDiv({ cls: "jevbrain-queue-header" });
    this.listEl = root.createDiv({ cls: "jevbrain-queue-list" });
    this.footerEl = root.createDiv({ cls: "jevbrain-queue-footer" });
    this.registerEvent(
      this.app.workspace.on(JEV_CENTRAL_PAGE_CHANGED, (path) => {
        void this.refresh(path);
      }),
    );
    this.renderAll();
    // view はキューを開いたときに始まるので、既に描かれている中心を Scene から読む（パスだけ）。
    return this.refresh(this.plugin.scene?.centralPagePath ?? null);
  }

  override onClose(): Promise<void> {
    // 飛んでいる判定の答えを捨てる。`askJev` は中断できないので、世代を進めて無視する。
    this.generation++;
    this.cardEls.clear();
    return Promise.resolve();
  }

  /**
   * 中心ノートが変わった。中心が同じ再描画（索引の更新ごとに `Scene.render()` は走る）では
   * 作り直さない。確定済みのカードの「取り消す」が消えてしまうため。
   */
  private async refresh(path: string | null): Promise<void> {
    if (path === this.centre) return;
    this.centre = path;
    const generation = ++this.generation;
    const note = this.centralNote(path);
    const text = note ? await this.readNote(note.file) : null;
    const links = note && text !== null ? this.collect(note, text) : [];
    if (generation !== this.generation) return;
    this.note = note;
    this.noteText = text ?? "";
    this.batchId = `queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // ノートでない中心（フォルダ・タグ・URL）にキューは無いので、モデルには中心なしとして渡す。
    this.model.setNote(note ? note.file.path : null, links);
    this.renderAll();
    await this.askAll(generation);
  }

  /** フォルダ・タグ・URL・仮想ノード・Markdown でないファイルにはキューを出さない。 */
  private centralNote(path: string | null): CentralNote | null {
    if (!path) return null;
    const page = this.plugin.pages?.get(path);
    if (!page || page.isFolder || page.isTag || page.isURL || !page.file) return null;
    return page.file.extension === "md" ? { page, file: page.file } : null;
  }

  private async readNote(file: TFile): Promise<string | null> {
    try {
      return await this.app.vault.cachedRead(file);
    } catch {
      // 集め直す前にノートが消えた。空のキューとして扱う。
      return null;
    }
  }

  private collect(note: CentralNote, text: string): UntypedLink[] {
    try {
      return collectUntypedLinks(this.app, note.page, note.file, text);
    } catch (error) {
      // 索引（Dataview）がまだ立ち上がっていない間に開かれた。次の中心で拾い直す。
      errorlog({
        fn: "JevQueueView.collect",
        where: "JevQueueView.collect()",
        message: `could not read the links of ${note.file.path}`,
        error: error instanceof Error ? error : undefined,
      });
      return [];
    }
  }

  // ---- Jev への問い合わせ -------------------------------------------------

  /** まだ聞いていないカードを、同時 3 本まで（設計 §4-2）で埋める。 */
  private async askAll(generation: number): Promise<void> {
    const queue = this.model.pending();
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      workers.push(this.worker(queue, generation));
    }
    await Promise.all(workers);
  }

  private async worker(queue: JevQueueCard[], generation: number): Promise<void> {
    for (let card = queue.shift(); card; card = queue.shift()) {
      if (generation !== this.generation) return;
      await this.askOne(card, generation);
    }
  }

  private async askOne(card: JevQueueCard, generation: number): Promise<void> {
    const answer = await this.ask(card);
    if (generation !== this.generation) return;
    if (answer) {
      this.model.recordCall(answer.inputTokens);
      this.model.judged(card.target, answer.judgement);
    } else {
      this.model.failed(card.target);
    }
    this.renderCard(card);
    this.renderFooter();
  }

  /** 1 本ぶんの state と 2 問を組んで聞く。失敗（`client.ts` が Notice 済み）は null。 */
  private async ask(card: JevQueueCard): Promise<{ judgement: Judgement; inputTokens: number } | null> {
    const note = this.note;
    if (!note) return null;
    const settings = this.plugin.settings;
    const target = this.targetFile(card.target);
    const targetText = target ? await this.readNote(target) : null;
    const state = buildState({
      note: {
        frontmatter: this.app.metadataCache.getFileCache(note.file)?.frontmatter,
        text: this.noteText,
      },
      link: {
        target: this.linkTextOf(card.target),
        offset: offsetOf(this.noteText, card.line, card.ch),
        length: linkLength(card.context, card.ch),
      },
      targetNote: target
        ? {
          frontmatter: this.app.metadataCache.getFileCache(target)?.frontmatter,
          text: targetText ?? "",
        }
        : null,
      contextChars: settings.jev.contextChars,
    });
    const questions = buildQuestions(settings.hierarchy);
    const response = await askJev(this.clientConfig(), {
      state,
      questions: {
        [FIELD_QUESTION]: toJevQuestion(questions[FIELD_QUESTION]),
        [DIRECTION_QUESTION]: toJevQuestion(questions[DIRECTION_QUESTION]),
      },
    });
    if (!response) return null;
    return { judgement: judge(response, settings.hierarchy), inputTokens: response.usage?.inputTokens ?? 0 };
  }

  private clientConfig(): JevClientConfig {
    const { apiKey, endpoint, model } = this.plugin.settings.jev;
    return { apiKey, endpoint, model, timeoutMs: DEFAULT_JEV_TIMEOUT_MS };
  }

  /** `collect` の `target` は解決したパスか、未解決ならリンクの文字列そのもの。 */
  private targetFile(target: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(target);
    return file instanceof TFile ? file : null;
  }

  /**
   * 書き込みと state に使うリンクの書き方。`[[folder/Note.md]]` ではなく Obsidian が
   * そのノートから書くのと同じ最短の形にする。未解決のリンクはそのまま。
   */
  private linkTextOf(target: string): string {
    const file = this.targetFile(target);
    return file && this.note ? this.app.metadataCache.fileToLinktext(file, this.note.file.path) : target;
  }

  // ---- 確定・あとで・取り消し ---------------------------------------------

  private async confirm(card: JevQueueCard): Promise<void> {
    const note = this.note;
    const field = card.selected;
    if (!note || !field || card.status !== "open") return;
    const jev = this.plugin.settings.jev;
    const edit = await appendRelation(this.app, note.file, field, this.linkTextOf(card.target), {
      heading: jev.relationsHeading,
      mode: jev.writeMode,
    });
    if (!edit) {
      new Notice(t("JEV_QUEUE_NO_CHANGE"));
      return;
    }
    // 記録できるのはプラグインのデータフォルダが分かるときだけ。無ければ書き込みは残し、取り消しは出さない。
    const dir = this.plugin.manifest.dir;
    const entry = dir
      ? await appendLogEntry(this.app, dir, {
        batchId: this.batchId,
        file: note.file.path,
        line: edit.line,
        before: edit.before,
        after: edit.after,
        source: "queue",
      })
      : null;
    this.model.confirm(card.target, { field, text: edit.after, logId: entry?.id ?? "" });
    this.renderCard(card);
  }

  private async undoWrite(card: JevQueueCard): Promise<void> {
    const dir = this.plugin.manifest.dir;
    const logId = card.write?.logId;
    if (!dir || !logId) return;
    const outcome = await undo(this.app, dir, logId);
    if (outcome === "undone") {
      this.model.undone(card.target);
      this.renderCard(card);
      return;
    }
    // 行が変わった・ノートが無いは log.ts が Notice を出す。記録ごと消えているのはここで言う。
    if (outcome === "not-found") new Notice(t("JEV_QUEUE_UNDO_MISSING"));
  }

  private defer(card: JevQueueCard): void {
    if (this.model.defer(card.target)) this.renderCard(card);
  }

  private restore(card: JevQueueCard): void {
    if (!this.model.restore(card.target)) return;
    this.renderCard(card);
    if (card.status === "pending") void this.askOne(card, this.generation);
  }

  private retry(card: JevQueueCard): void {
    if (!this.model.retry(card.target)) return;
    this.renderCard(card);
    void this.askOne(card, this.generation);
  }

  // ---- 描画 ---------------------------------------------------------------

  private renderAll(): void {
    this.cardEls.clear();
    this.listEl.empty();
    this.renderHeader();
    const cards = this.model.list;
    if (cards.length === 0) {
      this.listEl.createDiv({
        cls: "jevbrain-queue-empty",
        text: this.model.notePath ? t("JEV_QUEUE_EMPTY") : t("JEV_QUEUE_NO_CENTRE"),
      });
    }
    for (const card of cards) {
      const el = this.listEl.createDiv({ cls: "jevbrain-queue-card" });
      this.cardEls.set(card.target, el);
      this.fillCard(card, el);
    }
    this.renderFooter();
  }

  private renderHeader(): void {
    this.headerEl.empty();
    const path = this.model.notePath;
    const page = path ? this.plugin.pages?.get(path) : null;
    this.headerEl.createDiv({
      cls: "jevbrain-queue-note",
      text: page ? page.getTitle() : t("JEV_QUEUE_NO_CENTRE_SHORT"),
    });
    this.headerEl.createDiv({
      cls: "jevbrain-queue-count",
      text: t("JEV_QUEUE_COUNT").replace("{n}", String(this.model.list.length)),
    });
  }

  private renderFooter(): void {
    const { calls, inputTokens, costJpy } = this.model.usage;
    this.footerEl.setText(
      t("JEV_QUEUE_USAGE")
        .replace("{calls}", String(calls))
        .replace("{tokens}", inputTokens.toLocaleString())
        .replace("{cost}", costJpy > 0 && costJpy < 0.01 ? "<0.01" : costJpy.toFixed(2)),
    );
  }

  private renderCard(card: JevQueueCard): void {
    const el = this.cardEls.get(card.target);
    if (!el) return;
    el.empty();
    this.fillCard(card, el);
  }

  private fillCard(card: JevQueueCard, el: HTMLElement): void {
    el.dataset.jevStatus = card.status;
    el.createDiv({ cls: "jevbrain-queue-card-target", text: card.displayText });
    el.createDiv({ cls: "jevbrain-queue-card-context", text: card.context.trim() });
    switch (card.status) {
      case "pending":
        el.createDiv({ cls: "jevbrain-queue-card-note", text: t("JEV_QUEUE_ASKING") });
        break;
      case "failed":
        el.createDiv({ cls: "jevbrain-queue-card-note", text: t("JEV_QUEUE_FAILED") });
        this.addActions(el, [
          { text: t("JEV_QUEUE_RETRY"), run: () => { this.retry(card); } },
          { text: t("JEV_QUEUE_LATER"), run: () => { this.defer(card); } },
        ]);
        break;
      case "later":
        el.createDiv({ cls: "jevbrain-queue-card-note", text: t("JEV_QUEUE_DEFERRED") });
        this.addActions(el, [{ text: t("JEV_QUEUE_BACK"), run: () => { this.restore(card); } }]);
        break;
      case "done":
        this.fillDone(card, el);
        break;
      case "open":
        this.fillOpen(card, el);
        break;
    }
  }

  private fillOpen(card: JevQueueCard, el: HTMLElement): void {
    const judgement = card.judgement;
    if (!judgement) return;
    el.createDiv({ cls: "jevbrain-queue-card-note", text: summarise(judgement) });
    const candidates = el.createDiv({ cls: "jevbrain-queue-candidates" });
    for (const candidate of judgement.ordered) {
      const button = candidates.createEl("button", {
        cls: "jevbrain-queue-candidate",
        text: candidate.probability === undefined
          ? candidate.field
          : `${candidate.field} ${percent(candidate.probability)}`,
      });
      if (candidate.field === card.selected) button.addClass("jevbrain-queue-candidate-selected");
      button.addEventListener("click", () => {
        if (this.model.select(card.target, candidate.field)) this.renderCard(card);
      });
    }
    const actions = this.addActions(el, [
      {
        text: card.selected
          ? t("JEV_QUEUE_CONFIRM").replace("{field}", card.selected)
          : t("JEV_QUEUE_CONFIRM_NONE"),
        cls: "mod-cta",
        run: () => { void this.confirm(card); },
      },
      { text: t("JEV_QUEUE_LATER"), run: () => { this.defer(card); } },
    ]);
    if (!card.selected) actions[0].disabled = true;
  }

  private fillDone(card: JevQueueCard, el: HTMLElement): void {
    el.createEl("pre", { cls: "jevbrain-queue-card-written", text: card.write?.text ?? "" });
    if (!card.write?.logId) return;
    this.addActions(el, [{ text: t("JEV_QUEUE_UNDO"), run: () => { void this.undoWrite(card); } }]);
  }

  private addActions(
    el: HTMLElement,
    actions: { text: string; cls?: string; run: () => void }[],
  ): HTMLButtonElement[] {
    const wrapper = el.createDiv({ cls: "jevbrain-queue-actions" });
    return actions.map((action) => {
      const button = wrapper.createEl("button", { text: action.text, cls: action.cls });
      button.addEventListener("click", action.run);
      return button;
    });
  }
}

/** `judge.ts` の質問を `client.ts` が送る形に。両者の間にあるのはこの 1 行だけ。 */
const toJevQuestion = (choice: Choice): JevQuestion => ({
  kind: "choice",
  instructions: choice.question,
  criteria: choice.criteria,
});

const percent = (probability: number): string => `${Math.round(probability * 100)}%`;

/** カード 1 行の要約。自信なしは確率を伏せるので、方向が食い違っていることだけ言う（設計 §2-3）。 */
const summarise = (judgement: Judgement): string =>
  judgement.confident
    ? t("JEV_QUEUE_DIRECTION")
      .replace("{direction}", judgement.direction ?? "")
      .replace("{probability}", percent(judgement.directionProbability))
    : t("JEV_QUEUE_UNCERTAIN");

/**
 * `metadataCache` の行・桁を本文の先頭からの位置に直す（`buildState` が要るのは位置だけ）。
 * CRLF の `\r` は行末に残るので、行の中の桁はそのまま足せる。
 */
const offsetOf = (text: string, line: number, ch: number): number => {
  let offset = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + ch, text.length);
};

/** `[[X]]` が書かれている長さ（別名・見出しを含む）。閉じが同じ行に無ければ測らない。 */
const linkLength = (context: string, ch: number): number | undefined => {
  const close = context.indexOf("]]", ch);
  return close === -1 ? undefined : close + 2 - ch;
};
