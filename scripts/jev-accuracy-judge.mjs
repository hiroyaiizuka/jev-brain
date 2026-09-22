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
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { RECORD_NAME, parseCriteria, readHierarchy, renderRecord, resolveOutputPath } from './jev-accuracy.mjs';

export const RESPONSES_NAME = 'responses.jsonl';
/** The comparison row `compare` reads. Like the record, one per condition. */
export const SUMMARY_NAME = 'summary.json';

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

/** `narrow`: a field has to be used this often in the vault to stay a candidate. */
export const NARROW_MIN_USES = 5;

/** `examples`: how much of the note around an example link goes into the description, each side. */
export const EXAMPLE_CHARS = 60;

/** `examples`: how many examples one field's description carries. */
export const EXAMPLES_PER_FIELD = 2;

/**
 * Examples kept per field beyond the two that are shown. An example never comes from the note being
 * judged — that note's own field is what the measurement hides — so the pool needs spares.
 */
const EXAMPLE_SPARE = 2;

export const EXAMPLE_LEAD = 'この Vault での使い方: ';

/**
 * `directions`: one sentence per direction for Q2. LEV-163 answered 左友 zero times out of 500 and 前
 * eleven, with only the one-word label 「左友」／「前」 to go on; these say what the label means.
 * They live here, not in `judge.ts`, because §2-3's wording is what the plugin sends and this run is
 * measuring whether it should change.
 */
export const DIRECTION_NOTES = {
  parent: '[[X]] の方が抽象的で上位。今のノートの出典・元になった考え・所属する上位の概念',
  child: '[[X]] の方が具体的で下位。今のノートの例・詳細・派生・実装',
  leftFriend: '同じ段の似た話題。抽象度は同じで、言い換え・関連・支持・代替',
  rightFriend: '同じ段の対立する話題。抽象度は同じで、反対・欠点・制約',
  previous: '時系列や手順で、[[X]] が今のノートより前に来る',
  next: '時系列や手順で、[[X]] が今のノートより後に来る',
};

const LEVER_LABELS = {
  narrow: ({ minUses }) => `候補を絞る（Vault で ${minUses} 件以上使われているフィールドだけ）`,
  examples: ({ perField, chars }) => `候補ごとに用例 ${perField} つ（前後 ${chars} 字、判定対象と別のノートから）`,
  directions: () => '方向の 6 候補に 1 文ずつ',
};

/**
 * What a lever set does, for the record and the comparison table. The numbers come from the
 * settings the plan was built with, not from the defaults: a run with `{ minUses: 2 }` must not
 * be filed under a label that says 5.
 */
export const criteriaLabel = (levers, settings = {}) => {
  const values = {
    minUses: settings.minUses ?? NARROW_MIN_USES,
    chars: settings.chars ?? EXAMPLE_CHARS,
    perField: settings.perField ?? EXAMPLES_PER_FIELD,
  };
  return levers.length === 0
    ? '既定（全フィールド、説明は領域と方向だけ）'
    : levers.map((lever) => LEVER_LABELS[lever](values)).join(' ＋ ');
};

/**
 * Input tokens per character of request body, from LEV-163's 500 real answers (5,964 chars →
 * 4,444 `usage.input_tokens`). Only `--dry-run` uses it: every number that reaches the record is
 * measured from the responses themselves.
 */
export const TOKENS_PER_CHAR = 4444 / 5964;

/** One example: the note around the link, on one line. */
export function exampleText(entry, chars) {
  const before = entry.contextBefore.slice(-chars);
  const after = entry.contextAfter.slice(0, chars);
  return `${before}${entry.linkText}${after}`.replace(/\s+/g, ' ').trim();
}

/**
 * What one criteria mode needs from the truth, worked out once for the whole run: the fields that
 * stay candidates and a pool of examples per field. The counts are over the whole vault, not the
 * sample, since 「Vault で実際に使われている」 is a property of the vault.
 */
export function buildCriteriaPlan(mode, entries, {
  minUses = NARROW_MIN_USES,
  chars = EXAMPLE_CHARS,
  perField = EXAMPLES_PER_FIELD,
} = {}) {
  const levers = parseCriteria(mode);
  if (levers === null) throw new Error(`Not a criteria condition: ${mode}`);
  const narrow = levers.includes('narrow');
  const withExamples = levers.includes('examples');

  const counts = new Map();
  for (const entry of entries) counts.set(entry.fieldKey, (counts.get(entry.fieldKey) ?? 0) + 1);
  const fields = narrow
    ? [...counts.entries()].filter(([, count]) => count >= minUses).map(([key]) => key)
    : null;

  const examples = new Map();
  if (withExamples) {
    const wanted = fields ? new Set(fields) : null;
    for (const entry of entries) {
      if (wanted && !wanted.has(entry.fieldKey)) continue;
      const pool = examples.get(entry.fieldKey) ?? [];
      // Distinct notes, so two examples never show the same passage twice.
      if (pool.length >= perField + EXAMPLE_SPARE || pool.some((example) => example.note === entry.note)) continue;
      pool.push({ note: entry.note, text: exampleText(entry, chars) });
      examples.set(entry.fieldKey, pool);
    }
  }
  return {
    mode,
    levers,
    settings: { minUses, chars, perField },
    label: criteriaLabel(levers, { minUses, chars, perField }),
    fields,
    examples,
    perField,
    // A copy: the plan travels into the questions and the summary file, and the module constant
    // must not become writable caller state.
    directionNotes: levers.includes('directions') ? { ...DIRECTION_NOTES } : null,
  };
}

/** Whether a plan's descriptions depend on which note is being judged (they do once it has examples). */
export const planVariesByNote = (plan) => plan.examples.size > 0;

/**
 * The plan as `buildQuestions`'s options for one note. Examples from that note are left out: its own
 * field is the answer, and the measurement hides it from the state (`maskEntry`) for the same reason.
 */
export function criteriaOptionsFor(plan, note) {
  const options = {};
  if (plan.fields) options.fields = plan.fields;
  if (plan.directionNotes) options.directionNotes = plan.directionNotes;
  if (plan.examples.size > 0) {
    const fieldNotes = {};
    for (const [field, pool] of plan.examples) {
      const picked = pool.filter((example) => example.note !== note).slice(0, plan.perField);
      if (picked.length > 0) fieldNotes[field] = `${EXAMPLE_LEAD}${picked.map((example) => `「${example.text}」`).join('／')}`;
    }
    options.fieldNotes = fieldNotes;
  }
  return options;
}

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
export function scoreRow(jev, hierarchy, entry, response, offered = null) {
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
    /** Whether Q1 even offered the note's own field; null when the caller did not say. */
    offerable: offered === null ? null : offered.has(jev.toHierarchyKey(entry.field)),
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
  // Links whose own field is not a candidate under this condition: they cannot be answered
  // correctly, so they cap the field rate. `narrow` drops 110 of 162 fields, and 14 of the 500
  // sampled links use one of them (LEV-186). The record has to say so, or the 13.0% → 16.4%
  // comparison reads as if both conditions were scored out of the same 500.
  const unofferable = rows.filter((row) => row.offerable === false).length;
  const offerable = rows.length - unofferable;
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
    // The separator is written as an escape: a literal NUL byte in the source makes the
    // whole file read as binary to grep, `file` and review tooling.
    const key = `${row.truthField}\u0000${row.field}`;
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
    unofferable,
    /** The field rate the condition could reach at best, given the candidates it offers. */
    ceiling: ratio(offerable, judged),
    /** The field rate over the links this condition could actually answer. */
    offerableFieldRate: ratio(rows.filter((row) => row.fieldMatch).length, offerable),
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
/** Four places: one judgement costs hundredths of a yen, and the conditions differ in that digit. */
const perCallYen = (value) => `${value.toFixed(4)} 円`;

/**
 * What a run would cost, from the requests it has already built and nothing else. The criteria of
 * LEV-186 change the size of every request — `verbose` carries two passages of the vault per
 * candidate — so a 500-link run is priced before it is paid for (the ticket's 60 円 cap, and the
 * endpoint's 32k limit on state plus the longest question, design §7).
 */
export function estimateAsks(asks, { candidates, missing, price, rate }) {
  // Folded, not spread into Math.max: `--limit 0` on a large vault would overflow the call stack.
  let charsTotal = 0;
  let stateTotal = 0;
  let maxChars = 0;
  for (const ask of asks) {
    charsTotal += ask.body.length;
    stateTotal += ask.state.length;
    if (ask.body.length > maxChars) maxChars = ask.body.length;
  }
  const averageChars = ratio(charsTotal, asks.length);
  const averageTokens = averageChars * TOKENS_PER_CHAR;
  const perCallYen = ((averageTokens * price) / 1e6) * rate;
  return {
    calls: asks.length,
    missing,
    candidates,
    averageChars,
    maxChars,
    averageStateChars: ratio(stateTotal, asks.length),
    averageTokens,
    maxTokens: maxChars * TOKENS_PER_CHAR,
    perCallYen,
    totalYen: perCallYen * missing,
  };
}

/** `--dry-run`: the estimate on stdout, with nothing sent and nothing written. */
export function renderEstimate(estimate, { criteria, label, responsesPath }) {
  return [
    `## 見積もり（--dry-run。criteria: ${criteria} ＝ ${label}）`,
    '',
    '| 項目 | 値 |',
    '| --- | --- |',
    `| Q1 の候補 | ${estimate.candidates} 件 |`,
    `| 判定 | ${estimate.calls} 件（うち新たに聞くのは ${estimate.missing} 件、残りは \`${responsesPath}\` の保存済み） |`,
    `| 要求の本文 | 平均 ${Math.round(estimate.averageChars)} 字・最大 ${estimate.maxChars} 字（うち state 平均 ${Math.round(estimate.averageStateChars)} 字） |`,
    `| 入力トークン（推定） | 平均 ${Math.round(estimate.averageTokens)}・最大 ${Math.round(estimate.maxTokens)}（LEV-163 の実測 ${TOKENS_PER_CHAR.toFixed(3)} トークン/字） |`,
    `| 費用（推定） | 1 判定 ${perCallYen(estimate.perCallYen)}、新規 ${estimate.missing} 件で ${yen(estimate.totalYen)} |`,
    '',
    '推定はトークン数を文字数から換算したもの。実測は応答の `usage.input_tokens` で、判定を走らせたときだけ出る。',
  ].join('\n');
}

/** The judge half of `artifacts/jev-accuracy/record.md`. */
export function renderJudgeRecord(summary, context) {
  const { selection, overall, consistency, tokens, cost } = summary;
  const criteria = context.criteria ?? 'default';
  const lines = [
    criteria === 'default' ? '## Jev の判定（LEV-163）' : `## Jev の判定（LEV-186、criteria: ${criteria}）`,
    '',
    '| 項目 | 値 |',
    '| --- | --- |',
    `| 実行 | ${context.at} |`,
    `| endpoint / model | \`${context.endpoint}\` / \`${context.model}\` |`,
    `| criteria | ${criteria} ＝ ${context.criteriaLabel ?? criteria}。Q1 の候補 ${context.candidates ?? '—'} 件 |`,
    `| 対象 | 正解 ${selection.total} 件のうちオントロジー内 ${selection.eligible} 件（外の ${selection.skipped} 件はどの条件でも候補に無いので除外） |`,
    summary.unofferable > 0
      ? `| **この条件では当たらない正解** | ${summary.unofferable} 件（標本の ${percentage(1 - summary.ceiling)}）。`
        + `絞り込みで候補から外れたフィールドが正解なので、原理的に当てられない。`
        + `**この条件の一致率の上限は ${percentage(summary.ceiling)}**、候補内だけで数えた一致率は `
        + `${percentage(summary.offerableFieldRate)} |`
      : '| この条件では当たらない正解 | 0 件（標本の正解はすべて Q1 の候補にある） |',
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
  // The record and the saved answers sit next to the truth, one set per condition: two conditions
  // run back to back must not overwrite each other's record, which is what `compare` then reads.
  // `default` keeps the plain names so LEV-163's files stay where they were.
  const criteria = options.criteria ?? 'default';
  const suffix = criteria === 'default' ? '' : `-${criteria.replaceAll(',', '-')}`;
  const named = (name) => {
    const dot = name.lastIndexOf('.');
    return join(directory, `${name.slice(0, dot)}${suffix}${name.slice(dot)}`);
  };
  const responsesPath = resolveOutputPath(root, options.responses ?? named(RESPONSES_NAME));
  const recordPath = resolveOutputPath(root, options.record ?? named(RECORD_NAME));
  const summaryOut = options.summary ?? named(SUMMARY_NAME);

  const jev = await loadJevSource(root);
  const definition = options.hierarchy ? readHierarchy(null, options.hierarchy).definition : truth.hierarchyDefinition;
  const { hierarchy } = jev.buildHierarchyLowerCase(definition);
  const plan = buildCriteriaPlan(criteria, truth.entries);
  // Only an example-carrying plan reads the note, so the other three build the questions once.
  const shared = planVariesByNote(plan) ? null : jev.buildQuestions(hierarchy, criteriaOptionsFor(plan, null));
  const questionsFor = (entry) => shared ?? jev.buildQuestions(hierarchy, criteriaOptionsFor(plan, entry.note));
  const asked = [FIELD_QUESTION, DIRECTION_QUESTION];

  const { eligible, skipped, sample } = selectEntries(truth.entries, {
    directionOfField: jev.directionOfField,
    hierarchy,
    limit: options.limit,
    seed: options.seed,
  });
  // Before the sample is read: an empty truth must reach this message, not a TypeError from
  // building the questions for `truth.entries[0]`.
  if (sample.length === 0) throw new Error('Nothing to judge: no truth record uses a field of this ontology.');

  // The candidate names Q1 offers. A note-dependent plan varies only the descriptions, never the
  // set of candidates, so the first sampled note answers for the whole run.
  const offered = new Set(
    Object.keys(questionsFor(sample[0])[FIELD_QUESTION].criteria).map(jev.toHierarchyKey),
  );
  const candidates = offered.size;

  const saved = readResponses(responsesPath);
  const apiKey = process.env.JEV_API_KEY ?? '';
  const asks = sample.map((entry) => {
    const state = buildJudgeState(jev, entry, { contextChars: truth.contextChars, mask: options.mask });
    const body = JSON.stringify(toWireRequest(options.model, state, questionsFor(entry)));
    return { entry, state, body, requestHash: hashOf(body) };
  });
  const missing = asks.filter((ask) => !saved.has(`${ask.entry.id}:${ask.requestHash}`)).length;
  // What the run would cost before it spends anything: the record's own numbers are always measured.
  const estimate = estimateAsks(asks, { candidates, missing, price: options.price, rate: options.rate });
  if (options.dryRun) {
    console.info(renderEstimate(estimate, { criteria: plan.mode, label: plan.label, responsesPath }));
    // Say what the run is not doing: a caller that then feeds the summary to `compare` would
    // otherwise meet an ENOENT with nothing pointing back here.
    if (options.summary) console.warn(`--dry-run なので --summary (${options.summary}) は書いていない。`);
    return { estimate, plan, summary: null, summaryPath: null, recordPath, responsesPath };
  }
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
    rows.push(scoreRow(jev, hierarchy, ask.entry, response, offered));
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
    criteria: plan.mode,
    criteriaLabel: plan.label,
    levers: plan.levers,
    candidates,
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
  const summaryPath = resolveOutputPath(root, summaryOut);
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(comparisonFile(summary, context), null, 2)}\n`, { mode: 0o600 });
  console.info(renderJudgeRecord(summary, { ...context, notes: [] }));
  if (failures.length > 0) console.warn(`失敗 ${failures.length} 件。最初の 1 件: ${failures[0].error}`);
  console.info(`record: ${recordPath}`);
  console.info(`responses: ${responsesPath}`);
  console.info(`summary: ${summaryPath}`);
  return { summary, recordPath, responsesPath, summaryPath, estimate };
}

/**
 * The shape of a summary file. `runCompare` refuses another version rather than rendering its
 * missing keys as unmeasured columns, so bump this whenever `row` gains or renames a key.
 */
export const SUMMARY_VERSION = 2;

/** The comparison row of one run, and enough of the run to read it a month later (LEV-186). */
export function comparisonFile(summary, context) {
  const rank = (value) => summary.ranks.find((row) => row.rank === value)?.hit ?? null;
  return {
    version: SUMMARY_VERSION,
    criteria: context.criteria,
    label: context.criteriaLabel,
    levers: context.levers,
    at: context.at,
    run: {
      endpoint: context.endpoint,
      model: context.model,
      seed: context.seed,
      limit: context.limit,
      mask: context.mask,
      contextChars: context.contextChars,
    },
    row: {
      candidates: context.candidates,
      /** Links a bulk run of this condition would judge, which is what its per-call price buys. */
      eligible: summary.selection.eligible,
      judged: summary.judged,
      /** Sampled links whose own field this condition never offered (see summarizeJudgements). */
      unofferable: summary.unofferable,
      ceiling: summary.ceiling,
      offerableFieldRate: summary.offerableFieldRate,
      failures: summary.failures.length,
      fieldRate: summary.overall.fieldRate,
      top3: rank(3),
      top5: rank(5),
      top10: rank(10),
      directionRate: summary.overall.directionRate,
      directionOnly: summary.directionOnly,
      confidentShare: ratio(summary.consistency.confident.count, summary.judged),
      confidentFieldRate: summary.consistency.confident.fieldRate,
      confidentDirectionRate: summary.consistency.confident.directionRate,
      // `ratio(0, 0)` is 0, so a run whose responses carried no `usage` would otherwise be
      // compared as a free condition. Unmeasured is null, which the table prints as 「—」.
      averageTokens: summary.tokens.reportedCalls > 0 ? summary.tokens.averageTokens : null,
      perCallYen: summary.tokens.reportedCalls > 0 ? summary.cost.perCallYen : null,
      totalYen: summary.tokens.reportedCalls > 0 ? summary.cost.totalYen : null,
      thresholds: summary.thresholds,
      confusion: summary.confusion.slice(0, 5),
      directions: summary.directions,
    },
  };
}

const orDash = (value, format) => (typeof value === 'number' && Number.isFinite(value) ? format(value) : '—');
const pct = (value) => orDash(value, percentage);

/**
 * `record-v2.md`: the criteria conditions side by side. Every row comes from a summary file a judge
 * run wrote, except the LEV-163 baseline, which was transcribed from its own record (its file says
 * so in `note`) because that run's saved answers are gone.
 */
export function renderComparison(files, { at, notes = [] }) {
  const columns = files.map((file) => file.criteria);
  // The runs should be over the same sample; say so from the data rather than from a fixed number.
  const judged = [...new Set(files.map((file) => file.row.judged).filter((value) => typeof value === 'number'))];
  const judgedLabel = judged.length === 1 ? `${judged[0]} 本` : '本数は条件ごと';
  const header = (first) => [
    `| ${first} | ${columns.join(' | ')} |`,
    `| ${['---', ...columns.map(() => '---')].join(' | ')} |`,
  ];
  const line = (name, read) => `| ${name} | ${files.map((file) => read(file.row)).join(' | ')} |`;

  const lines = [
    `# JEV-0 精度テスト v2: criteria の ${files.length} 条件（LEV-186）`,
    '',
    '| 項目 | 値 |',
    '| --- | --- |',
    `| 実行 | ${at} |`,
    `| 条件 | ${files.length} 件（${columns.join('・')}） |`,
    '',
    'LEV-163（フィールド一致率 13.0%）を受けた再測。設計 §10「5 割なら criteria の説明文を厚くして再測」。',
    '',
    '## 条件',
    '',
    '| criteria | 内容 | Q1 の候補 | 判定 | 実行 |',
    '| --- | --- | --- | --- | --- |',
    ...files.map((file) => `| ${file.criteria} | ${file.label} | ${orDash(file.row.candidates, (value) => `${value} 件`)} `
      + `| ${orDash(file.row.judged, (value) => `${value} 件`)} | ${file.at}${file.note ? `（${file.note}）` : ''} |`),
    '',
    '## 一致率',
    '',
    ...header('指標'),
    line('フィールド一致率', (row) => pct(row.fieldRate)),
    line('　うちこの条件では当たらない正解', (row) => (typeof row.unofferable === 'number'
      ? `${row.unofferable} 件（上限 ${percentage(row.ceiling)}、候補内だけなら ${percentage(row.offerableFieldRate)}）`
      : '—')),
    line('上位 3', (row) => pct(row.top3)),
    line('上位 5', (row) => pct(row.top5)),
    line('上位 10', (row) => pct(row.top10)),
    line('方向一致率', (row) => pct(row.directionRate)),
    line('フィールドは外したが方向は合っている', (row) => pct(row.directionOnly)),
    line('自信あり の割合', (row) => pct(row.confidentShare)),
    line('自信あり のフィールド一致率', (row) => pct(row.confidentFieldRate)),
    line('自信あり の方向一致率', (row) => pct(row.confidentDirectionRate)),
    '',
    '## トークンと費用',
    '',
    ...header('指標'),
    line('平均入力トークン', (row) => orDash(row.averageTokens, (value) => `${Math.round(value)}`)),
    // Four places: a judgement costs hundredths of a yen, and the conditions differ in that digit.
    line('1 判定の費用', (row) => orDash(row.perCallYen, perCallYen)),
    line(`この実行の費用（${judgedLabel}）`, (row) => orDash(row.totalYen, yen)),
    // What the condition costs in use, not in the measurement: design §7's 月 600 判定 and one bulk run.
    line('月 600 判定なら', (row) => orDash(row.perCallYen, (value) => yen(value * 600))),
    line('オントロジー内を一括したら', (row) => (typeof row.eligible === 'number'
      ? orDash(row.perCallYen, (value) => `${yen(value * row.eligible)}（${row.eligible} 本）`)
      : '—')),
    '',
    '## しきい値ごとの適合率と対象率',
    '',
    'Q1 第一候補の確率がしきい値以上のもの。「＋自信あり」は設計 §2-3 の整合性チェックも満たすもの（§2-4 の一括自動確定の条件）。',
    '',
    '| criteria | しきい値 | 対象率 | 適合率 | 件数 | ＋自信あり 対象率 | ＋自信あり 適合率 | 件数 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...files.flatMap((file) => (file.row.thresholds ?? []).map((row) => `| ${file.criteria} | ${row.threshold.toFixed(1)} `
      + `| ${pct(row.coverage)} | ${pct(row.precision)} | ${row.count} | ${pct(row.confidentCoverage)} `
      + `| ${pct(row.confidentPrecision)} | ${row.confidentCount} |`)),
    '',
    '## 正解の方向別（フィールド一致率 / 方向一致率、かっこは件数）',
    '',
    ...header('正解の方向'),
    ...Object.keys(DIRECTION_LABELS).map((direction) => {
      const cell = (file) => {
        const row = (file.row.directions ?? []).find((candidate) => candidate.direction === direction);
        return row ? `${percentage(row.fieldRate)} / ${percentage(row.directionRate)}（${row.count}）` : '—';
      };
      return `| ${DIRECTION_LABELS[direction]} | ${files.map(cell).join(' | ')} |`;
    }),
    '',
    '## 混同の多い組（条件ごとに上位 5）',
    '',
    ...files.flatMap((file) => [
      `### ${file.criteria}`,
      '',
      '| 正解 | Jev の答え | 件数 | うち方向は一致 |',
      '| --- | --- | --- | --- |',
      ...(file.row.confusion ?? []).map((row) => `| ${row.truth} | ${row.answer} | ${row.count} | ${row.sameDirection} |`),
      '',
    ]),
  ];
  if (notes.length > 0) lines.push(...notes, '');
  return lines.join('\n');
}

/**
 * `node scripts/jev-accuracy.mjs compare --summaries a.json,b.json --out artifacts/jev-accuracy/record-v2.md`:
 * the comparison of `record-v2.md` from the summary files the judge runs wrote. It asks Jev nothing.
 */
export function runCompare(root, options) {
  const paths = options.summaries.split(',').map((value) => value.trim()).filter((value) => value !== '');
  if (paths.length === 0) throw new Error('compare needs --summaries <json>[,<json>...]');
  const files = paths.map((path) => {
    const parsed = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (!isRecord(parsed) || !isRecord(parsed.row)) throw new Error(`Not a judge summary file: ${path}`);
    // Checked, not just stamped: a summary from an older row shape would otherwise render as a
    // column of 「—」 and read as an unmeasured condition rather than as a stale file.
    if (parsed.version !== SUMMARY_VERSION) {
      throw new Error(`Summary file ${path} is version ${parsed.version}, this build writes ${SUMMARY_VERSION}. Re-run judge for it.`);
    }
    return parsed;
  });
  const notes = options.notes ? readFileSync(resolve(root, options.notes), 'utf8').trimEnd().split('\n') : [];
  const outPath = resolveOutputPath(root, options.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const record = renderComparison(files, { at: new Date().toISOString(), notes });
  writeFileSync(outPath, `${record}\n`, { mode: 0o600 });
  console.info(record);
  console.info(`record: ${outPath}`);
  return { record, outPath };
}
