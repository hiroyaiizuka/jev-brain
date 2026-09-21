import { Notice, requestUrl } from "obsidian";
import { sleep } from "src/utils/utils";

/**
 * Jev（TypeSafe の判定専用モデル）への唯一の通信経路（docs/jev-link-typer-design.md §7・§9）。
 * ネットワークはこのファイルだけに閉じ、設定の型には依存しない（呼び出し側が JevClientConfig を組む）。
 *
 * リクエストとレスポンスの形は設計 §7 の公開情報どまりで、正式な形はキー発行後に照合する（設計 §11）。
 * 違っていたときにこのファイルと tests/fixtures/jev/ だけを直せばよいように、ワイヤ形式との変換は
 * toWireRequest と parseResponseBody の 2 か所に閉じる。
 */

/** タイムアウトの既定値。設定には持たせず、呼び出し側がこの値を JevClientConfig に入れる。 */
export const DEFAULT_JEV_TIMEOUT_MS = 10_000;

/** 429／5xx のときに 1 度だけ置く間隔。 */
const RETRY_DELAY_MS = 1_000;

export interface JevClientConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
}

/**
 * 質問 1 つ。criteria は候補のラベル → 説明文（255 まで、設計 §7）。
 * Jev には Score と Noul もあるが、答えの形（下の JevAnswer）が Choice のものなので、
 * 使うのが決まっている JEV-5 で答えの形と一緒に足す。
 */
export interface JevQuestion {
  kind: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevRequest {
  /** 判定の材料（設計 §2-2）。文字列でも JSON でもよい。 */
  state: string | Record<string, unknown>;
  /** 質問の名前 → 質問。1 回の呼び出しに入れた質問を Jev は並列に評価する。 */
  questions: Record<string, JevQuestion>;
}

/** 質問 1 つへの答え。probabilities は候補のラベル → 確率。 */
export interface JevAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevResponse {
  /** 聞いた質問がすべて揃っている。揃わない応答は失敗として扱う。 */
  questions: Record<string, JevAnswer>;
  /** 費用表示（JEV-3）用。応答が返さなければ送った本文の文字数から見積もった値が入る。 */
  usage?: { inputTokens: number };
}

/**
 * POST /v1/systemone を呼ぶ。429／5xx は 1 秒待って 1 回だけ再試行する。
 * 失敗（タイムアウト・再試行後も失敗・その他の 4xx・読めない応答）は Notice 1 回と console.warn を出して null を返す。
 * この関数は投げない。
 */
export async function askJev(config: JevClientConfig, request: JevRequest): Promise<JevResponse | null> {
  // endpoint は設定で変えられる（設計 §6）。requestUrl は CORS も混在コンテンツの制限も迂回するので、
  // http のままだと API キーが平文で出ていく。唯一の送信口であるここで止める。
  if (!config.endpoint.toLowerCase().startsWith("https://")) {
    return reportFailure(config, `endpoint is not https: ${config.endpoint}`);
  }
  const asked = Object.keys(request.questions);
  let body: string;
  try {
    body = JSON.stringify(toWireRequest(config, request));
  } catch (error) {
    return reportFailure(config, error instanceof Error ? error.message : "could not build the request");
  }
  let result = await callJev(config, body, asked);
  if (result.outcome === "retryable") {
    await sleep(RETRY_DELAY_MS);
    result = await callJev(config, body, asked);
  }
  if (result.outcome !== "ok") return reportFailure(config, result.reason);
  if (result.response.usage) return result.response;
  // 送った本文の文字数をそのままトークン数とみなす暫定値。日本語の実測（JEV-0、設計 §10）で置き換える。
  return { ...result.response, usage: { inputTokens: body.length } };
}

/** 失敗の出口はここだけ。Notice 1 回と console.warn 1 回で、API キーは書かない。 */
function reportFailure(config: JevClientConfig, reason: string): null {
  new Notice("Jev request failed. See the developer console for details.", 5000);
  console.warn({ plugin: "ExcaliBrain", fn: "askJev", where: config.endpoint, message: reason });
  return null;
}

/** `retryable` は 429／5xx だけ。タイムアウトも読めない応答も、もう一度聞いても同じなので `failed`。 */
type CallResult =
  | { outcome: "ok"; response: JevResponse }
  | { outcome: "retryable"; reason: string }
  | { outcome: "failed"; reason: string };

async function callJev(config: JevClientConfig, body: string, asked: string[]): Promise<CallResult> {
  let response: { status: number; text?: string };
  try {
    response = await withTimeout(
      requestUrl({
        url: config.endpoint,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body,
        // 状態コードで再試行を決めるので、400 以上でも requestUrl には投げさせない。
        throw: false,
      }),
      config.timeoutMs,
    );
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : "request failed" };
  }
  const text = response.text ?? "";
  if (response.status === 429 || response.status >= 500) {
    return { outcome: "retryable", reason: `HTTP ${response.status}: ${snippet(text)}` };
  }
  if (response.status >= 400) {
    return { outcome: "failed", reason: `HTTP ${response.status}: ${snippet(text)}` };
  }
  const parsed = parseResponseBody(text, asked);
  if (!parsed) {
    return { outcome: "failed", reason: `unreadable response body: ${snippet(text)}` };
  }
  return { outcome: "ok", response: parsed };
}

/** 原因を切り分けられるだけの長さ。API キーは送る側にしか無いので応答には出ない。 */
const snippet = (text: string): string => text.slice(0, 200);

function toWireRequest(config: JevClientConfig, request: JevRequest): Record<string, unknown> {
  return {
    model: config.model,
    state: request.state,
    questions: Object.fromEntries(
      Object.entries(request.questions).map(([name, question]) => [name, toWireQuestion(question)]),
    ),
  };
}

function toWireQuestion(question: JevQuestion): Record<string, unknown> {
  return { type: question.kind, instructions: question.instructions, criteria: question.criteria };
}

/**
 * 聞いた質問（asked）の答えだけを取り出す。1 つでも欠けていたり形が違えば null（＝呼び出しの失敗）にする。
 * 呼び出し側は 2 問揃っている前提で整合性を見る（設計 §2-3）ので、半端な応答を通すと そこで落ちる。
 * 応答のキーを列挙せず asked から引くので、`__proto__` のようなキーが混じっても組み立てに入らない。
 */
function parseResponseBody(text: string, asked: string[]): JevResponse | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body) || !isRecord(body.questions)) return null;
  const answered: [string, JevAnswer][] = [];
  for (const name of asked) {
    const answer = toAnswer(body.questions[name]);
    if (!answer) return null;
    answered.push([name, answer]);
  }
  const usage = isRecord(body.usage) && typeof body.usage.inputTokens === "number"
    ? { inputTokens: body.usage.inputTokens }
    : undefined;
  const questions = Object.fromEntries(answered);
  return usage ? { questions, usage } : { questions };
}

function toAnswer(value: unknown): JevAnswer | null {
  if (!isRecord(value)) return null;
  const { choice, confidence } = value;
  if (typeof choice !== "string" || typeof confidence !== "number" || !isRecord(value.probabilities)) return null;
  const probabilities: [string, number][] = [];
  for (const [label, probability] of Object.entries(value.probabilities)) {
    if (typeof probability !== "number") return null;
    probabilities.push([label, probability]);
  }
  return { choice, probabilities: Object.fromEntries(probabilities), confidence };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** requestUrl は中断できないので、待つのをやめるだけ。打ち切ったあとに届いた応答は捨てる。 */
function withTimeout<T>(pending: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    pending.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("request failed"));
      },
    );
  });
}
