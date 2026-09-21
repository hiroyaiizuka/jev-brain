import { Notice, requestUrl } from "obsidian";

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

/** 質問 1 つ。Choice は候補（ラベル→説明文、255 まで）、Score は段階（2〜10）、Noul は yes の確率（設計 §7）。 */
export type JevQuestion =
  | { kind: "choice"; instructions: string; criteria: Record<string, string> }
  | { kind: "score"; instructions: string; steps: number }
  | { kind: "noul"; instructions: string };

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
  questions: Record<string, JevAnswer>;
  /** 費用表示（JEV-3）用。応答が返さなければ state の文字数から見積もった値が入る。 */
  usage?: { inputTokens: number };
}

/**
 * POST /v1/systemone を呼ぶ。429／5xx は 1 秒待って 1 回だけ再試行する。
 * 失敗（タイムアウト・再試行後も失敗・その他の 4xx・読めない応答）は Notice 1 回と console.warn を出して null を返す。
 */
export async function askJev(config: JevClientConfig, request: JevRequest): Promise<JevResponse | null> {
  const body = JSON.stringify(toWireRequest(config, request));
  let result = await callJev(config, body);
  if (result.outcome === "retryable") {
    await delay(RETRY_DELAY_MS);
    result = await callJev(config, body);
  }
  if (result.outcome !== "ok") {
    new Notice("Jev request failed. See the developer console for details.", 5000);
    console.warn({ plugin: "ExcaliBrain", fn: "askJev", message: result.reason });
    return null;
  }
  return withUsage(result.response, request.state);
}

/** `retryable` は 429／5xx だけ。タイムアウトも読めない応答も、もう一度聞いても同じなので `failed`。 */
type CallResult =
  | { outcome: "ok"; response: JevResponse }
  | { outcome: "retryable"; reason: string }
  | { outcome: "failed"; reason: string };

async function callJev(config: JevClientConfig, body: string): Promise<CallResult> {
  let response: { status: number; text: string };
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
  if (response.status === 429 || response.status >= 500) {
    return { outcome: "retryable", reason: `HTTP ${response.status}` };
  }
  if (response.status >= 400) {
    return { outcome: "failed", reason: `HTTP ${response.status}` };
  }
  const parsed = parseResponseBody(response.text);
  if (!parsed) {
    return { outcome: "failed", reason: `unreadable response body: ${response.text.slice(0, 200)}` };
  }
  return { outcome: "ok", response: parsed };
}

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
  switch (question.kind) {
    case "choice":
      return { type: "choice", instructions: question.instructions, criteria: question.criteria };
    case "score":
      return { type: "score", instructions: question.instructions, steps: question.steps };
    case "noul":
      return { type: "noul", instructions: question.instructions };
  }
}

function parseResponseBody(text: string): JevResponse | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body) || !isRecord(body.questions)) return null;
  const questions: Record<string, JevAnswer> = {};
  for (const [name, value] of Object.entries(body.questions)) {
    const answer = toAnswer(value);
    if (!answer) return null;
    questions[name] = answer;
  }
  const usage = isRecord(body.usage) && typeof body.usage.inputTokens === "number"
    ? { inputTokens: body.usage.inputTokens }
    : undefined;
  return usage ? { questions, usage } : { questions };
}

function toAnswer(value: unknown): JevAnswer | null {
  if (!isRecord(value)) return null;
  const { choice, confidence } = value;
  if (typeof choice !== "string" || typeof confidence !== "number" || !isRecord(value.probabilities)) return null;
  const probabilities: Record<string, number> = {};
  for (const [label, probability] of Object.entries(value.probabilities)) {
    if (typeof probability !== "number") return null;
    probabilities[label] = probability;
  }
  return { choice, probabilities, confidence };
}

function withUsage(response: JevResponse, state: JevRequest["state"]): JevResponse {
  if (response.usage) return response;
  return { ...response, usage: { inputTokens: estimateInputTokens(state) } };
}

/**
 * 応答が usage を返さないときの概算。state の文字数をそのままトークン数とみなす暫定値で、
 * 日本語の実測（JEV-0、設計 §2-2・§10）が出たら置き換える。費用表示にしか使わない。
 */
function estimateInputTokens(state: JevRequest["state"]): number {
  return (typeof state === "string" ? state : JSON.stringify(state)).length;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

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
