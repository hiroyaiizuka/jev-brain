import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUT, JUDGE_DEFAULTS, RECORD_NAME, extractTruth, projectRoot, writeOutputs } from '../../scripts/jev-accuracy.mjs';
import {
  DIRECTION_NOTES,
  EXAMPLE_LEAD,
  RESPONSES_NAME,
  buildCriteriaPlan,
  buildJudgeState,
  comparisonFile,
  criteriaLabel,
  criteriaOptionsFor,
  estimateAsks,
  exampleText,
  loadJevSource,
  maskEntry,
  parseFrontmatter,
  readAnswers,
  readResponses,
  renderComparison,
  runCompare,
  runJudge,
  scoreRow,
  selectEntries,
  summarizeJudgements,
  toWireRequest,
  usageOf,
} from '../../scripts/jev-accuracy-judge.mjs';

/** 実機 E18 で受け取った応答そのもの（LEV-170 が置いた記録）と、公開情報から起こしていた古い形。 */
const fixture = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/jev/${name}.json`, import.meta.url)), 'utf8'));
const recorded = fixture('two-choice-200');
const legacy = fixture('legacy-questions-200');

/** The ontology of the test vault: one field per region, so a direction is easy to read off. */
const HIERARCHY = {
  parents: ['up', 'origin'],
  children: ['down'],
  leftFriends: ['similar'],
  rightFriends: ['opposes'],
  previous: ['prev'],
  next: ['Next'],
  hidden: ['hidden'],
  exclusions: [],
};

const CENTRE = [
  '---',
  'tags:',
  '  - habit',
  'origin:',
  '  - "[[出典ノート]]"',
  'up: "[[frontmatter の親]]"',
  '---',
  '# 中心のノート',
  '',
  'up:: [[親ノート]]',
  '',
  '本文に (down:: [[子ノート]]) が入る。',
  '',
  '## Relations',
  '',
  'similar:: [[友ノート]]',
  '**Next** :: [[次のノート]]',
  '',
].join('\n');

let jev;
let root;
let vault;

beforeAll(async () => {
  jev = await loadJevSource(projectRoot());
}, 60_000);

/** A root that has both `src/` (judge bundles it) and `artifacts/` (the only place output may go). */
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'jev-judge-test-')));
  cpSync(join(projectRoot(), 'src'), join(root, 'src'), { recursive: true });
  vault = join(root, 'vault');
  mkdirSync(join(vault, '.obsidian', 'plugins', 'jevbrain'), { recursive: true });
  writeFileSync(join(vault, '.obsidian', 'plugins', 'jevbrain', 'data.json'), JSON.stringify({ hierarchy: HIERARCHY }));
  writeFileSync(join(vault, '中心のノート.md'), CENTRE);
  for (const name of ['親ノート', '子ノート', '友ノート', '次のノート', '出典ノート']) {
    writeFileSync(join(vault, `${name}.md`), `---\ntags:\n  - note\n---\n# ${name}\n\n${name}の冒頭。\n`);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const truthOf = () => extractTruth(vault);
const entryFor = (truth, target) => truth.entries.find((entry) => entry.target === target);
const stateOf = (truth, target, mask = 'on') =>
  JSON.parse(buildJudgeState(jev, entryFor(truth, target), { contextChars: truth.contextChars, mask }));

describe('hiding the field the note already carries', () => {
  it('takes the marker of a line, an inline field and a Relations line off the window', () => {
    const truth = truthOf();

    expect(maskEntry(entryFor(truth, '親ノート')).contextBefore.endsWith('# 中心のノート\n\n')).toBe(true);
    expect(maskEntry(entryFor(truth, '子ノート')).contextBefore.endsWith('本文に (')).toBe(true);
    expect(maskEntry(entryFor(truth, '友ノート')).contextBefore.endsWith('## Relations\n\n')).toBe(true);
  });

  it('takes a markdown-wrapped marker off as it is written in the note', () => {
    const entry = entryFor(truthOf(), '次のノート');

    expect(entry.field).toBe('Next');
    expect(entry.marker).toBe('**Next**');
    expect(maskEntry(entry).contextBefore.endsWith('similar:: [[友ノート]]\n')).toBe(true);
  });

  it('takes a frontmatter key and its items out of the window and out of the frontmatter', () => {
    const masked = maskEntry(entryFor(truthOf(), '出典ノート'));

    expect(masked.contextBefore).toBe('---\ntags:\n  - habit\n');
    expect(masked.frontmatter).toBe('tags:\n  - habit\nup: "[[frontmatter の親]]"');
  });

  it('leaves the fields of the other links alone: only this one link is hidden', () => {
    const context = stateOf(truthOf(), '次のノート').note.context;

    expect(context).toContain('similar:: [[友ノート]]');
    expect(context).not.toMatch(/\*\*Next\*\*[ \t]*::[ \t]*\[\[次のノート\]\]/);
  });

  it('keeps the marker when the run is the unmasked control', () => {
    expect(stateOf(truthOf(), '親ノート', 'off').note.context).toContain('up:: [[親ノート]]');
  });
});

describe('the state of one judgement', () => {
  it('is the window around the link, the two frontmatters and the neighbour opening', () => {
    const truth = truthOf();
    const entry = entryFor(truth, '親ノート');
    const state = stateOf(truth, '親ノート');

    expect(state.note.context).toBe(`${maskEntry(entry).contextBefore}[[親ノート]]${entry.contextAfter}`);
    expect(state.note.frontmatter).toEqual({ tags: ['habit'], origin: ['[[出典ノート]]'], up: '[[frontmatter の親]]' });
    expect(state.target).toEqual({
      name: '親ノート',
      frontmatter: { tags: ['note'] },
      excerpt: '# 親ノート\n\n親ノートの冒頭。',
    });
    // 見直し（設計 §5）ではないので、現在のフィールドは送らない。
    expect(state.currentField).toBeUndefined();
  });

  it('sends only the name of a link whose note does not exist', () => {
    writeFileSync(join(vault, '中心のノート.md'), 'up:: [[まだ無いノート]]\n');
    const truth = truthOf();

    expect(stateOf(truth, 'まだ無いノート').target).toEqual({ name: 'まだ無いノート' });
  });

  it('reads a frontmatter block that is not valid YAML as no frontmatter', () => {
    expect(parseFrontmatter('tags: [unclosed\n  - "')).toBeNull();
    expect(parseFrontmatter('')).toBeNull();
    expect(parseFrontmatter('- 1\n- 2')).toBeNull();
  });
});

describe('the request', () => {
  it('sends both questions as Choice, with the question text under instructions', () => {
    const { hierarchy } = jev.buildHierarchyLowerCase(HIERARCHY);
    const body = toWireRequest('jev-latest', '{"note":{}}', jev.buildQuestions(hierarchy));

    expect(body.model).toBe('jev-latest');
    expect(body.state).toBe('{"note":{}}');
    expect(Object.keys(body.questions)).toEqual(['field', 'direction']);
    expect(body.questions.field.type).toBe('choice');
    expect(body.questions.field.instructions).toBe('このリンクに付けるフィールド');
    expect(body.questions.field.criteria).toEqual({
      up: 'Parents・方向: 親',
      origin: 'Parents・方向: 親',
      down: 'Children・方向: 子',
      similar: '左友・方向: 左友',
      opposes: '右友・方向: 右友',
      prev: '前・方向: 前',
      Next: '次・方向: 次',
    });
    expect(Object.keys(body.questions.direction.criteria)).toEqual(
      ['parent', 'child', 'leftFriend', 'rightFriend', 'previous', 'next'],
    );
  });
});

describe('reading the answer', () => {
  const asked = ['field', 'direction'];

  it('reads the answers the endpoint actually returns', () => {
    const response = readAnswers(recorded.body, asked);

    expect(response.questions.field.choice).toBe('up');
    expect(response.questions.field.probabilities).toEqual({ up: 0.39, next: 0.14, similar: 0.17, down: 0.3 });
    expect(response.questions.direction.choice).toBe('child');
  });

  it('refuses the shape that was guessed from public information, so a silent half-reading cannot happen', () => {
    expect(readAnswers(legacy.body, asked)).toBeNull();
  });

  it('refuses a response that is missing a question or answers with the wrong types', () => {
    expect(readAnswers({ answers: { field: recorded.body.answers.field } }, asked)).toBeNull();
    expect(readAnswers({ answers: { ...recorded.body.answers, field: { choice: 'up' } } }, asked)).toBeNull();
    expect(readAnswers({ answers: { ...recorded.body.answers, field: { choice: 'up', probabilities: { up: 'いち' } } } }, asked)).toBeNull();
    expect(readAnswers('not json', asked)).toBeNull();
  });

  it('reads the token counts in either spelling, and reports none when there is no usage', () => {
    expect(usageOf(recorded.body)).toEqual({ input: 515, output: 92 });
    expect(usageOf({ usage: { inputTokens: 12 } })).toEqual({ input: 12, output: 0 });
    expect(usageOf({ answers: {} })).toBeNull();
  });
});

describe('the sample', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    id: `${index}`,
    field: index % 4 === 0 ? 'プロジェクト' : 'up',
  }));
  const hierarchy = { parents: ['up'] };
  const directionOfField = (field) => (field === 'up' ? 'parent' : null);

  it('leaves out the fields the ontology does not know, since Q1 never offers them', () => {
    const { eligible, skipped, sample } = selectEntries(entries, { directionOfField, hierarchy, limit: 0, seed: 1 });

    expect(eligible).toBe(30);
    expect(skipped).toBe(10);
    expect(sample).toHaveLength(30);
    expect(sample.every((entry) => entry.field === 'up')).toBe(true);
  });

  it('picks the same links again for the same seed, so the saved answers still fit', () => {
    const ids = (seed, limit) => selectEntries(entries, { directionOfField, hierarchy, limit, seed })
      .sample.map((entry) => entry.id);

    expect(ids(1, 10)).toEqual(ids(1, 10));
    expect(ids(1, 10)).not.toEqual(ids(2, 10));
    // A smaller run is the start of the larger one: --limit 20 first, then 500, asks 20 questions once.
    expect(ids(1, 30).slice(0, 10)).toEqual(ids(1, 10));
  });
});

describe('the numbers', () => {
  const row = (truthField, field, probability, confident, truthDirection, direction) => ({
    truthField, field, probability, confident, truthDirection, direction,
    fieldMatch: truthField === field,
    directionMatch: truthDirection === direction,
  });
  const rows = [
    row('up', 'up', 0.9, true, 'parent', 'parent'),
    row('up', 'up', 0.7, true, 'parent', 'parent'),
    row('up', 'origin', 0.85, true, 'parent', 'parent'),
    row('down', 'up', 0.4, false, 'child', 'parent'),
    row('similar', 'opposes', 0.3, false, 'leftFriend', 'leftFriend'),
  ];
  const summary = () => summarizeJudgements(rows, {
    failures: [],
    selection: { total: 10, eligible: 5, skipped: 5 },
    tokens: { calls: 5, input: [4000, 5000], output: [1000, 1400], requestChars: [6000, 6000], stateChars: [1000, 1000] },
    price: 0.042,
    rate: 150,
  });

  it('counts field and direction agreement, and the misses that still point the right way', () => {
    const { overall, directionOnly } = summary();

    expect(overall).toEqual({ count: 5, fieldRate: 2 / 5, directionRate: 4 / 5 });
    expect(directionOnly).toBe(2 / 5);
  });

  it('reads every threshold on the first candidate alone and with the consistency check', () => {
    const at = (threshold) => summary().thresholds.find((row) => row.threshold === threshold);

    expect(at(0.5)).toMatchObject({ count: 3, coverage: 3 / 5, precision: 2 / 3, confidentCount: 3, confidentPrecision: 2 / 3 });
    expect(at(0.8)).toMatchObject({ count: 2, coverage: 2 / 5, precision: 1 / 2 });
    expect(at(0.9)).toMatchObject({ count: 1, precision: 1 });
  });

  it('splits by the consistency check and lists the confusions by how often they happen', () => {
    const { consistency, confusion, directions } = summary();

    expect(consistency.confident).toEqual({ count: 3, fieldRate: 2 / 3, directionRate: 1 });
    expect(consistency.unconfident).toEqual({ count: 2, fieldRate: 0, directionRate: 1 / 2 });
    expect(confusion).toEqual([
      { truth: 'down', answer: 'up', count: 1, sameDirection: 0 },
      { truth: 'similar', answer: 'opposes', count: 1, sameDirection: 1 },
      { truth: 'up', answer: 'origin', count: 1, sameDirection: 1 },
    ]);
    expect(directions).toEqual([
      { direction: 'parent', count: 3, fieldRate: 2 / 3, directionRate: 1 },
      { direction: 'child', count: 1, fieldRate: 0, directionRate: 0 },
      { direction: 'leftFriend', count: 1, fieldRate: 0, directionRate: 1 },
    ]);
  });

  it('bills the input tokens the responses reported', () => {
    const { tokens, cost } = summary();

    expect(tokens.averageTokens).toBe(4500);
    expect(tokens.averageOutputTokens).toBe(1200);
    // 4,500 トークン × $0.042/M × 150 円 = 0.028 円 / 判定。
    expect(cost.perCallYen).toBeCloseTo(0.0284, 4);
    expect(cost.totalYen).toBeCloseTo(0.0567, 4);
  });
});

describe('scoring one answer', () => {
  it('compares the note against the plugin\'s own reading of the response', () => {
    const { hierarchy } = jev.buildHierarchyLowerCase(HIERARCHY);
    const entry = entryFor(truthOf(), '親ノート');
    const answered = (field, direction) => readAnswers({
      answers: {
        field: { choice: field, confidence: 0.6, probabilities: { [field]: 0.6, down: 0.4 } },
        direction: { choice: direction, confidence: 0.7, probabilities: { [direction]: 0.7 } },
      },
    }, ['field', 'direction']);

    expect(scoreRow(jev, hierarchy, entry, answered('up', 'parent'))).toMatchObject({
      truthField: 'up', truthDirection: 'parent', field: 'up', direction: 'parent',
      probability: 0.6, confident: true, fieldMatch: true, directionMatch: true,
    });
    // Q1 が親の領域の語なのに Q2 が子 → 整合性なし（設計 §2-3）。
    expect(scoreRow(jev, hierarchy, entry, answered('origin', 'child'))).toMatchObject({
      field: 'origin', confident: false, fieldMatch: false, directionMatch: false,
    });
  });
});

describe('the command', () => {
  const answerWith = (field, direction) => ({
    model: 'jev-1.13.0',
    answers: {
      field: { type: 'choice', choice: field, confidence: 0.6, probabilities: { [field]: 0.6, down: 0.2, similar: 0.2 } },
      direction: { type: 'choice', choice: direction, confidence: 0.7, probabilities: { [direction]: 0.7, child: 0.3 } },
    },
    usage: { input_tokens: 515, output_tokens: 92 },
  });

  const options = {
    ...JUDGE_DEFAULTS,
    truth: DEFAULT_OUT,
    hierarchy: null,
    responses: null,
    record: null,
    limit: 0,
    concurrency: 2,
  };

  let calls;

  function stubJev(status = 200) {
    calls = [];
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      calls.push({ url, init });
      return Promise.resolve({
        status,
        text: () => Promise.resolve(JSON.stringify(answerWith('up', 'parent'))),
      });
    }));
  }

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.JEV_API_KEY = 'test-key';
    const truth = extractTruth(vault);
    writeOutputs(join(root, DEFAULT_OUT), truth, '');
  });

  it('asks about every truth record once and writes both halves of the record', async () => {
    stubJev();

    const { summary, recordPath, responsesPath } = await runJudge(root, options);

    expect(calls).toHaveLength(6);
    expect(calls[0].url).toBe(JUDGE_DEFAULTS.endpoint);
    expect(calls[0].init.headers.authorization).toBe('Bearer test-key');
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.model).toBe('jev-latest');
    expect(Object.keys(sent.questions)).toEqual(['field', 'direction']);
    // 送った state には、そのリンク自身のフィールド名が無い（並びは seed の並べ替え順なので相手で引く）。
    const stateFor = (name) => calls
      .map((call) => JSON.parse(JSON.parse(call.init.body).state))
      .find((state) => state.target.name === name);
    expect(stateFor('親ノート').note.context).not.toMatch(/up[ \t]*::[ \t]*\[\[親ノート\]\]/);
    expect(stateFor('親ノート').note.context).toContain('[[親ノート]]');

    expect(summary.judged).toBe(6);
    expect(summary.overall.count).toBe(6);
    expect(summary.failures).toEqual([]);
    const record = readFileSync(recordPath, 'utf8');
    expect(recordPath).toBe(join(root, 'artifacts', 'jev-accuracy', RECORD_NAME));
    expect(record).toContain('# JEV-0 精度テスト: 正解の抽出（LEV-162）');
    expect(record).toContain('## Jev の判定（LEV-163）');
    expect(record).toContain('| フィールド一致率 | 33.3%（2 / 6） |');
    expect(record).toContain('| 入力トークン | 平均 515');
    expect(readFileSync(responsesPath, 'utf8').trim().split('\n')).toHaveLength(6);
  });

  it('reuses the answers it saved instead of asking again', async () => {
    stubJev();
    await runJudge(root, options);
    stubJev();

    const { summary } = await runJudge(root, options);

    expect(calls).toHaveLength(0);
    expect(summary.judged).toBe(6);
    expect(summary.tokens.calls).toBe(0);
  });

  it('will not start without a key when answers are missing, and never writes one down', async () => {
    delete process.env.JEV_API_KEY;

    await expect(runJudge(root, options)).rejects.toThrow(/JEV_API_KEY/);
    expect(existsSync(join(root, 'artifacts', 'jev-accuracy', RESPONSES_NAME))).toBe(false);
  });

  it('keeps a refused call out of the numbers, and does not save it as an answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      call += 1;
      return Promise.resolve(call === 1
        ? { status: 400, text: () => Promise.resolve('{"error":"bad request"}') }
        : { status: 200, text: () => Promise.resolve(JSON.stringify(answerWith('up', 'parent'))) });
    }));

    const { summary, responsesPath } = await runJudge(root, options);

    expect(summary.judged).toBe(5);
    expect(summary.failures).toEqual([{ id: expect.any(String), error: expect.stringContaining('HTTP 400') }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('失敗 1 件'));
    // 失敗も記録には残るが、貯めた答えとしては読み直さない（次の実行でもう一度聞く）。
    expect(readFileSync(responsesPath, 'utf8').trim().split('\n')).toHaveLength(6);
    expect(readResponses(responsesPath).size).toBe(5);
  });

  it('asks again for a link whose saved answer was to a different question', async () => {
    stubJev();
    await runJudge(root, options);
    stubJev();

    await runJudge(root, { ...options, mask: 'off' });

    expect(calls).toHaveLength(6);
  });
});

// ---- LEV-186: criteria の 3 つのつまみ（絞る・用例・方向の 1 文）と、条件を並べる比較表 ----

describe('the criteria conditions', () => {
  /** Truth-shaped records: `up` is used often, `origin` twice, `down` once. */
  const entry = (id, note, field, before, after = '。') => ({
    id, note, field, fieldKey: field, marker: field,
    linkText: `[[${id}]]`, contextBefore: `${before}${field}:: `, contextAfter: after,
  });
  const entries = [
    entry('1', 'A.md', 'up', 'アの前。'),
    entry('2', 'A.md', 'up', 'アの二本目。'),
    entry('3', 'B.md', 'up', 'イの前。'),
    entry('4', 'C.md', 'up', 'ウの前。'),
    entry('5', 'D.md', 'up', 'エの前。'),
    entry('6', 'A.md', 'origin', 'アの出典。'),
    entry('7', 'B.md', 'origin', 'イの出典。'),
    entry('8', 'E.md', 'down', 'オの前。'),
  ];

  it('names the levers of each condition, and refuses one it does not know', () => {
    expect(buildCriteriaPlan('default', entries).levers).toEqual([]);
    expect(buildCriteriaPlan('narrow', entries).levers).toEqual(['narrow']);
    expect(buildCriteriaPlan('verbose', entries).levers).toEqual(['examples', 'directions']);
    expect(buildCriteriaPlan('both', entries).levers).toEqual(['narrow', 'examples', 'directions']);
    // 案 E の 3 本目: 絞ったうえで、方向の 1 文だけ足す（用例は付けない）。
    expect(buildCriteriaPlan('directions,narrow', entries).levers).toEqual(['narrow', 'directions']);
    expect(() => buildCriteriaPlan('thicker', entries)).toThrow(/criteria/);
  });

  it('leaves the questions alone for the default condition', () => {
    const plan = buildCriteriaPlan('default', entries);

    expect(criteriaOptionsFor(plan, 'A.md')).toEqual({});
    expect(criteriaLabel(plan.levers)).toContain('既定');
  });

  it('keeps only the fields the vault uses often enough, counted over the whole vault', () => {
    const plan = buildCriteriaPlan('narrow', entries, { minUses: 2 });

    expect(plan.fields).toEqual(['up', 'origin']);
    expect(criteriaOptionsFor(plan, 'A.md')).toEqual({ fields: ['up', 'origin'] });
    expect(buildCriteriaPlan('narrow', entries, { minUses: 5 }).fields).toEqual(['up']);
  });

  it('adds the six direction sentences without touching the candidates', () => {
    const options = criteriaOptionsFor(buildCriteriaPlan('directions', entries), 'A.md');

    expect(options.fields).toBeUndefined();
    expect(options.fieldNotes).toBeUndefined();
    expect(options.directionNotes).toBe(DIRECTION_NOTES);
    expect(Object.keys(DIRECTION_NOTES)).toEqual(
      ['parent', 'child', 'leftFriend', 'rightFriend', 'previous', 'next'],
    );
  });

  it('puts the note around an example link on one line', () => {
    expect(exampleText({ contextBefore: 'ア\nの前。up:: ', linkText: '[[X]]', contextAfter: '\n\n後。' }, 60))
      .toBe('ア の前。up:: [[X]] 後。');
    expect(exampleText({ contextBefore: '一二三四五up:: ', linkText: '[[X]]', contextAfter: '六七八九十' }, 3))
      .toBe(':: [[X]]六七八');
  });

  it('gives each field examples from other notes, never from the note being judged', () => {
    const plan = buildCriteriaPlan('examples', entries, { perField: 2 });
    const notesFor = (note) => criteriaOptionsFor(plan, note).fieldNotes;

    // A.md holds an `up` example itself, so its own passage is left out of the description it reads.
    expect(notesFor('A.md').up).toBe(`${EXAMPLE_LEAD}「イの前。up:: [[3]]。」／「ウの前。up:: [[4]]。」`);
    expect(notesFor('E.md').up).toBe(`${EXAMPLE_LEAD}「アの前。up:: [[1]]。」／「イの前。up:: [[3]]。」`);
    // One note per example: A.md has two `up` links but only contributes one passage.
    expect(notesFor('E.md').up).not.toContain('アの二本目');
    // `down` is only used by E.md, so E.md gets no example for it rather than its own.
    expect(notesFor('E.md')).not.toHaveProperty('down');
    expect(notesFor('A.md').down).toBe(`${EXAMPLE_LEAD}「オの前。down:: [[8]]。」`);
  });

  it('narrows the example pool too, so a dropped field costs nothing', () => {
    const plan = buildCriteriaPlan('both', entries, { minUses: 2 });

    expect([...plan.examples.keys()]).toEqual(['up', 'origin']);
    expect(criteriaOptionsFor(plan, 'A.md').fields).toEqual(['up', 'origin']);
  });
});

describe('what a run would cost before it spends anything', () => {
  it('prices the requests it has built, and only the ones it still has to ask', () => {
    const asks = [
      { body: '0'.repeat(4000), state: '0'.repeat(1000) },
      { body: '0'.repeat(6000), state: '0'.repeat(1400) },
    ];

    const estimate = estimateAsks(asks, { candidates: 52, missing: 2, price: 0.042, rate: 150 });

    expect(estimate).toMatchObject({ calls: 2, missing: 2, candidates: 52, averageChars: 5000, maxChars: 6000 });
    // 5,000 字 × 0.745 トークン/字 ≒ 3,726 トークン。
    expect(estimate.averageTokens).toBeCloseTo(3726, 0);
    expect(estimate.totalYen).toBeCloseTo(estimate.perCallYen * 2, 8);
    expect(estimateAsks(asks, { candidates: 52, missing: 0, price: 0.042, rate: 150 }).totalYen).toBe(0);
  });
});

describe('the comparison of the conditions', () => {
  const summaryOf = (fieldRate) => ({
    judged: 500,
    failures: [],
    selection: { total: 2647, eligible: 2448, skipped: 199 },
    overall: { count: 500, fieldRate, directionRate: 0.4 },
    directionOnly: 0.3,
    consistency: { confident: { count: 200, fieldRate: 0.2, directionRate: 1 }, unconfident: { count: 300, fieldRate: 0.1, directionRate: 0 } },
    thresholds: [{ threshold: 0.8, coverage: 0.1, precision: 0.5, count: 50, confidentCoverage: 0.05, confidentPrecision: 0.6, confidentCount: 25 }],
    ranks: [{ rank: 1, hit: fieldRate }, { rank: 3, hit: 0.5 }, { rank: 5, hit: 0.6 }, { rank: 10, hit: 0.7 }],
    confusion: Array.from({ length: 8 }, (_, index) => ({ truth: 'up', answer: `x${index}`, count: 8 - index, sameDirection: 0 })),
    directions: [{ direction: 'leftFriend', count: 105, fieldRate: 0.1, directionRate: 0 }],
    tokens: { averageTokens: 2299 },
    cost: { perCallYen: 0.0145, totalYen: 7.24 },
  });
  const context = {
    criteria: 'narrow', criteriaLabel: '候補を絞る', levers: ['narrow'], candidates: 52,
    at: '2026-09-22T05:00:00.000Z', endpoint: 'e', model: 'm', seed: 1, limit: 500, mask: 'on', contextChars: 500,
  };

  it('keeps one comparison row per run, with the top five confusions', () => {
    const file = comparisonFile(summaryOf(0.24), context);

    expect(file).toMatchObject({ criteria: 'narrow', label: '候補を絞る', levers: ['narrow'] });
    expect(file.row).toMatchObject({
      candidates: 52, eligible: 2448, judged: 500, failures: 0, fieldRate: 0.24, top3: 0.5, top5: 0.6, top10: 0.7,
      confidentShare: 0.4, confidentFieldRate: 0.2, averageTokens: 2299,
    });
    expect(file.row.confusion).toHaveLength(5);
  });

  it('puts the conditions side by side and reads a hand-written baseline the same way', () => {
    const measured = comparisonFile(summaryOf(0.24), context);
    const baseline = { criteria: 'default', label: '既定', at: '2026-09-22T00:35:07.487Z', note: 'LEV-163 から転記', row: { fieldRate: 0.13, top3: 0.402 } };

    const record = renderComparison([baseline, measured], { at: '2026-09-22T06:00:00.000Z', notes: ['## 推奨', '', 'narrow を採る。'] });

    expect(record).toContain('| 指標 | default | narrow |');
    expect(record).toContain('| フィールド一致率 | 13.0% | 24.0% |');
    // A baseline row that carries no threshold table or token count is shown as unmeasured, not as zero.
    expect(record).toContain('| 平均入力トークン | — | 2299 |');
    expect(record).toContain('| オントロジー内を一括したら | — | 35.50 円（2448 本） |');
    // What the condition costs in use, not what the measurement cost.
    expect(record).toContain('| 1 判定の費用 | — | 0.0145 円 |');
    expect(record).toContain('（LEV-163 から転記）');
    expect(record).toContain('| 左友 | — | 10.0% / 0.0%（105） |');
    expect(record).toContain('## 推奨');
  });

  it('writes the comparison from the summary files, inside artifacts/ only', () => {
    const directory = join(root, 'artifacts', 'jev-accuracy');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'summary-narrow.json'), JSON.stringify(comparisonFile(summaryOf(0.24), context)));
    writeFileSync(join(directory, 'summary-both.json'), JSON.stringify(comparisonFile(summaryOf(0.31), { ...context, criteria: 'both' })));

    const { outPath, record } = runCompare(root, {
      summaries: 'artifacts/jev-accuracy/summary-narrow.json, artifacts/jev-accuracy/summary-both.json',
      out: 'artifacts/jev-accuracy/record-v2.md',
      notes: null,
    });

    expect(outPath).toBe(join(directory, 'record-v2.md'));
    expect(readFileSync(outPath, 'utf8')).toBe(`${record}\n`);
    expect(record).toContain('| フィールド一致率 | 24.0% | 31.0% |');
    expect(() => runCompare(root, { summaries: 'artifacts/jev-accuracy/summary-narrow.json', out: '../escape.md' }))
      .toThrow(/artifacts/);
  });
});
