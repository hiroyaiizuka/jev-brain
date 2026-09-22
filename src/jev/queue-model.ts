import { toHierarchyKey } from "../utils/hierarchy";
import type { UntypedLink } from "./collect";
import type { Judgement } from "./judge";

/**
 * 型付け待ちキューの状態（docs/jev-link-typer-design.md §4-2）。カード 1 枚の遷移
 * （open → done → 取り消し、open → later → 戻す）と「あとで」のセッション内の記憶、
 * このノートでの呼び出しの集計だけを持つ。
 *
 * DOM も Obsidian も Jev の通信も知らない（＝`src/jev/` の「UI を持たない」に収まる）。描画と
 * 書き込みは `src/Components/JevQueueView.ts` の側にあり、ここには結果だけが渡ってくる。
 */

/**
 * カードの状態。
 * - `pending`: Jev に聞いている最中（まだ候補が無い）
 * - `open`: 候補が出ていて、確定を待っている
 * - `failed`: 呼び出しが失敗した（`client.ts` が Notice を出している）
 * - `later`: 「あとで」。このセッション中はノートに戻ってきても later で始まる
 * - `done`: `## Relations` に書いた。取り消せる
 */
export type JevQueueStatus = "pending" | "open" | "failed" | "later" | "done";

/** 確定で書いた内容。`logId` は `jev-log.json` の記録の id で、取り消し（`undo`）の handle。 */
export type JevQueueWrite = {
  field: string;
  /** 実際にノートに入った塊（見出しごと作ったときは複数行）。カードにそのまま出す。 */
  text: string;
  /** `appendLogEntry` が付けた id。記録できなかったときは空文字で、取り消しは出さない。 */
  logId: string;
};

/** 未型付けリンク 1 本ぶんのカード。位置と前後の文は `collectUntypedLinks` の返り値そのまま。 */
export type JevQueueCard = {
  readonly target: string;
  readonly displayText: string;
  /** リンクの位置と長さ（`collectUntypedLinks` が `metadataCache` から持ってきたもの）。state に渡す。 */
  readonly offset: number;
  readonly length: number;
  readonly context: string;
  status: JevQueueStatus;
  judgement: Judgement | null;
  /** 確定ボタンが書くフィールド。自信ありなら第一候補、自信なしは本人が選ぶまで null（設計 §2-3）。 */
  selected: string | null;
  write: JevQueueWrite | null;
};

/** 入力トークンの単価（設計 §7、2026-09-22 の公開情報）。 */
export const JEV_USD_PER_MTOKEN = 0.042;

/** 設計 §7 が費用を円で書くときのレート。実勢ではなく「概算費用」の目安。 */
export const JEV_JPY_PER_USD = 150;

/** 入力トークン数から概算費用（円）。出力は無料（設計 §7）。 */
export const estimateCostJpy = (inputTokens: number): number =>
  (inputTokens / 1_000_000) * JEV_USD_PER_MTOKEN * JEV_JPY_PER_USD;

/** パネル下部に出す、このノートでの実績（設計 §4-2）。 */
export type JevQueueUsage = { calls: number; inputTokens: number; costJpy: number };

/**
 * 既定にするフィールド。Q1 の答え（`judgement.field`）であって `ordered[0]` ではない（`judge.ts`）。
 * `ordered` はオントロジーの綴りなので、Dataview のキーで突き合わせて綴りを揃える。応答の語が
 * オントロジーに無ければ（`confident` なら起きないが）先頭に落とす。
 */
const firstChoice = (judgement: Judgement): string | null => {
  const key = toHierarchyKey(judgement.field ?? "");
  const found = judgement.ordered.find((candidate) => toHierarchyKey(candidate.field) === key);
  return found?.field ?? judgement.ordered[0]?.field ?? null;
};

/** 「あとで」の鍵。ノートが違えば別のカードなので、パスと相手の組で覚える。 */
const deferKey = (notePath: string, target: string): string => `${notePath}\n${target}`;

export class JevQueueModel {
  /** 「あとで」にした `ノート\n相手`。セッション中だけで、プラグインデータには残さない（設計 §4-2）。 */
  private readonly deferred = new Set<string>();
  private cards: JevQueueCard[] = [];
  private path: string | null = null;
  private calls = 0;
  private inputTokens = 0;

  /** 今のカードが属する中心ノートのパス。中心が無ければ null。 */
  get notePath(): string | null {
    return this.path;
  }

  get list(): readonly JevQueueCard[] {
    return this.cards;
  }

  /** 呼び出しの集計はノート単位（設計 §4-2 の「このノートの」）なので、`setNote` で 0 に戻る。 */
  get usage(): JevQueueUsage {
    return { calls: this.calls, inputTokens: this.inputTokens, costJpy: estimateCostJpy(this.inputTokens) };
  }

  /**
   * 中心ノートが変わったとき。カードを組み直し、このセッション中に「あとで」にした相手は
   * later で始める。`path` が null なら空にする。
   */
  setNote(path: string | null, links: readonly UntypedLink[]): void {
    this.path = path;
    this.calls = 0;
    this.inputTokens = 0;
    this.cards = path === null
      ? []
      : links.map((link): JevQueueCard => ({
        target: link.target,
        displayText: link.displayText,
        offset: link.offset,
        length: link.length,
        context: link.context,
        status: this.deferred.has(deferKey(path, link.target)) ? "later" : "pending",
        judgement: null,
        selected: null,
        write: null,
      }));
  }

  card(target: string): JevQueueCard | undefined {
    return this.cards.find((card) => card.target === target);
  }

  /** まだ聞いていないカード。「あとで」には聞かない（そのぶんの費用を使わない）。 */
  pending(): JevQueueCard[] {
    return this.cards.filter((card) => card.status === "pending");
  }

  /**
   * 判定が返った。聞いている最中に「あとで」にされたカードは later のままで、答えだけ持たせる
   * （戻したときにもう一度聞かなくて済む）。
   */
  judged(target: string, judgement: Judgement): boolean {
    const card = this.card(target);
    if (!card || (card.status !== "pending" && card.status !== "later")) return false;
    card.judgement = judgement;
    // 自信なしは既定を作らない（設計 §2-3: 何も第一候補を示さない）。
    card.selected = judgement.confident ? firstChoice(judgement) : null;
    if (card.status === "pending") card.status = "open";
    return true;
  }

  /** 呼び出しが失敗した。もう一度聞けるよう `retry` を残す。 */
  failed(target: string): boolean {
    const card = this.card(target);
    if (!card || card.status !== "pending") return false;
    card.status = "failed";
    return true;
  }

  retry(target: string): boolean {
    const card = this.card(target);
    if (!card || card.status !== "failed") return false;
    card.status = "pending";
    return true;
  }

  /** 候補ボタンで選び直す。確定してしまったカードは変えない。 */
  select(target: string, field: string): boolean {
    const card = this.card(target);
    if (!card || card.status !== "open") return false;
    card.selected = field;
    return true;
  }

  /** 「あとで」。書いたあとのカードは対象外（取り消すほうが筋）。 */
  defer(target: string): boolean {
    const card = this.card(target);
    if (!card || card.status === "done" || card.status === "later" || this.path === null) return false;
    card.status = "later";
    this.deferred.add(deferKey(this.path, target));
    return true;
  }

  /** 「あとで」から戻す。まだ答えが無ければ `pending` に戻るので、呼び出し側がもう一度聞く。 */
  restore(target: string): boolean {
    const card = this.card(target);
    if (!card || card.status !== "later" || this.path === null) return false;
    card.status = card.judgement ? "open" : "pending";
    this.deferred.delete(deferKey(this.path, target));
    return true;
  }

  /** `appendRelation` が行を書いたあと。 */
  confirm(target: string, write: JevQueueWrite): boolean {
    const card = this.card(target);
    if (!card || card.status !== "open") return false;
    card.status = "done";
    card.write = write;
    return true;
  }

  /** `undo` が行を戻したあと。候補はそのまま残るので、選び直してもう一度確定できる。 */
  undone(target: string): boolean {
    const card = this.card(target);
    if (!card || card.status !== "done") return false;
    card.status = "open";
    card.write = null;
    return true;
  }

  /** 1 回の呼び出しの実績。失敗した呼び出しは数えない（トークンが分からない）。 */
  recordCall(inputTokens: number): void {
    this.calls++;
    this.inputTokens += Math.max(0, inputTokens);
  }
}
