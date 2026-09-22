import { describe, expect, it } from 'vitest';
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
    autoConfirmThreshold: 0.8,
    reviewThreshold: 0.9,
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
  constructor(private files: Map<string, TFile>, notes: Record<string, string>) {
    super(notes);
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  cachedRead(file: TFile): Promise<string> {
    return Promise.resolve(this.notes.get(file.path) ?? '');
  }
}

/** A vault of markdown notes with the relations `Pages.addResolvedLinks` has already inferred. */
function makeVault(notes: Record<string, Note>) {
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
  } as unknown as Pages;
  const resolve = (linkpath: string) => files.get(linkpath) ?? files.get(`${linkpath}.md`) ?? null;
  const plugin = {
    settings: settingsStub,
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

/** One recorded response, in the shape `client.ts` hands over (docs/jev-link-typer-design.md §7). */
const answer = (field: string, direction: string, probability = 0.92): JevResponse => ({
  questions: {
    field: { choice: field, probabilities: { [field]: probability, origin: 0.05 }, confidence: probability },
    direction: { choice: direction, probabilities: { [direction]: 0.9 }, confidence: 0.9 },
  },
  usage: { inputTokens: 1234 },
});

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
    const jev = asking(answer('up', 'parent'));

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      jev.deps,
    );

    expect(result).toEqual({
      status: 'written',
      field: 'up',
      target: 'B',
      probability: 0.92,
      inputTokens: 1234,
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
    const jev = asking(answer('up', 'parent'));

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
  });

  it('writes the link as the body writes it, not the resolved path or the alias', async () => {
    const content = '本文で [[B|ビー]] に触れる。';
    const vault = makeVault({ 'A.md': { content }, 'notes/B.md': { content: 'B の冒頭。' } });
    const jev = asking(answer('similar', 'leftFriend'));

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
    const jev = asking(answer('up', 'parent'));

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
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(answer('up', 'child'));

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content: note, cursor: cursorAt(note, '[[B]]') },
      jev.deps,
    );

    // 自信なしは確率を伏せ、候補は設定の順（judge.ts）。ノートも記録も触らない。
    expect(result).toEqual({ status: 'unconfident', target: 'B', candidates: ['up', 'down', 'origin', 'similar'] });
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
      '型の付いた [[C]] と埋め込みの ![[D]]。',
    ].join('\n');
    const vault = makeVault({
      'A.md': { content, fields: { origin: { path: 'C.md', type: 'file' } } },
      'C.md': {},
      'D.md': {},
    });
    const jev = asking(answer('up', 'parent'));
    const run = (cursor: { line: number; ch: number }) =>
      typeLinkAtCursor(vault.plugin, { file: vault.file('A.md'), content, cursor }, jev.deps);

    expect(await run(cursorAt(content, '素の文', 1))).toEqual({ status: 'no-untyped-link' });
    expect(await run(cursorAt(content, '[[C]]'))).toEqual({ status: 'no-untyped-link' });
    expect(await run(cursorAt(content, '![[D]]', 3))).toEqual({ status: 'no-untyped-link' });
    expect(jev.calls).toEqual([]);
    expect(vault.vault.notes.get('A.md')).toBe(content);
  });

  it('writes nothing when the same line is already in the section', async () => {
    // 行はあるが Dataview の索引がまだ追いついていない状態: 二重書きは appendRelation が止める。
    const content = [...note.split('\n'), '## Relations', 'up:: [[B]]'].join('\n');
    const vault = makeVault({ 'A.md': { content }, 'B.md': {} });
    const jev = asking(answer('up', 'parent'));

    const result = await typeLinkAtCursor(
      vault.plugin,
      { file: vault.file('A.md'), content, cursor: cursorAt(content, '[[B]]') },
      jev.deps,
    );

    expect(result).toEqual({ status: 'unchanged', field: 'up', target: 'B' });
    expect(vault.vault.notes.get('A.md')).toBe(content);
    expect(vault.log()).toEqual([]);
  });

  it('asks nothing while the note is not in the index', async () => {
    const vault = makeVault({ 'A.md': { content: note }, 'B.md': {} });
    const jev = asking(answer('up', 'parent'));
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
