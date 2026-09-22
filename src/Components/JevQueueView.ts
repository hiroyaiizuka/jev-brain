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
import { DIRECTION_QUESTION, FIELD_QUESTION, buildQuestions, judge, percentOf } from "src/jev/judge";
import type { Choice, Judgement, Questions } from "src/jev/judge";
import { appendLogEntry, undo } from "src/jev/log";
import { JevQueueModel } from "src/jev/queue-model";
import type { JevQueueCard } from "src/jev/queue-model";
import { appendRelation } from "src/jev/relations";
import type { RelationEdit } from "src/jev/relations";
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

/**
 * 同時に投げる判定の数（設計 §4-2「判定は同時 3 本」）。一括の 5（§4-3）とは別で、
 * 再試行と「戻す」も含めてこの 1 本の待ち行列を通す。
 */
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
   * 聞く順番の待ち行列と、走っている worker の数。`askAll` も「再試行」「戻す」もここを通すので、
   * ボタンを連打しても同時に飛ぶのは CONCURRENCY 本まで。世代は積んだときの中心のもの。
   */
  private readonly askQueue: { card: JevQueueCard; generation: number }[] = [];
  private askWorkers = 0;
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
  /** hierarchy から組む 2 問。中心ごとに 1 度だけ作り、カードごとには組み直さない。 */
  private questions: Questions | null = null;
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
    // `setViewState` は onOpen を待つので、収集と判定を待たせない（30 件なら分の単位で開かない）。
    void this.refresh(this.plugin.scene?.centralPagePath ?? null);
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    // 飛んでいる判定の答えを捨てる。`askJev` は中断できないので、世代を進めて無視する。
    this.generation++;
    this.askQueue.length = 0;
    this.cardEls.clear();
    // 中心も忘れる。leaf が作り直されて同じ instance に onOpen が来たとき、覚えたままだと
    // refresh が「同じ中心」で止まり、pending のカードが「Asking Jev…」のまま残る。
    this.centre = null;
    this.note = null;
    this.noteText = "";
    this.model.setNote(null, []);
    return Promise.resolve();
  }

  /**
   * 中心ノートが変わった。中心が同じ再描画（索引の更新ごとに `Scene.render()` は走る）では
   * 作り直さない。確定済みのカードの「取り消す」が消えてしまうため。
   */
  private async refresh(path: string | null): Promise<void> {
    if (path === this.centre) return;
    const generation = ++this.generation;
    this.askQueue.length = 0;
    const note = this.centralNote(path);
    const text = note ? await this.readNote(note.file) : null;
    if (generation !== this.generation) return;
    const links = note && text !== null ? this.collect(note, text) : null;
    // 読めなかった／集められなかったとき（索引がまだ、ノートが消えた）は中心を覚えない。覚えると
    // 同じ中心の再描画がすべて弾かれ、別のノートへ往復するまでこのノートのキューが空のままになる。
    const failed = note !== null && links === null;
    this.centre = failed ? null : path;
    this.note = failed ? null : note;
    this.noteText = failed ? "" : text ?? "";
    this.batchId = `queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.questions = this.note ? buildQuestions(this.plugin.settings.hierarchy) : null;
    // ノートでない中心（フォルダ・タグ・URL）にキューは無いので、モデルには中心なしとして渡す。
    this.model.setNote(this.note ? this.note.file.path : null, links ?? []);
    this.renderAll();
    this.enqueue(this.model.pending());
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

  /** 集められなかったとき（索引がまだ立ち上がっていない）は null。空の `[]` とは区別する。 */
  private collect(note: CentralNote, text: string): UntypedLink[] | null {
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
      return null;
    }
  }

  // ---- Jev への問い合わせ -------------------------------------------------

  /** 聞くカードを待ち行列に積み、足りないぶんだけ worker を足す。 */
  private enqueue(cards: readonly JevQueueCard[]): void {
    const generation = this.generation;
    for (const card of cards) this.askQueue.push({ card, generation });
    const spawn = Math.min(CONCURRENCY - this.askWorkers, this.askQueue.length);
    for (let i = 0; i < spawn; i++) {
      this.askWorkers++;
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    try {
      for (let next = this.askQueue.shift(); next; next = this.askQueue.shift()) {
        // 積んだあとに中心が変わったぶんは、聞かずに落とす。
        if (next.generation !== this.generation) continue;
        try {
          await this.askOne(next.card, next.generation);
        } catch (error) {
          // 1 枚で worker を落とさない（`void this.drain()` なので投げても誰も受け取らない）。
          this.report("JevQueueView.drain", `could not judge ${next.card.target}`, error);
          this.model.failed(next.card.target);
          this.renderCard(next.card);
        }
      }
    } finally {
      this.askWorkers--;
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
        offset: card.offset,
        length: card.length,
      },
      targetNote: target
        ? {
          frontmatter: this.app.metadataCache.getFileCache(target)?.frontmatter,
          text: targetText ?? "",
        }
        : null,
      contextChars: settings.jev.contextChars,
    });
    const questions = this.questions ?? buildQuestions(settings.hierarchy);
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
    const generation = this.generation;
    const batchId = this.batchId;
    if (!note || !field || card.status !== "open") return;
    const jev = this.plugin.settings.jev;
    let edit: RelationEdit | null;
    let logId = "";
    try {
      edit = await appendRelation(this.app, note.file, field, this.linkTextOf(card.target), {
        heading: jev.relationsHeading,
        mode: jev.writeMode,
      });
      if (!edit) {
        new Notice(t("JEV_QUEUE_NO_CHANGE"));
        return;
      }
      // 記録できるのはデータフォルダが分かるときだけ。無ければ書き込みは残し、取り消しは出さない。
      const dir = this.plugin.manifest.dir;
      if (dir) {
        const entry = await appendLogEntry(this.app, dir, {
          batchId,
          file: note.file.path,
          line: edit.line,
          before: edit.before,
          after: edit.after,
          source: "queue",
        });
        logId = entry.id;
      }
    } catch (error) {
      // ノートが消えた、`jev-log.json` が壊れている など。行は入っているかもしれないので、黙らない。
      this.report("JevQueueView.confirm", `could not write ${field} for ${card.target}`, error);
      new Notice(t("JEV_QUEUE_WRITE_FAILED"));
      return;
    }
    // 書いている間に中心が変わった。書き込みと記録は残すが、いまのカードはもう別のノートのもの。
    if (generation !== this.generation) return;
    this.model.confirm(card.target, { field, text: edit.after, logId });
    this.renderCard(card);
  }

  private async undoWrite(card: JevQueueCard): Promise<void> {
    const dir = this.plugin.manifest.dir;
    const logId = card.write?.logId;
    const generation = this.generation;
    if (!dir || !logId) return;
    let outcome: Awaited<ReturnType<typeof undo>>;
    try {
      outcome = await undo(this.app, dir, logId);
    } catch (error) {
      this.report("JevQueueView.undoWrite", `could not undo ${logId}`, error);
      new Notice(t("JEV_QUEUE_UNDO_FAILED"));
      return;
    }
    if (generation !== this.generation) return;
    if (outcome === "undone") {
      this.model.undone(card.target);
      this.renderCard(card);
      return;
    }
    // 行が変わった・ノートが無いは log.ts が Notice を出す。記録ごと消えているのはここで言う。
    if (outcome === "not-found") new Notice(t("JEV_QUEUE_UNDO_MISSING"));
  }

  private report(fn: string, message: string, error: unknown): void {
    errorlog({ fn, where: `${fn}()`, message, error: error instanceof Error ? error : undefined });
  }

  private defer(card: JevQueueCard): void {
    if (this.model.defer(card.target)) this.renderCard(card);
  }

  private restore(card: JevQueueCard): void {
    if (!this.model.restore(card.target)) return;
    this.renderCard(card);
    if (card.status === "pending") this.enqueue([card]);
  }

  private retry(card: JevQueueCard): void {
    if (!this.model.retry(card.target)) return;
    this.renderCard(card);
    this.enqueue([card]);
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
    // `judge` が確率順の上位 5 件に絞ってある（設計 §2-3）。ここでは並べ替えも絞り込みもしない。
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

const percent = (probability: number): string => `${percentOf(probability)}%`;

/**
 * カード 1 行の要約。確率は候補のボタンに出るので、自信なしのときここで言うのは
 * 方向が食い違っていて既定が無いことだけ（設計 §2-3）。
 */
const summarise = (judgement: Judgement): string =>
  judgement.confident
    ? t("JEV_QUEUE_DIRECTION")
      .replace("{direction}", judgement.direction ?? "")
      .replace("{probability}", percent(judgement.directionProbability))
    : t("JEV_QUEUE_UNCERTAIN");
