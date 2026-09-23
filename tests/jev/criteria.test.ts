import { describe, expect, it } from 'vitest';
import type { Pages } from 'src/graph/Pages';
import type { Hierarchy, Relation } from 'src/Types';
import {
  DIRECTION_NOTES,
  countFieldUsage,
  criteriaOptions,
  fieldUsage,
  pluginCriteria,
  type PageIndex,
} from 'src/jev/criteria';
import { DEFAULT_JEV_SETTINGS } from 'src/constants/constants';
import { DIRECTION_QUESTION, FIELD_QUESTION, buildQuestions } from 'src/jev/judge';

const hierarchy: Hierarchy = {
  hidden: ['secret'],
  abstract: ['Up'],
  concrete: ['down'],
  parents: ['origin'],
  children: [],
  leftFriends: ['jump'],
  rightFriends: ['similar'],
  previous: [],
  next: ['next'],
  exclusions: [],
};

const settingsOrder = ['Up', 'down', 'origin', 'jump', 'similar', 'next'];

type Link = { from: string; to: string; field?: string; kind?: 'parent' | 'child' | 'leftFriend' | 'rightFriend' | 'next' | 'hidden' };

const MIRROR = { parent: 'child', child: 'parent', leftFriend: 'leftFriend', rightFriend: 'rightFriend', next: 'previousFriend' } as const;
const KEY = { parent: 'parent', child: 'child', leftFriend: 'leftFriend', rightFriend: 'rightFriend', next: 'nextFriend' } as const;

type FakePage = { neighbours: Map<string, Partial<Relation>>; addDVFieldLinksToPage: () => void };

/**
 * An index shaped the way `Page` builds it: every link sits on both of its pages, a field's name in
 * the matching `…TypeDefinition` of each, and a second field on the same pair is joined with ", ".
 * A hidden link and an inferred one carry no definition. With `lazy`, a page's own links reach the
 * index only once `addDVFieldLinksToPage` is called on it, as a real `Page` reads Dataview when drawn.
 */
const indexOf = (links: Link[], { lazy = false } = {}): PageIndex & { pages: Map<string, FakePage> } => {
  const pages = new Map<string, FakePage>();
  const relation = (from: string, to: string): Partial<Relation> => {
    const page = pageAt(from);
    const existing = page.neighbours.get(to) ?? {};
    page.neighbours.set(to, existing);
    return existing;
  };
  const define = (target: Partial<Relation>, kind: string, field: string) => {
    const fields = target as Record<string, string | undefined>;
    const key = `${kind}TypeDefinition`;
    const current = fields[key];
    fields[key] = current ? `${field}, ${current}` : field;
  };
  const apply = ({ from, to, field, kind = 'parent' }: Link) => {
    const forward = relation(from, to);
    const backward = relation(to, from);
    if (kind === 'hidden' || field === undefined) {
      forward.isHidden = kind === 'hidden';
      backward.isHidden = kind === 'hidden';
      return;
    }
    define(forward, KEY[kind], field);
    define(backward, MIRROR[kind], field);
  };
  function pageAt(path: string): FakePage {
    let page = pages.get(path);
    if (!page) {
      let loaded = !lazy;
      page = {
        neighbours: new Map<string, Partial<Relation>>(),
        addDVFieldLinksToPage: () => {
          if (loaded) return;
          loaded = true;
          links.filter((link) => link.from === path).forEach(apply);
        },
      };
      pages.set(path, page);
    }
    return page;
  }
  for (const link of links) {
    pageAt(link.from);
    pageAt(link.to);
    if (!lazy) apply(link);
  }
  return {
    pages,
    forEach: (callback) => { pages.forEach((page, path) => { callback(page as never, path); }); },
  };
};

describe('countFieldUsage (how often the vault uses a field, LEV-191)', () => {
  it('counts a link once, although both of its pages carry it', () => {
    const usage = countFieldUsage(indexOf([
      { from: 'A.md', to: 'B.md', field: 'up' },
      { from: 'C.md', to: 'B.md', field: 'up' },
      { from: 'A.md', to: 'C.md', field: 'jump', kind: 'leftFriend' },
      { from: 'A.md', to: 'D.md', field: 'next', kind: 'next' },
    ]));

    expect(Object.fromEntries(usage)).toEqual({ up: 2, jump: 1, next: 1 });
  });

  it('treats case and spaces as the same field, as Dataview keys do', () => {
    const usage = countFieldUsage(indexOf([
      { from: 'A.md', to: 'B.md', field: 'part of' },
      { from: 'A.md', to: 'C.md', field: 'Part-Of' },
      { from: 'D.md', to: 'C.md', field: ' PART OF ' },
    ]));

    expect(Object.fromEntries(usage)).toEqual({ 'part-of': 3 });
  });

  it('counts each field of a pair joined with ", ", and a field written from both sides once', () => {
    const usage = countFieldUsage(indexOf([
      { from: 'A.md', to: 'B.md', field: 'up' },
      { from: 'A.md', to: 'B.md', field: 'origin' },
      // B writes `down:: [[A]]` back: another field on the same pair.
      { from: 'B.md', to: 'A.md', field: 'down', kind: 'child' },
    ]));

    expect(Object.fromEntries(usage)).toEqual({ up: 1, origin: 1, down: 1 });
  });

  it('leaves out hidden and inferred links, which carry no field', () => {
    const usage = countFieldUsage(indexOf([
      { from: 'A.md', to: 'B.md', kind: 'hidden' },
      { from: 'A.md', to: 'C.md' },
      { from: 'A.md', to: 'D.md', field: 'up' },
    ]));

    expect(Object.fromEntries(usage)).toEqual({ up: 1 });
  });
});

describe('fieldUsage (counted once per index generation)', () => {
  it('counts a new index afresh and keeps the count of the one it already read', () => {
    const first = indexOf([{ from: 'A.md', to: 'B.md', field: 'up' }]);
    const plugin = { pages: first as unknown as Pages };
    const usage = fieldUsage(plugin);

    expect(Object.fromEntries(usage)).toEqual({ up: 1 });
    // The same Pages again: the cached count, even though the map under it changed.
    first.pages.clear();
    expect(fieldUsage(plugin)).toBe(usage);
    // A rebuild is a new Pages (createIndex), so it is counted again.
    plugin.pages = indexOf([{ from: 'A.md', to: 'B.md', field: 'down', kind: 'child' }]) as unknown as Pages;
    expect(Object.fromEntries(fieldUsage(plugin))).toEqual({ down: 1 });
  });

  it('reads the fields of every page first, not only of the pages the brain has drawn', () => {
    const index = indexOf([
      { from: 'A.md', to: 'B.md', field: 'up' },
      { from: 'C.md', to: 'B.md', field: 'up' },
      { from: 'D.md', to: 'E.md', field: 'down', kind: 'child' },
    ], { lazy: true });
    // Before loading, the index knows none of the typed links (right after createIndex).
    expect(countFieldUsage(index).size).toBe(0);

    expect(Object.fromEntries(fieldUsage({ pages: index as unknown as Pages }))).toEqual({ up: 2, down: 1 });
  });

  it('is empty before the index exists', () => {
    expect(fieldUsage({}).size).toBe(0);
  });
});

describe('criteriaOptions (the default criteria of design §2-4)', () => {
  const usage = new Map([['up', 7], ['origin', 5], ['jump', 4], ['similar', 1]]);

  it('keeps the fields used at least candidateMinUses times (5 by default)', () => {
    expect(DEFAULT_JEV_SETTINGS.candidateMinUses).toBe(5);
    const options = criteriaOptions({ candidateMinUses: 5 }, usage);

    expect(options.fields).toEqual(['up', 'origin']);
    // The ontology's spelling and order survive the narrowing.
    expect(Object.keys(buildQuestions(hierarchy, options)[FIELD_QUESTION].criteria)).toEqual(['Up', 'origin']);
  });

  it('offers every field when candidateMinUses is 0', () => {
    const options = criteriaOptions({ candidateMinUses: 0 }, usage);

    expect(options.fields).toBeUndefined();
    expect(Object.keys(buildQuestions(hierarchy, options)[FIELD_QUESTION].criteria)).toEqual(settingsOrder);
  });

  it('offers every field when no field is used often enough (buildQuestions falls back)', () => {
    const options = criteriaOptions({ candidateMinUses: 50 }, usage);

    expect(options.fields).toEqual([]);
    expect(Object.keys(buildQuestions(hierarchy, options)[FIELD_QUESTION].criteria)).toEqual(settingsOrder);
    expect(Object.keys(buildQuestions(hierarchy, criteriaOptions({ candidateMinUses: 5 }, new Map()))[FIELD_QUESTION].criteria))
      .toEqual(settingsOrder);
  });

  it('puts one sentence on each of the six directions of Q2', () => {
    const { criteria } = buildQuestions(hierarchy, criteriaOptions({ candidateMinUses: 5 }, usage))[DIRECTION_QUESTION];

    expect(criteria).toEqual({
      parent: `親。${DIRECTION_NOTES.parent}`,
      child: `子。${DIRECTION_NOTES.child}`,
      leftFriend: `左友。${DIRECTION_NOTES.leftFriend}`,
      rightFriend: `右友。${DIRECTION_NOTES.rightFriend}`,
      previous: `前。${DIRECTION_NOTES.previous}`,
      next: `次。${DIRECTION_NOTES.next}`,
    });
    expect(Object.values(DIRECTION_NOTES).every((note) => note.length > 0)).toBe(true);
  });

  it('is what the plugin sends, read from its settings and its index', () => {
    const index = indexOf([
      { from: 'A.md', to: 'B.md', field: 'origin' },
      { from: 'A.md', to: 'C.md', field: 'origin' },
      { from: 'A.md', to: 'D.md', field: 'up' },
    ]);
    const plugin = {
      settings: { jev: { ...DEFAULT_JEV_SETTINGS, candidateMinUses: 2 } },
      pages: index as unknown as Pages,
    };

    expect(pluginCriteria(plugin)).toEqual({ fields: ['origin'], directionNotes: DIRECTION_NOTES });
  });
});
