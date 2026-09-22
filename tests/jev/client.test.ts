import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The stubs by their own path: Vitest serves the same module for `obsidian`, and their test-only
// members (`Notice.messages`, `requestUrlMock`) are not on the real typings.
import { Notice, requestUrlMock } from '../mocks/obsidian';
import type { RequestUrlReply } from '../mocks/obsidian';
import { askJev, DEFAULT_JEV_TIMEOUT_MS } from 'src/jev/client';
import type { JevClientConfig, JevRequest } from 'src/jev/client';

const fixtures = fileURLToPath(new URL('../fixtures/jev', import.meta.url));

/** A recorded reply: `status` plus either a JSON `body` or, when it is not valid JSON, raw `bodyText`. */
interface RecordedReply {
  status: number;
  body?: unknown;
  bodyText?: string;
}

function recorded(name: string): RequestUrlReply {
  const reply = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as RecordedReply;
  return { status: reply.status, text: reply.bodyText ?? JSON.stringify(reply.body) };
}

const config: JevClientConfig = {
  apiKey: 'test-key',
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
};

/** The two Choice questions of 設計 §2-3, with the state kept short so the estimate is easy to read. */
const request: JevRequest = {
  state: '習慣はトリガー固定で続く → [[行動デザイン]]',
  questions: {
    field: {
      kind: 'choice',
      instructions: 'このリンクに付けるフィールド',
      criteria: { up: 'より抽象的な相手', origin: '出典', similar: '似た話' },
    },
    direction: {
      kind: 'choice',
      instructions: 'このリンクの方向',
      criteria: { parent: '親', child: '子' },
    },
  },
};

const warnings: unknown[] = [];

describe('askJev', () => {
  beforeEach(() => {
    // The client uses `window.setTimeout` (obsidianmd/prefer-window-timers); this suite runs on the
    // node environment, where the fake timers patch the globals that `window` then resolves to.
    vi.stubGlobal('window', globalThis);
    vi.useFakeTimers();
    requestUrlMock.reset();
    Notice.messages = [];
    warnings.length = 0;
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args[0]); });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts the state and the questions to the endpoint and reads both answers back', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-200.json'));

    const response = await askJev(config, request);

    expect(requestUrlMock.calls).toHaveLength(1);
    const call = requestUrlMock.calls[0];
    expect(call.url).toBe(config.endpoint);
    expect(call.method).toBe('POST');
    expect(call.contentType).toBe('application/json');
    expect(call.headers?.Authorization).toBe('Bearer test-key');
    expect(call.throw).toBe(false);
    expect(JSON.parse(call.body ?? '') as unknown).toEqual({
      model: 'jev-latest',
      state: request.state,
      questions: {
        field: {
          type: 'choice',
          instructions: 'このリンクに付けるフィールド',
          criteria: { up: 'より抽象的な相手', origin: '出典', similar: '似た話' },
        },
        direction: {
          type: 'choice',
          instructions: 'このリンクの方向',
          criteria: { parent: '親', child: '子' },
        },
      },
    });
    // 応答の `answers` を質問の名前で引く辞書にし、`type` は読まない。実応答の形（2026-09-22、E18）。
    expect(response?.questions.field).toEqual({
      choice: 'up',
      probabilities: { up: 0.39, next: 0.14, similar: 0.17, down: 0.3 },
      confidence: 0.19,
    });
    expect(response?.questions.direction.choice).toBe('child');
    // usage は `{ input_tokens, output_tokens }`。出力は無料なので入力だけを持つ（設計 §7）。
    expect(response?.usage).toEqual({ inputTokens: 515 });
    expect(Notice.messages).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('estimates the input tokens from the body it sent when the reply carries no usage', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-no-usage-200.json'));

    const response = await askJev(config, request);

    expect(response?.questions.field.choice).toBe('origin');
    // The criteria travel with the state, so the estimate counts the whole request, not just the state.
    expect(response?.usage).toEqual({ inputTokens: requestUrlMock.calls[0].body?.length });
    expect(response?.usage?.inputTokens).toBeGreaterThan((request.state as string).length);
  });

  it('waits a second after 429 and retries once, then returns the answers', async () => {
    requestUrlMock.respond = (_call, index) =>
      Promise.resolve(recorded(index === 0 ? 'rate-limited-429.json' : 'two-choice-200.json'));

    const pending = askJev(config, request);
    await vi.advanceTimersByTimeAsync(999);
    expect(requestUrlMock.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestUrlMock.calls).toHaveLength(2);

    expect((await pending)?.questions.field.choice).toBe('up');
    expect(Notice.messages).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('gives up after the one retry on 5xx: null, one Notice, one console.warn', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('server-error-503.json'));

    const pending = askJev(config, request);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await pending).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(2);
    expect(Notice.messages).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ fn: 'askJev', message: expect.stringContaining('503') as unknown });
  });

  it('stops waiting at timeoutMs and does not retry', async () => {
    requestUrlMock.respond = () => new Promise<RequestUrlReply>(() => { /* never answers */ });

    let settled = false;
    const pending = askJev(config, request).then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(DEFAULT_JEV_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
    expect(Notice.messages).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ message: expect.stringContaining('timed out') as unknown });
  });

  it('treats a reply it cannot read as a failure and does not retry', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('invalid-json-200.json'));

    expect(await askJev(config, request)).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
    expect(Notice.messages).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ message: expect.stringContaining('unreadable') as unknown });
  });

  it('treats a 200 whose body is not the recorded shape as unreadable', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('wrong-shape-200.json'));

    expect(await askJev(config, request)).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
    expect(Notice.messages).toHaveLength(1);
  });

  it('fails when the reply answers only one of the two questions', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('missing-answer-200.json'));

    expect(await askJev(config, request)).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
    expect(Notice.messages).toHaveLength(1);
  });

  it('does not retry a 4xx that is not 429 (a wrong key must not be asked twice)', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('unauthorized-401.json'));

    expect(await askJev(config, request)).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
    expect(Notice.messages).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ message: expect.stringContaining('401') as unknown });
  });

  it('sends nothing when the endpoint is not https, so the key cannot leak in the clear', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-200.json'));

    expect(await askJev({ ...config, endpoint: 'http://api.typesafe.ai/v1/systemone' }, request)).toBeNull();
    expect(requestUrlMock.calls).toEqual([]);
    expect(Notice.messages).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ message: expect.stringContaining('not https') as unknown });
  });

  it('keeps a "__proto__" key in the reply out of the answers it builds', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('proto-pollution-200.json'));

    const response = await askJev(config, request);

    // Only the questions that were asked, and `__proto__` arrives as a plain key: no setter runs,
    // so nothing is silently dropped and no prototype is replaced.
    expect(Object.keys(response?.questions ?? {})).toEqual(['field', 'direction']);
    expect(Object.keys(response?.questions.field.probabilities ?? {})).toEqual(['up', '__proto__']);
    expect(Object.getPrototypeOf(response?.questions.field.probabilities)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
