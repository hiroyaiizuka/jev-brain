/**
 * The judge half of JEV-0 (docs/product-plan.md §3「JEV-0」, design §10): ask Jev the two questions
 * of design §2-3 about every truth record `extract` wrote, and turn the answers into the accuracy
 * tables of `artifacts/jev-accuracy/record.md`.
 *
 * The state and the questions are not written twice: this module bundles `src/jev/state.ts` and
 * `src/jev/judge.ts` with esbuild and calls them, so what the measurement asks is what the plugin
 * will ask. Only the wire format and the network live here — `src/jev/client.ts` speaks through
 * Obsidian's `requestUrl`, which has no meaning in Node.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { RECORD_NAME, readHierarchy, renderRecord, resolveOutputPath } from './jev-accuracy.mjs';

export const RESPONSES_NAME = 'responses.jsonl';

/** Names the two questions are sent and answered under; they come from src/jev/judge.ts. */
const FIELD_QUESTION = 'field';
const DIRECTION_QUESTION = 'direction';

/** Labels for the record. src/jev/judge.ts spells the six directions in camel case. */
const DIRECTION_LABELS = {
  parent: '親',
  child: '子',
  leftFriend: '左友',
  rightFriend: '右友',
  previous: '前',
  next: '次',
};

export const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];

/**
 * How far down the candidates the right field is. The suggester and the queue (JEV-2, JEV-3) show a
 * list, not one answer, so their worth is decided by these, not by the first candidate alone.
 */
export const RANKS = [1, 3, 5, 10];

/** 429 and 5xx are worth asking again; client.ts waits once, a 500-link run can afford two. */
const RETRY_DELAYS_MS = [1_000, 3_000];
const TIMEOUT_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * `src/jev/state.ts` and `src/jev/judge.ts` as a Node module. They are pure TypeScript with no
 * Obsidian import, so esbuild can bundle them as they are; `obsidian` stays external as a guard —
 * a future import of it would fail the bundle here rather than drift silently.
 */
export async function loadJevSource(root) {
  const esbuild = await import('esbuild');
  const directory = mkdtempSync(join(tmpdir(), 'jev-accuracy-'));
  const outfile = join(directory, 'jev-source.mjs');
  await esbuild.build({
    stdin: {
      contents: [
        "export { buildState } from './src/jev/state';",
        "export { buildQuestions, judge, directionOfField } from './src/jev/judge';",
        "export { buildHierarchyLowerCase, toHierarchyKey } from './src/utils/hierarchy';",
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'jev-accuracy-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['obsidian'],
    outfile,
    logLevel: 'silent',
  });
  const loaded = await import(pathToFileURL(outfile).href);
  rmSync(directory, { recursive: true, force: true });
  return loaded;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The start of the line `index` falls on. */
const lineStart = (text, index) => text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;

/**
 * Takes the answer out of the state. The truth is a link that is already typed, and its field name
 * sits immediately in front of it (`up:: [[X]]`), so an unmasked run only measures whether Jev can
 * read. What is hidden is this one link's own marker — the fields of the rest of the note stay, as
 * they would in a real judgement (§2-2).
 *
 * - `line`, `relations`, `inline`: the `<field> ::` that ends the text before the link.
 * - `frontmatter`: the key's line and everything under it up to the link, plus the key itself.
 */
export function maskEntry(entry) {
  if (entry.source === 'frontmatter') {
    const key = new RegExp(`(^|\\n)[ \\t]*${escapeRegExp(entry.marker)}[ \\t]*:`, 'g');
    const matches = [...entry.contextBefore.matchAll(key)];
    const cut = matches.length > 0
      ? lineStart(entry.contextBefore, matches[matches.length - 1].index + matches[matches.length - 1][0].length)
      : lineStart(entry.contextBefore, entry.contextBefore.length);
    return { contextBefore: entry.contextBefore.slice(0, cut), frontmatter: dropKey(entry.noteFrontmatter, entry.marker) };
  }
  const marker = new RegExp(`${escapeRegExp(entry.marker)}[ \\t]*::[ \\t]*$`);
  return { contextBefore: entry.contextBefore.replace(marker, ''), frontmatter: entry.noteFrontmatter };
}

/** The frontmatter text without one key, so a frontmatter link's own field never reaches the state. */
function dropKey(frontmatter, key) {
  if (typeof frontmatter !== 'string' || frontmatter === '') return frontmatter;
  const lines = frontmatter.split('\n');
  const kept = [];
  let dropping = false;
  const opensKey = /^([^\s#-][^:]*):/;
  for (const line of lines) {
    const opened = line.match(opensKey);
    if (opened) dropping = opened[1].trim() === key.trim();
    if (!dropping) kept.push(line);
  }
  return kept.join('\n');
}

/** A frontmatter block as Obsidian hands it to the plugin: an object, or null when it does not parse. */
export function parseFrontmatter(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    const parsed = parseYaml(text, { uniqueKeys: false });
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * One truth record as the state of design §2-2, through the plugin's own `buildState`. The window
 * is rebuilt from what `extract` kept (`contextBefore` + the link + `contextAfter`), which is the
 * same slice `buildState` would cut out of the note itself.
 *
 * `currentField` is deliberately not passed: this measures typing a bare link, not the review of
 * §5. Handing the current field in would be asking Jev to repeat it.
 */
export function buildJudgeState(jev, entry, { contextChars, mask }) {
  const { contextBefore, frontmatter } = mask === 'on'
    ? maskEntry(entry)
    : { contextBefore: entry.contextBefore, frontmatter: entry.noteFrontmatter };
  return jev.buildState({
    note: { frontmatter: parseFrontmatter(frontmatter), text: contextBefore + entry.linkText + entry.contextAfter },
    link: { target: entry.target, offset: contextBefore.length, length: entry.linkText.length },
    targetNote: entry.targetPath === null
      ? null
      : { frontmatter: parseFrontmatter(entry.targetFrontmatter), text: entry.targetExcerpt ?? '' },
    contextChars,
  });
}

/**
 * The request body. `judge.ts` calls the text of a question `question`; the endpoint calls it
 * `instructions` and wants the kind of question with it (design §7), which is the conversion
 * `src/jev/client.ts` owns for the plugin.
 */
export function toWireRequest(model, state, questions) {
  return {
    model,
    state,
    questions: Object.fromEntries(
      Object.entries(questions).map(([name, choice]) => [
        name,
        { type: 'choice', instructions: choice.question, criteria: choice.criteria },
      ]),
    ),
  };
}

/**
 * The answers of one response, in the shape `src/jev/judge.ts` reads.
 *
 * The endpoint returns `{ model, answers: { <name>: { type, choice, confidence, probabilities } } }`
 * (design §7, checked on the real endpoint by E18). `src/jev/client.ts` reads the same shape for the
 * plugin, but it speaks through Obsidian's `requestUrl`, so Node cannot borrow it and the reading is
 * repeated here. The two are held together by the recorded response both tests use,
 * `tests/fixtures/jev/two-choice-200.json`.
 *
 * A response that is missing one of the two questions, or that answers with something other than a
 * choice and its numeric probabilities, is a failed call: §2-3 compares the two answers and half a
 * response cannot be compared.
 */
export function readAnswers(body, asked) {
  if (!isRecord(body)) return null;
  const answers = isRecord(body.answers) ? body.answers : null;
  if (!answers) return null;
  const read = [];
  for (const name of asked) {
    const answer = answers[name];
    if (!isRecord(answer) || typeof answer.choice !== 'string' || !isRecord(answer.probabilities)) return null;
    const probabilities = [];
    for (const [label, probability] of Object.entries(answer.probabilities)) {
      if (typeof probability !== 'number') return null;
      probabilities.push([label, probability]);
    }
    read.push([name, {
      choice: answer.choice,
      probabilities: Object.fromEntries(probabilities),
      confidence: typeof answer.confidence === 'number' ? answer.confidence : null,
    }]);
  }
  return { questions: Object.fromEntries(read) };
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The token counts of one response: `usage: { input_tokens, output_tokens }` in snake case (design
 * §7). The camel case spelling is read as well, since that is what the shape was taken for before a
 * key existed and what `client.ts` hands on internally. Only the input is charged.
 */
export function usageOf(body) {
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : null;
  if (!usage) return null;
  const input = [usage.input_tokens, usage.inputTokens].find((value) => typeof value === 'number');
  if (input === undefined) return null;
  const output = [usage.output_tokens, usage.outputTokens].find((value) => typeof value === 'number');
  return { input, output: output ?? 0 };
}

/** mulberry32: the sample must be the same on a second run, or the saved answers would not line up. */
function randomWith(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The truth records Jev can be scored on: the ones whose field the ontology knows, since Q1 only
 * ever offers those. The sample is a seeded shuffle, not the first N, because the entries come out
 * of `extract` note by note and the first N would be one corner of the vault.
 */
export function selectEntries(entries, { directionOfField, hierarchy, limit, seed }) {
  const eligible = entries.filter((entry) => directionOfField(entry.field, hierarchy) !== null);
  const shuffled = [...eligible];
  const random = randomWith(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return { eligible: eligible.length, skipped: entries.length - eligible.length, sample: limit > 0 ? shuffled.slice(0, limit) : shuffled };
}

const hashOf = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * The answers kept from earlier runs, by truth record and request. The request is hashed, so a
 * changed ontology, a changed mask or a changed context length asks again instead of scoring an
 * answer to a different question.
 */
export function readResponses(path) {
  const saved = new Map();
  if (!existsSync(path)) return saved;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record && typeof record.id === 'string' && record.ok) saved.set(`${record.id}:${record.requestHash}`, record);
  }
  return saved;
}

/** One call. Mirrors client.ts: 429 and 5xx are retried, everything else is the answer or a failure. */
async function callJev({ endpoint, apiKey, body }) {
  let last = 'no attempt';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      last = error instanceof Error ? error.message : 'request failed';
      continue;
    }
    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      last = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      continue;
    }
    if (response.status >= 400) return { ok: false, status: response.status, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    try {
      return { ok: true, status: response.status, body: JSON.parse(text) };
    } catch {
      return { ok: false, status: response.status, error: `unreadable response body: ${text.slice(0, 200)}` };
    }
  }
  return { ok: false, status: 0, error: last };
}

/** Runs `worker` over `items` with at most `concurrency` in flight, keeping the input order. */
async function inParallel(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Where the right field sits when the candidates are put in probability order, or null when it is absent. */
const rankOf = (probabilities, field, toKey) => {
  const key = toKey(field ?? '');
  const ordered = Object.entries(probabilities ?? {})
    .sort((left, right) => right[1] - left[1])
    .map(([candidate]) => toKey(candidate));
  const index = ordered.indexOf(key);
  return index === -1 ? null : index + 1;
};

/** The probability the response gave one label, matched the way a field name is matched. */
const probabilityOf = (probabilities, label, toKey) => {
  const key = toKey(label ?? '');
  if (!probabilities || key === '') return null;
  const found = Object.entries(probabilities).find(([candidate]) => toKey(candidate) === key);
  return found && Number.isFinite(found[1]) ? found[1] : null;
};

/**
 * Scores one answered record: what the note says (`field`, and the direction the ontology gives it)
 * against what Jev answered, read by the plugin's own `judge`.
 */
export function scoreRow(jev, hierarchy, entry, response) {
  const judgement = jev.judge(response, hierarchy);
  const expected = jev.directionOfField(entry.field, hierarchy);
  const probability = probabilityOf(judgement.probabilities, judgement.field, jev.toHierarchyKey) ?? 0;
  return {
    id: entry.id,
    source: entry.source,
    truthField: entry.field,
    truthDirection: expected,
    field: judgement.field,
    direction: judgement.direction,
    probability,
    directionProbability: judgement.directionProbability,
    confident: judgement.confident,
    rank: rankOf(judgement.probabilities, entry.field, jev.toHierarchyKey),
    fieldMatch: jev.toHierarchyKey(judgement.field) === jev.toHierarchyKey(entry.field),
    directionMatch: judgement.direction === expected,
  };
}

const ratio = (part, whole) => (whole === 0 ? 0 : part / whole);

/** Field and direction agreement over a set of rows. */
const agreement = (rows) => ({
  count: rows.length,
  fieldRate: ratio(rows.filter((row) => row.fieldMatch).length, rows.length),
  directionRate: ratio(rows.filter((row) => row.directionMatch).length, rows.length),
});

/**
 * Every number the record shows. `thresholds` is read twice: on the first candidate's probability
 * alone, and with the consistency check of §2-3 as well, which is the condition design §2-4 puts on
 * the bulk auto-confirm.
 */
export function summarizeJudgements(rows, { failures, selection, tokens, price, rate }) {
  const confident = rows.filter((row) => row.confident);
  const thresholds = THRESHOLDS.map((threshold) => {
    const above = rows.filter((row) => row.probability >= threshold);
    const both = above.filter((row) => row.confident);
    return {
      threshold,
      coverage: ratio(above.length, rows.length),
      precision: ratio(above.filter((row) => row.fieldMatch).length, above.length),
      count: above.length,
      confidentCoverage: ratio(both.length, rows.length),
      confidentPrecision: ratio(both.filter((row) => row.fieldMatch).length, both.length),
      confidentCount: both.length,
    };
  });

  const pairs = new Map();
  for (const row of rows) {
    if (row.fieldMatch) continue;
    const key = `${row.truthField} ${row.field}`;
    const pair = pairs.get(key) ?? { truth: row.truthField, answer: row.field, count: 0, sameDirection: 0 };
    pair.count += 1;
    if (row.directionMatch) pair.sameDirection += 1;
    pairs.set(key, pair);
  }
  const confusion = [...pairs.values()]
    .sort((left, right) => right.count - left.count || (left.truth > right.truth ? 1 : -1))
    .slice(0, 10);

  const directions = Object.keys(DIRECTION_LABELS).map((direction) => ({
    direction,
    ...agreement(rows.filter((row) => row.truthDirection === direction)),
  })).filter((row) => row.count > 0);

  const ranks = RANKS.map((rank) => ({
    rank,
    hit: ratio(rows.filter((row) => row.rank !== null && row.rank <= rank).length, rows.length),
  }));

  const judged = rows.length;
  const total = (values) => values.reduce((sum, value) => sum + value, 0);
  const totalTokens = total(tokens.input);
  const reportedCalls = tokens.input.length;
  const averageTokens = ratio(totalTokens, reportedCalls);
  const averageOutputTokens = ratio(total(tokens.output), tokens.output.length);
  const averageRequestChars = ratio(total(tokens.requestChars), tokens.requestChars.length);
  const averageStateChars = ratio(total(tokens.stateChars), tokens.stateChars.length);
  // Design §7: $0.042 per million input tokens, output free.
  const costPerCall = (averageTokens * price) / 1e6;

  return {
    judged,
    failures,
    selection,
    overall: agreement(rows),
    // The half of the misses that would still put the link on the right side of the graph.
    directionOnly: ratio(rows.filter((row) => !row.fieldMatch && row.directionMatch).length, judged),
    consistency: { confident: agreement(confident), unconfident: agreement(rows.filter((row) => !row.confident)) },
    thresholds,
    ranks,
    confusion,
    directions,
    tokens: {
      calls: tokens.calls,
      reportedCalls,
      totalTokens,
      averageTokens,
      averageOutputTokens,
      averageRequestChars,
      averageStateChars,
    },
    cost: {
      price,
      rate,
      costPerCall,
      totalUsd: costPerCall * reportedCalls,
      totalYen: costPerCall * reportedCalls * rate,
      perCallYen: costPerCall * rate,
    },
  };
}

const percentage = (value) => `${(value * 100).toFixed(1)}%`;
const yen = (value) => `${value.toFixed(2)} 円`;

/** The judge half of `artifacts/jev-accuracy/record.md`. */
export function renderJudgeRecord(summary, context) {
  const { selection, overall, consistency, tokens, cost } = summary;
  const lines = [
    '## Jev の判定（LEV-163）',
    '',
    '| 項目 | 値 |',
    '| --- | --- |',
    `| 実行 | ${context.at} |`,
    `| endpoint / model | \`${context.endpoint}\` / \`${context.model}\` |`,
    `| 対象 | 正解 ${selection.total} 件のうちオントロジー内 ${selection.eligible} 件（外の ${selection.skipped} 件は Q1 の候補に無いので除外） |`,
    `| 判定 | ${summary.judged} 件（seed ${context.seed} の並べ替えから ${context.limit > 0 ? `先頭 ${context.limit}` : '全件'}、並列 ${context.concurrency}） |`,
    `| state | 前後 ${context.contextChars} 字・相手の冒頭 300 字。フィールド名の伏せ字: ${context.mask === 'on' ? 'あり' : '**なし（対照）**'} |`,
    `| 失敗 | ${summary.failures.length} 件 |`,
    '',
    '### 一致率',
    '',
    '| 指標 | 値 |',
    '| --- | --- |',
    `| フィールド一致率 | ${percentage(overall.fieldRate)}（${Math.round(overall.fieldRate * overall.count)} / ${overall.count}） |`,
    `| 方向一致率 | ${percentage(overall.directionRate)} |`,
    `| フィールドは外したが方向は合っている | ${percentage(summary.directionOnly)} |`,
    '',
    '確率の高い順に候補を並べたとき、正解が上位何番目までに入るか（サジェスターとキューが出すのは 1 件ではなく一覧）。',
    '',
    `| ${summary.ranks.map((row) => `上位 ${row.rank}`).join(' | ')} |`,
    `| ${summary.ranks.map(() => '---').join(' | ')} |`,
    `| ${summary.ranks.map((row) => percentage(row.hit)).join(' | ')} |`,
    '',
    '### しきい値ごとの適合率と対象率',
    '',
    'Q1 第一候補の確率がしきい値以上のもの。「＋自信あり」は設計 §2-3 の整合性チェックも満たすもの（§2-4 の一括自動確定の条件）。',
    '',
    '| しきい値 | 対象率 | 適合率 | 件数 | ＋自信あり 対象率 | ＋自信あり 適合率 | 件数 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summary.thresholds.map((row) => `| ${row.threshold.toFixed(1)} | ${percentage(row.coverage)} | `
      + `${percentage(row.precision)} | ${row.count} | ${percentage(row.confidentCoverage)} | `
      + `${percentage(row.confidentPrecision)} | ${row.confidentCount} |`),
    '',
    '### 整合性チェック別',
    '',
    '| 整合性 | 件数 | 割合 | フィールド一致率 | 方向一致率 |',
    '| --- | --- | --- | --- | --- |',
    `| 自信あり | ${consistency.confident.count} | ${percentage(ratio(consistency.confident.count, summary.judged))} `
      + `| ${percentage(consistency.confident.fieldRate)} | ${percentage(consistency.confident.directionRate)} |`,
    `| 自信なし | ${consistency.unconfident.count} | ${percentage(ratio(consistency.unconfident.count, summary.judged))} `
      + `| ${percentage(consistency.unconfident.fieldRate)} | ${percentage(consistency.unconfident.directionRate)} |`,
    '',
    '### 混同の多い組（上位 10）',
    '',
    '| 正解 | Jev の答え | 件数 | うち方向は一致 |',
    '| --- | --- | --- | --- |',
    ...summary.confusion.map((row) => `| ${row.truth} | ${row.answer} | ${row.count} | ${row.sameDirection} |`),
    '',
    '### 正解の方向別',
    '',
    '| 方向 | 件数 | フィールド一致率 | 方向一致率 |',
    '| --- | --- | --- | --- |',
    ...summary.directions.map((row) => `| ${DIRECTION_LABELS[row.direction]} | ${row.count} `
      + `| ${percentage(row.fieldRate)} | ${percentage(row.directionRate)} |`),
    '',
    '### トークン数と費用の実績',
    '',
    '| 項目 | 値 |',
    '| --- | --- |',
    `| 送信した本文 | 平均 ${Math.round(tokens.averageRequestChars)} 字（うち state ${Math.round(tokens.averageStateChars)} 字） |`,
    tokens.reportedCalls > 0
      ? `| 入力トークン | 平均 ${Math.round(tokens.averageTokens)}（応答の \`usage.input_tokens\`、${tokens.reportedCalls} 件の実測。`
        + `設計 §7 の見積もり 2,000 との比 ${(tokens.averageTokens / 2000).toFixed(2)} 倍） |`
      : '| 入力トークン | 応答が usage を返さないので不明 |',
    tokens.reportedCalls > 0
      ? `| 出力トークン | 平均 ${Math.round(tokens.averageOutputTokens)}（無料。§7） |`
      : '| 出力トークン | 不明 |',
    `| 単価 | $${cost.price}/M 入力トークン、${cost.rate} 円/$（設計 §7） |`,
    tokens.reportedCalls > 0
      ? `| 費用 | 1 判定 ${yen(cost.perCallYen)}、${tokens.reportedCalls} 件で ${yen(cost.totalYen)}（$${cost.totalUsd.toFixed(4)}）。`
        + `うちこの実行で新たに呼んだのは ${tokens.calls} 回で、残りは \`${RESPONSES_NAME}\` の保存済みの応答 |`
      : '| 費用 | usage が無いので実測できない |',
  ];
  if (tokens.reportedCalls > 0) {
    lines.push(`| Vault 全体の見込み | オントロジー内 ${selection.eligible} 件で ${yen(cost.perCallYen * selection.eligible)} |`);
  }
  lines.push('', ...context.notes, '');
  return lines.join('\n');
}

/**
 * What the endpoint actually takes and returns. Design §7 was written from public information before
 * a key existed; this is the run that checked it (§11「未確認」).
 */
function shapeNotes() {
  return [
    '### 応答の形',
    '',
    '送ったもの（200 が返る。§7 のとおり）:',
    '',
    '```json',
    '{"model":"jev-latest","state":"…","questions":{"field":{"type":"choice","instructions":"…","criteria":{"up":"…"}}}}',
    '```',
    '',
    '返ってきたもの:',
    '',
    '```json',
    '{"model":"jev-1.13.0","answers":{"field":{"type":"choice","choice":"up","confidence":0.19,"probabilities":{"up":0.19}}},'
      + '"usage":{"input_tokens":4371,"output_tokens":1376}}',
    '```',
    '',
    '- 設計 §7 と実機 E18（LEV-170）の記録どおりの形。このスクリプトは Node から `fetch` するので',
    '  `src/jev/client.ts`（Obsidian の `requestUrl`）は使えず、読み取りだけを持つ。突き合わせは両方のテストが',
    '  使う `tests/fixtures/jev/two-choice-200.json`。',
    '- §7 は「`probabilities` に送った候補が全部そろうとは限らない」と書いているが、この 600 回では',
    '  Q1 162 候補・Q2 6 方向がすべて返り、欠けは 1 件も出ていない。',
    '- 1 回の呼び出しは 1.4 秒ほど。並列 5 で 500 件が数分。',
    '',
  ];
}

/** Everything the record says about how the run was made, so the numbers can be read a month later. */
function recordNotes(context) {
  return [
    '### 読み方と注意',
    '',
    `- 正解は本人の Vault の型付きリンクそのもの。state は \`src/jev/state.ts\` の \`buildState\`、質問は \`src/jev/judge.ts\` の`,
    '  `buildQuestions`、答えの読みは同じく `judge` を esbuild でバンドルして呼んでいる（このスクリプトに写していない）ので、',
    '  プラグインが実際に聞くものと同じ。ネットワークと本文の組み立てだけがスクリプト側にある。',
    context.mask === 'on'
      ? '- 正解のリンクは `up:: [[X]]` のように答えが直前に書いてある。判定ではその 1 本ぶんの `フィールド::`（frontmatter なら'
        + 'そのキー）だけを state から外した。同じノートの他のフィールドは §2-2 どおり残している。'
      : '- **対照実行**: フィールド名を伏せていない。答えが state に書いてあるので、一致率は上限の目安でしかない。',
    '- 「見直し」（§5）ではないので、現在のフィールドは state に入れていない。',
    '- 正解はノートに書いてある 1 つのフィールドだけ。このオントロジーは `Source`／`author`／`origin`／`up` のように',
    '  意味の重なる語が多いので、「別の語だが妥当」も不一致として数えている（混同の表の「うち方向は一致」がその目安）。',
    '- 上位 k は応答の確率そのものの順。設計 §2-3 は「自信なし」のとき確率を伏せて設定の順で出すので、UI がこの順で',
    '  並べられるのは「自信あり」の行だけ。',
    '- Vault の本文・生の応答・API キーはこの記録に写していない。`truth.json` と `responses.jsonl` は `artifacts/`（gitignore）にある。',
  ];
}

/**
 * `node scripts/jev-accuracy.mjs judge`: read the truth, ask Jev about a sample of it, and write
 * the record next to the truth file. Answers already in `responses.jsonl` are not asked again.
 */
export async function runJudge(root, options) {
  const truthPath = resolveOutputPath(root, options.truth);
  if (!existsSync(truthPath)) throw new Error(`No truth file at ${truthPath}. Run extract first.`);
  const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
  const directory = dirname(truthPath);
  // The record and the saved answers sit next to the truth unless the run says otherwise (a control run).
  const responsesPath = resolveOutputPath(root, options.responses ?? join(directory, RESPONSES_NAME));
  const recordPath = resolveOutputPath(root, options.record ?? join(directory, RECORD_NAME));

  const jev = await loadJevSource(root);
  const definition = options.hierarchy ? readHierarchy(null, options.hierarchy).definition : truth.hierarchyDefinition;
  const { hierarchy } = jev.buildHierarchyLowerCase(definition);
  const questions = jev.buildQuestions(hierarchy);
  const asked = [FIELD_QUESTION, DIRECTION_QUESTION];

  const { eligible, skipped, sample } = selectEntries(truth.entries, {
    directionOfField: jev.directionOfField,
    hierarchy,
    limit: options.limit,
    seed: options.seed,
  });
  if (sample.length === 0) throw new Error('Nothing to judge: no truth record uses a field of this ontology.');

  const saved = readResponses(responsesPath);
  const apiKey = process.env.JEV_API_KEY ?? '';
  const asks = sample.map((entry) => {
    const state = buildJudgeState(jev, entry, { contextChars: truth.contextChars, mask: options.mask });
    const body = JSON.stringify(toWireRequest(options.model, state, questions));
    return { entry, state, body, requestHash: hashOf(body) };
  });
  const missing = asks.filter((ask) => !saved.has(`${ask.entry.id}:${ask.requestHash}`)).length;
  if (missing > 0 && apiKey === '') {
    throw new Error(`JEV_API_KEY is not set and ${missing} of ${asks.length} answers are not in ${responsesPath}.`);
  }
  for (const path of new Set([responsesPath, recordPath].map(dirname))) mkdirSync(path, { recursive: true });

  let done = 0;
  const answered = await inParallel(asks, options.concurrency, async (ask) => {
    const key = `${ask.entry.id}:${ask.requestHash}`;
    const cached = saved.get(key);
    const result = cached
      ? { ok: true, status: cached.status, body: cached.body, cached: true }
      : await callJev({ endpoint: options.endpoint, apiKey, body: ask.body });
    if (!result.cached) {
      appendFileSync(responsesPath, `${JSON.stringify({
        id: ask.entry.id,
        at: new Date().toISOString(),
        requestHash: ask.requestHash,
        mask: options.mask,
        model: options.model,
        stateChars: ask.state.length,
        requestChars: ask.body.length,
        status: result.status,
        ok: result.ok,
        ...(result.ok ? { body: result.body } : { error: result.error }),
      })}\n`, { mode: 0o600 });
    }
    done += 1;
    if (done % 25 === 0 || done === asks.length) process.stderr.write(`\r判定 ${done}/${asks.length}`);
    return { ask, result };
  });
  process.stderr.write('\n');

  const rows = [];
  const failures = [];
  const tokens = { calls: 0, input: [], output: [], requestChars: [], stateChars: [] };
  for (const { ask, result } of answered) {
    if (!result.cached) tokens.calls += 1;
    if (!result.ok) {
      failures.push({ id: ask.entry.id, error: result.error });
      continue;
    }
    const response = readAnswers(result.body, asked);
    if (!response) {
      failures.push({ id: ask.entry.id, error: `unexpected response shape: ${JSON.stringify(result.body).slice(0, 200)}` });
      continue;
    }
    const usage = usageOf(result.body);
    if (usage !== null) {
      tokens.input.push(usage.input);
      tokens.output.push(usage.output);
    }
    tokens.requestChars.push(ask.body.length);
    tokens.stateChars.push(ask.state.length);
    rows.push(scoreRow(jev, hierarchy, ask.entry, response));
  }
  if (rows.length === 0) {
    throw new Error(`No answer could be read. First failure: ${failures[0]?.error ?? 'none'}`);
  }

  const context = {
    at: new Date().toISOString(),
    endpoint: options.endpoint,
    model: options.model,
    seed: options.seed,
    limit: options.limit,
    concurrency: options.concurrency,
    contextChars: truth.contextChars,
    mask: options.mask,
  };
  const summary = summarizeJudgements(rows, {
    failures,
    selection: { total: truth.entries.length, eligible, skipped },
    tokens,
    price: options.price,
    rate: options.rate,
  });
  const notes = [...shapeNotes(), ...recordNotes(context)];
  const record = `${renderRecord(truth, { judged: true })}\n${renderJudgeRecord(summary, { ...context, notes })}`;
  writeFileSync(recordPath, record, { mode: 0o600 });
  console.info(renderJudgeRecord(summary, { ...context, notes: [] }));
  if (failures.length > 0) console.warn(`失敗 ${failures.length} 件。最初の 1 件: ${failures[0].error}`);
  console.info(`record: ${recordPath}`);
  console.info(`responses: ${responsesPath}`);
  return { summary, recordPath, responsesPath };
}
