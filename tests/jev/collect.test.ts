import { describe, expect, it } from 'vitest';
import { TFile, type LinkCache } from 'obsidian';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Page } from 'src/graph/Page';
import type { Pages } from 'src/graph/Pages';
import { LinkDirection, RelationType } from 'src/Types';
import { createEmptyHierarchyLowerCase, type HierarchyLowerCase } from 'src/utils/hierarchy';
import { collectTypedLinks, collectUntypedLinks } from 'src/jev/collect';

/** A Dataview link value; `readDVField` only reads the items of a multi-value field when they carry the type. */
type DvLink = { path: string; type?: 'file' };

/**
 * A note of the stub vault: its text (which the link cache is parsed from, as Obsidian does)
 * and its Dataview fields (a field's value is a link object, like in
 * tests/graph/page-relations.test.ts).
 */
type Note = { content?: string; fields?: Record<string, DvLink | DvLink[]> };

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
} satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings;

/** `[[X]]`, `![[X]]` and `[label](target)`, in the order they appear. */
const LINK = /(!?)\[\[([^\]]+)\]\]|\[([^\]]*)\]\(([^)]+)\)/gu;

/** The `links` and `embeds` of a note's cache, with the positions Obsidian would report. */
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

/**
 * A vault of markdown notes. Links resolve by path or by basename (`[[B]]` → `B.md`), so a
 * link to a note that is not listed stays unresolved, as in Obsidian.
 */
function makeVault(
  notes: Record<string, Note>,
  options: { regions?: Partial<HierarchyLowerCase>; excludeFilepaths?: string[] } = {},
) {
  const files = new Map(
    Object.keys(notes).map((path) => [path, Object.assign(new TFile(), { path, stat: { mtime: 0 } })]),
  );
  const caches = new Map(
    Object.entries(notes).map(([path, note]) => [path, parseLinks(note.content ?? '')]),
  );
  const pages = new Map<string, Page>();
  const pagesStub = {
    get: (path: string) => pages.get(path),
    add: (path: string, page: Page) => pages.set(path, page),
  } as unknown as Pages;
  const resolve = (linkpath: string) => files.get(linkpath) ?? files.get(`${linkpath}.md`) ?? null;
  const plugin = {
    settings: { ...settingsStub, excludeFilepaths: options.excludeFilepaths ?? [] },
    hierarchyLowerCase: { ...createEmptyHierarchyLowerCase(), ...options.regions },
    pages: pagesStub,
    app: {
      vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
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

  // What `Pages.addResolvedLinks` / `addUnresolvedLinks` have already done by the time
  // `collect*` runs: every body link carries an inferred relation both ways
  // (src/graph/Pages.ts `addInferredParentChild`). External links go through `URLParser`
  // instead and get none.
  for (const [path, cache] of caches) {
    const source = pages.get(path);
    for (const link of cache.links) {
      if (/^[a-z][\w+\-.]*:\/\//iu.test(link.link)) continue;
      const linkpath = link.link.split('#')[0];
      const targetPath = resolve(linkpath)?.path ?? linkpath;
      const target = pages.get(targetPath) ?? new Page(pagesStub, targetPath, null, plugin);
      pages.set(targetPath, target);
      source.addChild(target, RelationType.INFERRED, LinkDirection.FROM);
      target.addParent(source, RelationType.INFERRED, LinkDirection.TO);
    }
  }

  return {
    app: plugin.app,
    plugin,
    page: (path: string) => pages.get(path),
    file: (path: string) => files.get(path),
    content: (path: string) => notes[path].content ?? '',
  };
}

/** Everything `collect*` needs for one note of the stub vault. */
const argsFor = (vault: ReturnType<typeof makeVault>, path: string) =>
  [vault.app, vault.page(path), vault.file(path), vault.content(path)] as const;

const regions: Partial<HierarchyLowerCase> = { parents: ['origin'], leftFriends: ['similar'], hidden: ['ignore'] };

describe('collectUntypedLinks', () => {
  it('returns only the untyped links of a note with typed links, an embed and a URL', () => {
    const vault = makeVault(
      {
        'A.md': {
          content: [
            '# A',
            '',
            '本文で [[B]] と [[C]] に触れる。',
            '[[D]] は段落を変えて置く。',
            '',
            '![[E]] を埋め込み、[外部](https://example.com/x) を貼る。',
            '',
            '## Relations',
            '',
            'origin:: [[F]]',
            'similar:: [[G]]',
          ].join('\n'),
          fields: { origin: { path: 'F.md' }, similar: { path: 'G.md' } },
        },
        'B.md': {}, 'C.md': {}, 'D.md': {}, 'E.md': {}, 'F.md': {}, 'G.md': {},
      },
      { regions },
    );

    const untyped = collectUntypedLinks(...argsFor(vault, 'A.md'));
    expect(untyped.map((link) => link.target)).toEqual(['B.md', 'C.md', 'D.md']);
    expect(untyped[0]).toEqual({
      target: 'B.md',
      displayText: 'B',
      line: 2,
      ch: 4,
      context: '本文で [[B]] と [[C]] に触れる。',
    });
    expect(untyped[2]).toMatchObject({ line: 3, ch: 0, context: '[[D]] は段落を変えて置く。' });
  });

  it('keeps the first occurrence of a target and leaves the note itself out', () => {
    const vault = makeVault(
      { 'A.md': { content: '[[A]] と [[B]]。\nもう一度 [[B|別名]]。' }, 'B.md': {} },
      { regions },
    );
    expect(collectUntypedLinks(...argsFor(vault, 'A.md'))).toEqual([
      { target: 'B.md', displayText: 'B', line: 0, ch: 8, context: '[[A]] と [[B]]。' },
    ]);
  });

  it('reads an alias and a heading link as one target, and an unresolved link by its name', () => {
    const vault = makeVault({ 'A.md': { content: '[[B#節|別名]] と [[まだ無いノート]]。' }, 'B.md': {} }, { regions });
    expect(collectUntypedLinks(...argsFor(vault, 'A.md'))).toEqual([
      { target: 'B.md', displayText: '別名', line: 0, ch: 0, context: '[[B#節|別名]] と [[まだ無いノート]]。' },
      { target: 'まだ無いノート', displayText: 'まだ無いノート', line: 0, ch: 13, context: '[[B#節|別名]] と [[まだ無いノート]]。' },
    ]);
  });

  it('resolves a markdown link to a note, falls back to its target when the label is empty, and skips a URL', () => {
    const content = '[ラベル](Some%20Note.md) と [](B.md) と [外部](http://example.com)。';
    const vault = makeVault({ 'A.md': { content }, 'Some Note.md': {}, 'B.md': {} }, { regions });
    expect(collectUntypedLinks(...argsFor(vault, 'A.md'))).toEqual([
      { target: 'Some Note.md', displayText: 'ラベル', line: 0, ch: 0, context: content },
      { target: 'B.md', displayText: 'B.md', line: 0, ch: 24, context: content },
    ]);
  });

  it('leaves out a target of a hidden field, one under an excluded path and the brain drawing', () => {
    const vault = makeVault(
      {
        'A.md': {
          content: '[[B]] と [[アーカイブ/C]] と [[excalibrain]] と [[D]]。',
          fields: { ignore: { path: 'B.md' } },
        },
        'B.md': {}, 'アーカイブ/C.md': {}, 'excalibrain.md': {}, 'D.md': {},
      },
      { regions, excludeFilepaths: ['アーカイブ/'] },
    );
    expect(collectUntypedLinks(...argsFor(vault, 'A.md')).map((link) => link.target)).toEqual(['D.md']);
    expect(collectTypedLinks(...argsFor(vault, 'A.md'))).toEqual([]);
  });

  it('keeps a link the graph only inferred, and leaves one the neighbour defines out of both lists', () => {
    const vault = makeVault(
      {
        'A.md': { content: '[[B]] と [[C]]。' },
        'B.md': {},
        'C.md': { content: 'origin:: [[A]]', fields: { origin: { path: 'A.md' } } },
      },
      { regions },
    );
    expect(collectUntypedLinks(...argsFor(vault, 'A.md')).map((link) => link.target)).toEqual(['B.md']);
    // C.md types the pair from its own side (`origin:: [[A]]`): A has nothing to ask and no
    // line of its own to review, so [[C]] is in neither list.
    expect(collectTypedLinks(...argsFor(vault, 'A.md'))).toEqual([]);
    expect(collectTypedLinks(...argsFor(vault, 'C.md')).map((link) => link.fields)).toEqual([['origin']]);
  });

  it('keeps ch aligned with the line it returns, whatever the indentation', () => {
    const vault = makeVault({ 'A.md': { content: '- 箇条書き\n    - 入れ子で [[B]] に触れる' }, 'B.md': {} }, { regions });
    const [link] = collectUntypedLinks(...argsFor(vault, 'A.md'));
    expect(link).toMatchObject({ line: 1, ch: 11, context: '    - 入れ子で [[B]] に触れる' });
    expect(link.context.slice(link.ch)).toMatch(/^\[\[B\]\]/u);
  });
});

describe('collectTypedLinks', () => {
  it('returns the fields a link is typed with, one entry per field of the relation', () => {
    const vault = makeVault(
      {
        'A.md': {
          content: 'origin:: [[B]]\nsimilar:: [[C]]\n[[D]] は素のまま。',
          fields: {
            origin: [{ path: 'B.md', type: 'file' }, { path: 'C.md', type: 'file' }],
            similar: { path: 'C.md' },
          },
        },
        'B.md': {}, 'C.md': {}, 'D.md': {},
      },
      { regions },
    );
    expect(collectTypedLinks(...argsFor(vault, 'A.md'))).toEqual([
      { target: 'B.md', displayText: 'B', line: 0, ch: 9, context: 'origin:: [[B]]', fields: ['origin'] },
      { target: 'C.md', displayText: 'C', line: 1, ch: 10, context: 'similar:: [[C]]', fields: ['origin', 'similar'] },
    ]);
    expect(collectUntypedLinks(...argsFor(vault, 'A.md')).map((link) => link.target)).toEqual(['D.md']);
  });

  it('returns nothing for a note without links', () => {
    const vault = makeVault({ 'A.md': { content: '# A\n\n本文だけ。' } }, { regions });
    expect(collectTypedLinks(...argsFor(vault, 'A.md'))).toEqual([]);
    expect(collectUntypedLinks(...argsFor(vault, 'A.md'))).toEqual([]);
  });
});
