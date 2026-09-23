import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TFile, type LinkCache } from 'obsidian';
// The vault stub by its own path: Vitest serves the same module for `obsidian`, and its test-only
// members (`VaultStub.notes`, `dataFiles`) are not on the real typings (tests/jev/relations.test.ts).
import { VaultStub } from '../mocks/obsidian';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Page } from 'src/graph/Page';
import type { Pages } from 'src/graph/Pages';
import { LinkDirection, RelationType, type Hierarchy } from 'src/Types';
import { createEmptyHierarchyLowerCase, type HierarchyLowerCase } from 'src/utils/hierarchy';
import type { JevClientConfig, JevRequest, JevResponse } from 'src/jev/client';
import { typeLinkAtCursor } from 'src/jev/typeLink';
import { DIRECTION_NOTES } from 'src/jev/criteria';

/**
 * The wiring of one judgement (LEV-170): collect → buildState/buildQuestions → askJev → judge →
 * appendRelation → appendLogEntry. Jev itself is stubbed; what each piece does on its own is
 * fixed by collect.test.ts, state.test.ts, judge.test.ts and relations.test.ts.
 */

const LOG_PATH = '.obsidian/plugins/jevbrain/jev-log.json';

/** The ontology of the stub vault, in the settings' order. */
const hierarchy: Hierarchy = {
  hidden: ['ignore'],
  abstract: ['up'],
  concrete: ['down'],
  parents: ['origin'],
  children: [],
  leftFriends: ['similar'],
  rightFriends: [],
  previous: [],
  next: [],
  exclusions: [],
};

/** The same ontology as `Page` reads it (Dataview's keys); the stub vault writes the fields lowercase. */
const regions: HierarchyLowerCase = {
  ...createEmptyHierarchyLowerCase(),
  hidden: hierarchy.hidden,
  abstract: hierarchy.abstract,
  concrete: hierarchy.concrete,
  parents: hierarchy.parents,
  leftFriends: hierarchy.leftFriends,
};

const settingsStub = {
  excalibrainFilepath: 'excalibrain.md',
  excludeFilepaths: [],
  tagStyleList: [],
  primaryTagFieldLowerCase: 'note-type',
  renderAlias: false,
  showInferredNodes: true,
  showVirtualNodes: true,
  inferAllLinksAsFriends: false,
  inverseInfer: false,
  hierarchy,
  jev: {
    apiKey: 'test-key',
    enabled: true,
    suggestOnLinkClose: true,
    contextChars: 40,
    relationsHeading: 'Relations',
    writeMode: 'relations',
    candidateMinUses: 5,
    autoConfirmThreshold: 0,
    reviewThreshold: 0,
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
  },
} satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings;

/** A Dataview link value, as `readDVField` reads one. */
type DvLink = { path: string; type?: 'file' };

type Note = { content?: string; fields?: Record<string, DvLink | DvLink[]>; frontmatter?: Record<string, unknown> };

/** `[[X]]`, `![[X]]` and `[label](target)`, in the order they appear (tests/jev/collect.test.ts). */
const LINK = /(!?)\[\[([^\]]+)\]\]|\[([^\]]*)\]\(([^)]+)\)/gu;

function parseLinks(content: string): { links: LinkCache[]; embeds: LinkCache[] } {
  const links: LinkCache[] = [];
  const embeds: LinkCache[] = [];
  for (const match of content.matchAll(LINK)) {
    const [original, bang, wiki, label, markdown] = match;
    const index = match.index;
    const lineStart = content.lastIndexOf('\n', index - 1) + 1;
    const line = content.slice(0, lineStart).split('\n').length - 1;
    const col = index - lineStart;
    const [link, alias] = wiki === undefined ? [markdown, label] : wiki.split('|');
    const cache: LinkCache = {
      link,
      displayText: alias ?? link,
      original,
      position: {
        start: { line, col, offset: index },
        end: { line, col: col + original.length, offset: index + original.length },
      },
    };
    (bang === '!' ? embeds : links).push(cache);
  }
  return { links, embeds };
}

/** `VaultStub` plus what one judgement reads: the target note's text and the files themselves. */
class Vault extends VaultStub {
  /** Every call that changed a note, in order, so a test can see what ran before the write. */
  readonly steps: string[] = [];

  constructor(private files: Map<string, TFile>, notes: Record<string, string>) {
    super(notes);
  }

  process(file: TFile, fn: (data: string) => string): Promise<string> {
    this.steps.push('write');
    return super.process(file, fn);
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  cachedRead(file: TFile): Promise<string> {
    return Promise.resolve(this.notes.get(file.path) ?? '');
  }
}

/** A vault of markdown notes with the relations `Pages.addResolvedLinks` has already inferred. */
function makeVault(
  notes: Record<string, Note>,
  options: { excludeFilepaths?: string[]; writeMode?: 'relations' | 'inline' } = {},
) {
  const files = new Map(
    Object.keys(notes).map((path) => [path, Object.assign(new TFile(), { path, stat: { mtime: 0 } })]),
  );
  const vault = new Vault(
    files,
    Object.fromEntries(Object.entries(notes).map(([path, note]) => [path, note.content ?? ''])),
  );
  const caches = new Map(
    Object.entries(notes).map(([path, note]) => [
      path,
      { ...parseLinks(note.content ?? ''), frontmatter: note.frontmatter },
    ]),
  );
  const pages = new Map<string, Page>();
  const pagesStub = {
    get: (path: string) => pages.get(path),
    has: (path: string) => pages.has(path),
    add: (path: string, page: Page) => pages.set(path, page),
    // The field counts of the default criteria (LEV-191) read the whole index.
    forEach: (callback: (page: Page, path: string) => void) => { pages.forEach(callback); },
  } as unknown as Pages;
  // Obsidian resolves a link by path and then by name; the stub does the same, which is what lets
  // `[B](../notes/B.md)` and `[[B]]` both reach `notes/B.md`.
  const byName = (linkpath: string) => {
    const name = linkpath.split('/').pop() ?? linkpath;
    const basename = name.replace(/\.md$/u, '');
    return [...files.values()].find((file) => file.path.replace(/\.md$/u, '').split('/').pop() === basename);
  };
  const resolve = (linkpath: string) =>
    files.get(linkpath) ?? files.get(`${linkpath}.md`) ?? byName(linkpath) ?? null;
  const plugin = {
    settings: {
      ...settingsStub,
      excludeFilepaths: options.excludeFilepaths ?? [],
      jev: { ...settingsStub.jev, writeMode: options.writeMode ?? settingsStub.jev.writeMode },
    },
    hierarchyLowerCase: regions,
    manifest: { dir: '.obsidian/plugins/jevbrain' },
    pages: pagesStub,
    app: {
      vault,
      metadataCache: {
        getFirstLinkpathDest: resolve,
        getFileCache: (file: TFile) => caches.get(file.path) ?? null,
      },
    },
    DVAPI: {
      page: (path: string) => (notes[path] ? { ...notes[path].fields, file: { path } } : undefined),
    },
  } as unknown as ExcaliBrain;
  for (const [path, file] of files) pages.set(path, new Page(pagesStub, path, file, plugin));

  // Every body link already carries an inferred relation both ways, as it does in a drawn graph.
  for (const [path, cache] of caches) {
    const source = pages.get(path);
    for (const link of cache.links) {
      const linkpath = link.link.split('#')[0];
      const targetPath = resolve(linkpath)?.path ?? linkpath;
      const target = pages.get(targetPath) ?? new Page(pagesStub, targetPath, null, plugin);
      pages.set(targetPath, target);
      source.addChild(target, RelationType.INFERRED, LinkDirection.FROM);
      target.addParent(source, RelationType.INFERRED, LinkDirection.TO);
    }
  }

  return {
    plugin,
    vault,
    file: (path: string) => files.get(path),
    content: (path: string) => notes[path].content ?? '',
    log: () => JSON.parse(vault.dataFiles.get(LOG_PATH) ?? '[]') as Record<string, unknown>[],
  };
}

/** The cursor `offset` characters into the first occurrence of `snippet`. */
function cursorAt(content: string, snippet: string, offset = 2) {
  const index = content.indexOf(snippet) + offset;
  const before = content.slice(0, index);
  return { line: before.split('\n').length - 1, ch: index - (before.lastIndexOf('\n') + 1) };
}

const fixtures = fileURLToPath(new URL('../fixtures/jev', import.meta.url));

/** The wire shape of a recorded reply: `answers` keyed by question name, snake_case usage (client.ts). */
type RecordedReply = {
  body: {
    answers: Record<
      string,
      { type: string; choice: string; probabilities: Record<string, number>; confidence: number }
    >;
    usage: { input_tokens: number };
  };
};

/**
 * A recorded reply as `client.ts` hands it over: the answers keyed by question name, `type` dropped,
 * `input_tokens` read as `inputTokens`. Keep this in step with `parseResponseBody` when the wire
 * shape changes (it is the same conversion, written out for the stub).
 *
 * The default is `two-choice-agree-200.json` (Q1 `up` 0.82, Q2 `parent`, 1873 tokens), because the
 * response recorded from the real Jev on 2026-09-22 (`two-choice-200.json`) answers a field of the
 * parent region with `child` — that one is what the disagreement test asks for by name.
 */
function answer(
  overrides: { field?: string; direction?: string } = {},
  fixture = 'two-choice-agree-200.json',
): JevResponse {
  const recorded = JSON.parse(readFileSync(join(fixtures, fixture), 'utf8')) as RecordedReply;
  const questions = Object.fromEntries(
    Object.entries(recorded.body.answers).map(([name, wire]) => [
      name,
      { choice: wire.choice, probabilities: wire.probabilities, confidence: wire.confidence },
    ]),
  );
  if (overrides.field) questions.field.choice = overrides.field;
  if (overrides.direction) questions.direction.choice = overrides.direction;
  return { questions, usage: { inputTokens: recorded.body.usage.input_tokens } };
}

/** `askJev` replaced by a recorder; the tests never reach the network (design §9). */
function asking(response: JevResponse | null) {
  const calls: { config: JevClientConfig; request: JevRequest }[] = [];
  return {
    calls,
    deps: {
      ask: (config: JevClientConfig, request: JevRequest): Promise<JevResponse | null> => {
        calls.push({ config, request });
        return Promise.resolve(response);
      },
    },
  };
}

const note = ['# A', '', '本文で [[B]] に触れる。', ''].join('\n');

describe('typeLinkAtCursor', () => {
  it('asks Jev about the link at the cursor and appends the first candidate to ## Relations', async () => {
    const vault = makeVault({
      'A.md': { content: note, frontmatter: { tags: ['習慣'] } },
      'B.md': { content: 'B の冒頭。' },
    });
    const jev = asking(answer());

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      jev.deps,
    );

    expect(result).toEqual({
      status: 'written',
      field: 'up',
      target: 'B',
      probability: 0.82,
      inputTokens: 1873,
      // 記録は実測の usage を持つので、見積もりの印は立たない（client.ts）。
      estimatedTokens: undefined,
      logged: true,
    });
    expect(vault.vault.notes.get('A.md')).toBe(`${note}\n## Relations\nup:: [[B]]`);
    expect(vault.log()).toEqual([
      {
        id: expect.any(String) as unknown,
        batchId: expect.stringMatching(/^command-/u) as unknown,
        file: 'A.md',
        line: 4,
        before: '',
        after: '## Relations\nup:: [[B]]',
        at: expect.any(String) as unknown,
        source: 'command',
      },
    ]);
  });

  it('sends the key, the context around the link, the target note and both questions', async () => {
    const vault = makeVault({
      'A.md': { content: note, frontmatter: { tags: ['習慣'] } },
      'B.md': { content: 'B の冒頭。' },
    });
    const jev = asking(answer());

    await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      jev.deps,
    );

    expect(jev.calls).toHaveLength(1);
    const { config, request } = jev.calls[0];
    expect(config).toEqual({
      apiKey: 'test-key',
      endpoint: 'https://api.typesafe.ai/v1/systemone',
      model: 'jev-latest',
      timeoutMs: 10_000,
    });
    expect(JSON.parse(request.state as string)).toEqual({
      note: { frontmatter: { tags: ['習慣'] }, context: '# A\n\n本文で [[B]] に触れる。\n' },
      target: { name: 'B', frontmatter: null, excerpt: 'B の冒頭。' },
    });
    // Q1 は設定の順の全フィールド（hidden を除く）、Q2 は 6 方向（judge.ts）。client.ts が送る形に変える。
    expect(request.questions.field.kind).toBe('choice');
    expect(request.questions.field.instructions).toBe('このリンクに付けるフィールド');
    expect(Object.keys(request.questions.field.criteria)).toEqual(['up', 'down', 'origin', 'similar']);
    expect(request.questions.field.criteria.up).toBe('Up（抽象）・方向: 親');
    expect(Object.keys(request.questions.direction.criteria)).toEqual([
      'parent', 'child', 'leftFriend', 'rightFriend', 'previous', 'next',
    ]);
    // 既定の criteria（LEV-191）: この Vault に 5 回使われたフィールドは無いので Q1 は全部、Q2 に方向の 1 文。
    expect(request.questions.direction.criteria.parent).toBe(`親。${DIRECTION_NOTES.parent}`);
  });

  it('writes the link as the body writes it, not the resolved path or the alias', async () => {
    const content = '本文で [[B|ビー]] に触れる。';
    const vault = makeVault({ 'A.md': { content }, 'notes/B.md': { content: 'B の冒頭。' } });
    const jev = asking(answer({ field: 'similar', direction: 'leftFriend' }));

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: cursorAt(content, '[[B|ビー]]') },
      jev.deps,
    );

    expect(result).toMatchObject({ status: 'written', field: 'similar', target: 'B' });
    expect(vault.vault.notes.get('A.md')).toBe(`${content}\n\n## Relations\nsimilar:: [[B]]`);
    expect((JSON.parse(jev.calls[0].request.state as string) as { target: { name: string } }).target.name).toBe('B');
  });

  it('asks about a link whose file does not exist and sends its name only', async () => {
    const content = '本文で [[まだ無いノート]] に触れる。';
    const vault = makeVault({ 'A.md': { content } });
    const jev = asking(answer());

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: cursorAt(content, '[[まだ無いノート]]') },
      jev.deps,
    );

    expect(result).toMatchObject({ status: 'written', field: 'up', target: 'まだ無いノート' });
    expect(JSON.parse(jev.calls[0].request.state as string)).toEqual({
      note: { frontmatter: null, context: content },
      target: { name: 'まだ無いノート' },
    });
  });

  it('writes nothing when the field and the direction disagree', async () => {
    // 実機 E18 で記録した応答そのもの: Q1 が up（親の領域）なのに Q2 が child。
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(answer({}, 'two-choice-200.json'));

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      jev.deps,
    );

    // 自信なしでも候補は確率順の上位 5 件（judge.ts、LEV-187）。応答の確率は up 0.39・down 0.3・
    // similar 0.17 で、origin には付いていないので出ない。ノートも記録も触らない。
    expect(result).toEqual({
      status: 'unconfident',
      reason: 'direction',
      target: 'B',
      answer: 'up',
      candidates: ['up', 'down', 'similar'],
    });
    expect(vault.vault.notes.get('A.md')).toBe(note);
    expect(vault.log()).toEqual([]);
  });

  it('writes nothing when Jev does not answer', async () => {
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(null);

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      jev.deps,
    );

    expect(result).toEqual({ status: 'failed' });
    expect(vault.vault.notes.get('A.md')).toBe(note);
    expect(vault.log()).toEqual([]);
  });

  it('does not ask when the cursor is not on a link that needs a field', async () => {
    const content = [
      '素の文のうえ。',
      '型の付いた [[C]] と埋め込みの ![[D]] と ![図](D.md)。',
    ].join('\n');
    const vault = makeVault({
      'A.md': { content, fields: { origin: { path: 'C.md', type: 'file' } } },
      'C.md': {},
      'D.md': {},
    });
    const jev = asking(answer());
    const run = (cursor: { line: number; ch: number }) =>
      typeLinkAtCursor(vault.plugin, { file: vault.file('A.md'), content, cursor }, jev.deps);

    expect(await run(cursorAt(content, '素の文', 1))).toEqual({ status: 'no-untyped-link' });
    expect(await run(cursorAt(content, '[[C]]'))).toEqual({ status: 'no-untyped-link' });
    expect(await run(cursorAt(content, '![[D]]', 3))).toEqual({ status: 'no-untyped-link' });
    expect(await run(cursorAt(content, '![図](D.md)', 3))).toEqual({ status: 'no-untyped-link' });
    expect(jev.calls).toEqual([]);
    expect(vault.vault.notes.get('A.md')).toBe(content);
  });

  it('writes nothing when the same line is already in the section', async () => {
    // 行はあるが Dataview の索引がまだ追いついていない状態: 二重書きは appendRelation が止める。
    const content = [...note.split('\n'), '## Relations', 'up:: [[B]]'].join('\n');
    const vault = makeVault({ 'A.md': { content }, 'B.md': {} });
    const jev = asking(answer());

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: cursorAt(content, '[[B]]') },
      jev.deps,
    );

    expect(result).toEqual({ status: 'unchanged', field: 'up', target: 'B' });
    expect(vault.vault.notes.get('A.md')).toBe(content);
    expect(vault.log()).toEqual([]);
  });

  it('writes the resolved path for a markdown link, which a wikilink can reach', async () => {
    // `[[../notes/B.md]]` はリンクとして解決しないので、本文の綴りではなく解決したパスを書く。
    const content = 'テンプレートは [B](../notes/B.md) に寄せる。';
    const vault = makeVault({ 'x/A.md': { content }, 'notes/B.md': { content: 'B の冒頭。' } });
    const jev = asking(answer());

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('x/A.md'), content, cursor: cursorAt(content, '[B](../notes/B.md)', 2) },
      jev.deps,
    );

    expect(result).toMatchObject({ status: 'written', field: 'up', target: 'notes/B.md' });
    expect(vault.vault.notes.get('x/A.md')).toBe(`${content}\n\n## Relations\nup:: [[notes/B.md]]`);
  });

  it('writes nothing and asks nothing for a markdown link whose note does not exist (LEV-188)', async () => {
    // 再現: `x/A.md` の `[B](../notes/B.md)`、`notes/B.md` は無い。`[[../notes/B.md]]` は Obsidian で
    // 解決しないので、書けば切れたリンクが残り、そのリンクは型が付かないまま何度でも判定に回る。
    const content = 'テンプレートは [B](../notes/B.md) に寄せる。';
    const vault = makeVault({ 'x/A.md': { content } }, { writeMode: 'inline' });
    const jev = asking(answer());

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('x/A.md'), content, cursor: cursorAt(content, '[B](../notes/B.md)', 2) },
      jev.deps,
    );

    expect(result).toEqual({ status: 'unresolved-markdown', target: '../notes/B.md' });
    expect(jev.calls).toEqual([]);
    expect(vault.vault.notes.get('x/A.md')).toBe(content);
    expect(vault.log()).toEqual([]);
  });

  it('treats a URL at the cursor as no link, not as a missing note (LEV-188)', async () => {
    const content = '[docs](https://example.com) と [x](mailto:a@example.com)。';
    const vault = makeVault({ 'A.md': { content } });
    const jev = asking(answer());

    for (const snippet of ['[docs](https://example.com)', '[x](mailto:a@example.com)']) {
      const result = await typeLinkAtCursor(
        vault.plugin,
        { file: vault.file('A.md'), content, cursor: cursorAt(content, snippet) },
        jev.deps,
      );
      expect(result).toEqual({ status: 'no-untyped-link' });
    }
    expect(jev.calls).toEqual([]);
  });

  it('still types a wikilink to a note that does not exist yet (LEV-188)', async () => {
    // `[[まだ無いノート]]` はそのまま書き戻せて、JevBrain も仮想ノードとして扱える。
    const content = '次は [[まだ無いノート]] に書く。';
    const vault = makeVault({ 'A.md': { content } });
    const jev = asking(answer());

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: cursorAt(content, '[[まだ無いノート]]') },
      jev.deps,
    );

    expect(result).toMatchObject({ status: 'written', field: 'up', target: 'まだ無いノート' });
    expect(jev.calls).toHaveLength(1);
    expect(vault.vault.notes.get('A.md')).toBe(`${content}\n\n## Relations\nup:: [[まだ無いノート]]`);
  });

  it('types the occurrence the cursor is on, not the first one to the same note (LEV-185)', async () => {
    // 再現 1: 同じ相手への `[[B]]` が 2 つある本文で、2 つ目にカーソルを置く。
    const content = ['本文で [[B]] に触れる。', 'もう一度 [[B]] と書く。'].join('\n');
    const vault = makeVault({ 'A.md': { content }, 'B.md': {} }, { writeMode: 'inline' });
    const jev = asking(answer());

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: { line: 1, ch: 5 } },
      jev.deps,
    );

    expect(result).toMatchObject({ status: 'written', field: 'up', target: 'B' });
    expect(vault.vault.notes.get('A.md')).toBe(['本文で [[B]] に触れる。', 'もう一度 (up:: [[B]]) と書く。'].join('\n'));
    expect(vault.log()).toMatchObject([
      { file: 'A.md', line: 1, before: 'もう一度 [[B]] と書く。', after: 'もう一度 (up:: [[B]]) と書く。' },
    ]);
  });

  it('writes no brackets when the link is the whole line', async () => {
    const content = '# A\n\n[[B]]\n';
    const vault = makeVault({ 'A.md': { content }, 'B.md': {} }, { writeMode: 'inline' });

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: { line: 2, ch: 0 } },
      asking(answer()).deps,
    );

    expect(result).toMatchObject({ status: 'written' });
    expect(vault.vault.notes.get('A.md')).toBe('# A\n\nup:: [[B]]\n');
  });

  it('drops a markdown link into the Relations section, inline mode and all (LEV-185)', async () => {
    // 再現 2: `(up:: [B](…))` は書かず、`[[…]]` で節に 1 行足す（設計 §3）。
    const content = 'テンプレートは [B](../notes/B.md) に寄せる。';
    const vault = makeVault(
      { 'x/A.md': { content }, 'notes/B.md': { content: 'B の冒頭。' } },
      { writeMode: 'inline' },
    );

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('x/A.md'), content, cursor: cursorAt(content, '[B](../notes/B.md)', 0) },
      asking(answer()).deps,
    );

    expect(result).toMatchObject({ status: 'written', field: 'up', target: 'notes/B.md' });
    expect(vault.vault.notes.get('x/A.md')).toBe(`${content}\n\n## Relations\nup:: [[notes/B.md]]`);
  });

  it('writes nothing when the link left the cursor while Jev was answering', async () => {
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} }, { writeMode: 'inline' });
    // 読むのはバッファ、書くのはファイル。判定を待つ間にその行が書き換わった状態にする。
    vault.vault.notes.set('A.md', '# A\n\n書き直した本文。\n');

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      asking(answer()).deps,
    );

    expect(result).toEqual({ status: 'link-gone', field: 'up', target: 'B' });
    expect(vault.vault.notes.get('A.md')).toBe('# A\n\n書き直した本文。\n');
    expect(vault.log()).toEqual([]);
  });

  it('writes nothing when the cursor is on a link that already carries a field', async () => {
    const content = '本文で (origin:: [[B]]) に触れる。';
    const vault = makeVault({ 'A.md': { content }, 'B.md': {} }, { writeMode: 'inline' });

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: cursorAt(content, '[[B]]') },
      asking(answer()).deps,
    );

    expect(result).toEqual({ status: 'unchanged', field: 'up', target: 'B' });
    expect(vault.vault.notes.get('A.md')).toBe(content);
  });

  it('writes the ontology spelling of the field, not the answer as Jev spelled it', async () => {
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(answer({ field: 'Up' }));

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      jev.deps,
    );

    expect(result).toMatchObject({ status: 'written', field: 'up', probability: 0.82 });
    expect(vault.vault.notes.get('A.md')).toContain('up:: [[B]]');
  });

  it('tells a field outside the ontology apart from a direction that disagrees', async () => {
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(answer({ field: 'まだ無いフィールド' }));

    expect(
      await typeLinkAtCursor(
        vault.plugin,
        { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
        jev.deps,
      ),
    ).toMatchObject({ status: 'unconfident', reason: 'unknown-field', answer: 'まだ無いフィールド' });
    expect(vault.vault.notes.get('A.md')).toBe(note);
  });

  it('flushes the editor buffer to the file before writing', async () => {
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(answer());

    await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      {
        ...jev.deps,
        flush: () => {
          vault.vault.steps.push('flush');
          return Promise.resolve();
        },
      },
    );

    // 読むのはバッファ、書くのはファイル。順が逆だと、次の自動保存が追記した行を巻き戻す。
    expect(vault.vault.steps).toEqual(['flush', 'write']);
  });

  it('writes nothing into a note the graph leaves out', async () => {
    const vault = makeVault({
      'アーカイブ/A.md': { content: note },
      'excalibrain.md': { content: note },
      'B.md': {},
    }, { excludeFilepaths: ['アーカイブ/'] });
    const jev = asking(answer());
    const run = (path: string) =>
      typeLinkAtCursor(
        vault.plugin,
        { file: vault.file(path), content: note, cursor: cursorAt(note, '[[B]]') },
        jev.deps,
      );

    expect(await run('アーカイブ/A.md')).toEqual({ status: 'excluded' });
    expect(await run('excalibrain.md')).toEqual({ status: 'excluded' });
    expect(jev.calls).toEqual([]);
  });

  it('asks nothing while the note is not in the index', async () => {
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(answer());
    const outside = Object.assign(new TFile(), { path: 'Z.md', stat: { mtime: 0 } });

    expect(
      await typeLinkAtCursor(
        vault.plugin,
        { file: outside, content: note, cursor: cursorAt(note, '[[B]]') },
        jev.deps,
      ),
    ).toEqual({ status: 'no-index' });
    expect(jev.calls).toEqual([]);
  });
});
