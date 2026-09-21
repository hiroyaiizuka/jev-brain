import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Page } from 'src/graph/Page';
import type { Pages } from 'src/graph/Pages';
import { LinkDirection, RelationType } from 'src/Types';
import { axisOf, createEmptyHierarchyLowerCase, type HierarchyLowerCase } from 'src/utils/hierarchy';

/**
 * The slice of the plugin that `Page.addDVFieldLinksToPage()` and the relation getters touch.
 * Dataview is replaced by a map from note path to its fields; a field's value is a Dataview
 * link object (`{ path }`), which `readDVField` resolves through `metadataCache`. Every note
 * exists as a TFile so nothing is virtual and no unresolved page is created.
 */
type DvFields = Record<string, { path: string } | { path: string }[]>;

const settingsStub = {
  excalibrainFilepath: 'excalibrain.md',
  tagStyleList: [],
  primaryTagFieldLowerCase: 'note-type',
  renderAlias: false,
  showInferredNodes: true,
  showVirtualNodes: true,
  showAttachments: true,
  showFolderNodes: true,
  showTagNodes: true,
  showPageNodes: true,
  showURLNodes: true,
  inferAllLinksAsFriends: false,
  inverseInfer: false,
} satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings;

function makeVault(notes: Record<string, DvFields>, regions: Partial<HierarchyLowerCase>) {
  const files = new Map(Object.keys(notes).map((path) => [path, Object.assign(new TFile(), { path, stat: { mtime: 0 } })]));
  const pages = new Map<string, Page>();
  const plugin = {
    settings: settingsStub,
    hierarchyLowerCase: { ...createEmptyHierarchyLowerCase(), ...regions },
    app: {
      vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
      metadataCache: { getFirstLinkpathDest: (link: string) => files.get(link) ?? null },
    },
    DVAPI: { page: (path: string) => (notes[path] ? { ...notes[path], file: { path } } : undefined) },
  } as unknown as ExcaliBrain;
  const pagesStub = { get: (path: string) => pages.get(path), add: (path: string, page: Page) => pages.set(path, page) };
  for (const [path, file] of files) pages.set(path, new Page(pagesStub as unknown as Pages, path, file, plugin));
  return { page: (path: string) => pages.get(path), plugin };
}

/** The relation as the neighbour's getters would report it, keyed by the neighbour's path. */
const parentsOf = (page: Page) => Object.fromEntries(page.getParents().map((n) => [n.page.path, n.typeDefinition]));
const childrenOf = (page: Page) => Object.fromEntries(page.getChildren().map((n) => [n.page.path, n.typeDefinition]));

describe('Page.addDVFieldLinksToPage with Up / Down fields', () => {
  const regions: Partial<HierarchyLowerCase> = {
    abstract: ['part-of'],
    parents: ['origin'],
    concrete: ['example'],
    children: ['steps'],
  };

  it('puts an Up field with the parents and a Down field with the children, keeping the field as the definition', () => {
    const { page } = makeVault(
      {
        'A.md': { 'part-of': { path: 'Up.md' }, origin: { path: 'Parent.md' }, example: { path: 'Down.md' }, steps: { path: 'Child.md' } },
        'Up.md': {}, 'Parent.md': {}, 'Down.md': {}, 'Child.md': {},
      },
      regions,
    );
    expect(parentsOf(page('A.md'))).toEqual({ 'Up.md': 'part-of', 'Parent.md': 'origin' });
    expect(childrenOf(page('A.md'))).toEqual({ 'Down.md': 'example', 'Child.md': 'steps' });
    // The reverse relations on the neighbours carry the same field, so the link is the same from either side.
    expect(childrenOf(page('Up.md'))).toEqual({ 'A.md': 'part-of' });
    expect(parentsOf(page('Down.md'))).toEqual({ 'A.md': 'example' });
    expect(page('A.md').neighbours.get('Up.md')).toMatchObject({
      isParent: true, parentType: RelationType.DEFINED, direction: LinkDirection.FROM,
    });
  });

  it('with empty Up / Down (an existing data.json) the Parents / Children fields behave as before', () => {
    const { page } = makeVault(
      { 'A.md': { up: { path: 'P.md' }, down: { path: 'C.md' } }, 'P.md': {}, 'C.md': {} },
      { parents: ['up'], children: ['down'] },
    );
    expect(parentsOf(page('A.md'))).toEqual({ 'P.md': 'up' });
    expect(childrenOf(page('A.md'))).toEqual({ 'C.md': 'down' });
  });

  it('a neighbour reached through an Up field and a Parents field lists both, so axisOf still finds the region', () => {
    const { page, plugin } = makeVault(
      { 'A.md': { 'part-of': { path: 'B.md' }, origin: { path: 'B.md' } }, 'B.md': {} },
      regions,
    );
    const definition = parentsOf(page('A.md'))['B.md'];
    expect(definition.split(', ').sort()).toEqual(['origin', 'part-of']);
    expect(axisOf(definition, plugin.hierarchyLowerCase)).toBe('abstract');
  });
});

describe('Page.addParent / addChild definition list', () => {
  const plugin = { settings: settingsStub } as unknown as ExcaliBrain;
  const twoPages = () => [new Page(null, 'A.md', null, plugin), new Page(null, 'B.md', null, plugin)] as const;

  it('keeps a field whose name is part of an already listed field ("up" after "group"), in either order', () => {
    const [a, b] = twoPages();
    a.addParent(b, RelationType.DEFINED, LinkDirection.FROM, 'group');
    a.addParent(b, RelationType.DEFINED, LinkDirection.FROM, 'up');
    expect(a.neighbours.get('B.md')?.parentTypeDefinition).toBe('up, group');

    const [c, d] = twoPages();
    c.addParent(d, RelationType.DEFINED, LinkDirection.FROM, 'up');
    c.addParent(d, RelationType.DEFINED, LinkDirection.FROM, 'group');
    expect(c.neighbours.get('B.md')?.parentTypeDefinition).toBe('group, up');
  });

  it('lists the same field once', () => {
    const [a, b] = twoPages();
    a.addChild(b, RelationType.DEFINED, LinkDirection.FROM, 'example');
    a.addChild(b, RelationType.DEFINED, LinkDirection.TO, 'example');
    expect(a.neighbours.get('B.md')).toMatchObject({ childTypeDefinition: 'example', direction: LinkDirection.BOTH });
  });

  it('an inferred relation adds no definition and a later defined one upgrades the type', () => {
    const [a, b] = twoPages();
    a.addParent(b, RelationType.INFERRED, LinkDirection.TO);
    expect(a.neighbours.get('B.md')).toMatchObject({ parentType: RelationType.INFERRED, parentTypeDefinition: undefined });
    a.addParent(b, RelationType.DEFINED, LinkDirection.FROM, 'part-of');
    expect(a.neighbours.get('B.md')).toMatchObject({ parentType: RelationType.DEFINED, parentTypeDefinition: 'part-of' });
  });
});
