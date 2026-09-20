import { describe, expect, it } from 'vitest';
import { DEFAULT_HIERARCHY_DEFINITION } from 'src/constants/constants';
import type { Hierarchy } from 'src/Types';
import {
  HIERARCHY_REGIONS,
  axisOf,
  compareFieldsIgnoringCase,
  buildHierarchyLowerCase,
  createEmptyHierarchyLowerCase,
  toHierarchyKey,
} from 'src/utils/hierarchy';

type LegacyRegion = 'hidden' | 'parents' | 'children' | 'leftFriends' | 'rightFriends' | 'previous' | 'next';
type LegacyHierarchy = Omit<Hierarchy, 'abstract' | 'concrete'>;

/**
 * Verbatim port of upstream 0.2.18 `loadSettings` (src/excalibrain-main.ts
 * before this change), used as the oracle for "settings without Up/Down give
 * the same result as before". Upstream mutated `settings.hierarchy` in place,
 * so the port works on a structured clone.
 */
const upstreamLoadSettings = (input: Partial<LegacyHierarchy>) => {
  const hierarchy = structuredClone(input) as LegacyHierarchy;
  const lowerCase: Record<LegacyRegion, string[]> = {
    hidden: [], parents: [], children: [], leftFriends: [], rightFriends: [], previous: [], next: [],
  };
  const key = (s: string) => s.toLowerCase().replaceAll(' ', '-');
  const cmp = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1);

  if (!hierarchy.exclusions) hierarchy.exclusions = DEFAULT_HIERARCHY_DEFINITION.exclusions;

  if (!hierarchy.hidden) hierarchy.hidden = [''];
  hierarchy.hidden = hierarchy.hidden.sort(cmp);
  hierarchy.hidden.forEach((f) => lowerCase.hidden.push(key(f)));
  let master: string[] = [...lowerCase.hidden];

  hierarchy.parents = hierarchy.parents.sort(cmp);
  hierarchy.parents.forEach((f) => lowerCase.parents.push(key(f)));
  master = [...master, ...lowerCase.parents];

  hierarchy.children = hierarchy.children.filter((x) => !master.includes(key(x))).sort(cmp);
  hierarchy.children.forEach((f) => lowerCase.children.push(key(f)));
  master = [...master, ...lowerCase.children];

  if (!hierarchy.leftFriends) hierarchy.leftFriends = hierarchy.friends ?? DEFAULT_HIERARCHY_DEFINITION.leftFriends;
  hierarchy.leftFriends = hierarchy.leftFriends.filter((x) => !master.includes(key(x))).sort(cmp);
  hierarchy.leftFriends.forEach((f) => lowerCase.leftFriends.push(key(f)));
  master = [...master, ...lowerCase.leftFriends];

  if (!hierarchy.rightFriends) hierarchy.rightFriends = DEFAULT_HIERARCHY_DEFINITION.rightFriends;
  hierarchy.rightFriends = hierarchy.rightFriends.filter((x) => !master.includes(key(x))).sort(cmp);
  hierarchy.rightFriends.forEach((f) => lowerCase.rightFriends.push(key(f)));
  master = [...master, ...lowerCase.rightFriends];

  if (!hierarchy.previous) hierarchy.previous = DEFAULT_HIERARCHY_DEFINITION.previous;
  hierarchy.previous = hierarchy.previous.filter((x) => !master.includes(key(x))).sort(cmp);
  hierarchy.previous.forEach((f) => lowerCase.previous.push(key(f)));
  master = [...master, ...lowerCase.previous];

  if (!hierarchy.next) hierarchy.next = DEFAULT_HIERARCHY_DEFINITION.next;
  hierarchy.next = hierarchy.next.filter((x) => !master.includes(key(x))).sort(cmp);
  hierarchy.next.forEach((f) => lowerCase.next.push(key(f)));
  master = [...master, ...lowerCase.next];

  hierarchy.exclusions = hierarchy.exclusions.filter((x) => !master.includes(key(x))).sort(cmp);

  return { hierarchy, lowerCase };
};

/** A hand-edited data.json can hold anything under `hierarchy`; the loader must still start. */
const storedHierarchy = (raw: unknown) => raw as Partial<Hierarchy>;

/** A data.json written by upstream: no abstract/concrete, legacy `friends`, mixed case and spaces, cross-region duplicates. */
const legacySettings: Partial<LegacyHierarchy> = {
  hidden: ['secret', 'Internal Note'],
  parents: ['Parent', 'up', 'part of', 'Instance Of', 'Source'],
  children: ['Child', 'down', 'Part Of', 'example', 'Examples'],
  friends: ['Jump', 'similar', 'UP', 'example'],
  previous: ['Previous', 'prev', 'Instance of'],
  next: ['Next', 'after', 'Prev'],
  exclusions: ['excalidraw-plugin', 'kanban-plugin', 'Prev', 'source'],
};

/**
 * Same lists as upstream, in the same order. Two documented differences are
 * excluded here and pinned by their own tests below: the legacy `friends` key
 * is consumed instead of written back (D7), and hidden/parents duplicates.
 */
const expectSameAsUpstream = (input: Partial<LegacyHierarchy>) => {
  const upstream = upstreamLoadSettings(input);
  const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase(input);
  const { abstract, concrete, ...legacyLowerCase } = hierarchyLowerCase;
  expect(legacyLowerCase).toEqual(upstream.lowerCase);
  expect(abstract).toEqual([]);
  expect(concrete).toEqual([]);
  const upstreamHierarchy: Partial<LegacyHierarchy> = { ...upstream.hierarchy };
  delete upstreamHierarchy.friends;
  expect(hierarchy).toEqual({ ...upstreamHierarchy, abstract: [], concrete: [] });
};

describe('buildHierarchyLowerCase without Up/Down (regression against upstream loadSettings)', () => {
  it('normalises the default definition exactly as upstream did', () => {
    expectSameAsUpstream(DEFAULT_HIERARCHY_DEFINITION);
  });

  it('normalises a legacy data.json (friends, mixed case, spaces, duplicates) exactly as upstream did', () => {
    expectSameAsUpstream(legacySettings);
  });

  it('fills missing regions exactly as upstream did (hidden placeholder, friends migration, defaults)', () => {
    expectSameAsUpstream({ parents: ['Parent'], children: ['Child'] });
    expectSameAsUpstream({ parents: ['Parent'], children: [], friends: ['Jump'] });
    expectSameAsUpstream({ hidden: [], parents: [], children: [], leftFriends: [], rightFriends: [], previous: [], next: [], exclusions: [] });
  });

  it('replaces falsy lists with the default exactly as upstream did', () => {
    expectSameAsUpstream(storedHierarchy({ hidden: '', parents: ['Parent'], children: [], exclusions: '' }));
    expectSameAsUpstream(storedHierarchy({ hidden: false, parents: [], children: [], leftFriends: 0, next: null }));
  });

  it('keeps upstream defaults for parents and children when they are missing or not a list, instead of crashing', () => {
    const expected = {
      parents: ['inception', 'North', 'origin', 'Parent', 'parent domain', 'Parents', 'source', 'u', 'up'],
      children: ['Child', 'Children', 'contributes to', 'd', 'down', 'leads to', 'nurtures', 'South'],
    };
    const missing = buildHierarchyLowerCase({}).hierarchy;
    expect(missing.parents).toEqual(expected.parents);
    expect(missing.children).toEqual(expected.children);
    expect(missing.hidden).toEqual(['']);
    expect(missing.abstract).toEqual([]);
    expect(missing.concrete).toEqual([]);

    const malformed = buildHierarchyLowerCase(storedHierarchy({ parents: 'Parent', children: { 0: 'Child' } })).hierarchy;
    expect(malformed.parents).toEqual(expected.parents);
    expect(malformed.children).toEqual(expected.children);
  });

  it('drops a field from Parents when it is also hidden, unlike upstream (docs/architecture.md D7)', () => {
    const input = { hidden: ['secret'], parents: ['secret', 'Parent'], children: ['Child'] };
    expect(upstreamLoadSettings(input).lowerCase.parents).toEqual(['parent', 'secret']);
    const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase(input);
    expect(hierarchyLowerCase.hidden).toEqual(['secret']);
    expect(hierarchyLowerCase.parents).toEqual(['parent']);
    expect(hierarchy.parents).toEqual(['Parent']);
  });

  it('consumes the legacy friends list instead of writing it back (docs/architecture.md D7)', () => {
    const { hierarchy } = buildHierarchyLowerCase({ parents: [], children: [], friends: ['Jump', 'similar'] });
    expect(hierarchy.leftFriends).toEqual(['Jump', 'similar']);
    expect(hierarchy).not.toHaveProperty('friends');
    expect(Object.keys(hierarchy).sort()).toEqual([...HIERARCHY_REGIONS, 'exclusions'].sort());
  });

  it('spells out the legacy result so a change in either implementation is visible', () => {
    const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase(legacySettings);
    expect(hierarchyLowerCase).toEqual({
      hidden: ['internal-note', 'secret'],
      abstract: [],
      concrete: [],
      parents: ['instance-of', 'parent', 'part-of', 'source', 'up'],
      children: ['child', 'down', 'example', 'examples'],
      leftFriends: ['jump', 'similar'],
      rightFriends: ['cons', 'disadvantages', 'missing', 'opposes'],
      previous: ['prev', 'previous'],
      next: ['after', 'next'],
    });
    expect(hierarchy.parents).toEqual(['Instance Of', 'Parent', 'part of', 'Source', 'up']);
    expect(hierarchy.children).toEqual(['Child', 'down', 'example', 'Examples']);
    expect(hierarchy.leftFriends).toEqual(['Jump', 'similar']);
    expect(hierarchy).not.toHaveProperty('friends');
    expect(hierarchy.exclusions).toEqual(['excalidraw-plugin', 'kanban-plugin']);
  });
});

describe('buildHierarchyLowerCase with Up/Down', () => {
  it('lets Up win over Parents: the field is kept in abstract and removed from parents', () => {
    const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase({
      parents: ['Parent', 'up', 'part of'],
      children: ['Child'],
      abstract: ['up', 'Part Of'],
    });
    expect(hierarchyLowerCase.abstract).toEqual(['part-of', 'up']);
    expect(hierarchyLowerCase.parents).toEqual(['parent']);
    expect(hierarchy.abstract).toEqual(['Part Of', 'up']);
    expect(hierarchy.parents).toEqual(['Parent']);
  });

  it('lets Down win over Children, and Up win over Down', () => {
    const { hierarchyLowerCase } = buildHierarchyLowerCase({
      parents: ['Parent'],
      children: ['Child', 'example', 'down'],
      abstract: ['up', 'example'],
      concrete: ['example', 'Down'],
    });
    expect(hierarchyLowerCase.abstract).toEqual(['example', 'up']);
    expect(hierarchyLowerCase.concrete).toEqual(['down']);
    expect(hierarchyLowerCase.children).toEqual(['child']);
  });

  it('removes Up/Down fields from friends, previous, next and exclusions as well', () => {
    const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase({
      parents: [], children: [],
      leftFriends: ['similar', 'up'], rightFriends: ['opposes', 'down'],
      previous: ['prev', 'up'], next: ['next', 'down'],
      exclusions: ['kanban-plugin', 'up'],
      abstract: ['up'], concrete: ['down'],
    });
    expect(hierarchyLowerCase.leftFriends).toEqual(['similar']);
    expect(hierarchyLowerCase.rightFriends).toEqual(['opposes']);
    expect(hierarchyLowerCase.previous).toEqual(['prev']);
    expect(hierarchyLowerCase.next).toEqual(['next']);
    expect(hierarchy.exclusions).toEqual(['kanban-plugin']);
  });

  it('compares fields as Dataview keys: case and spaces do not create a second entry', () => {
    const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase({
      parents: ['Instance  Of', 'INSTANCE OF', 'instance-of', 'Parent'],
      children: [],
      abstract: ['Instance Of'],
    });
    expect(hierarchyLowerCase.abstract).toEqual(['instance-of']);
    // "Instance  Of" (two spaces) is a different key and survives; the other two spellings are dropped.
    expect(hierarchyLowerCase.parents).toEqual(['instance--of', 'parent']);
    expect(hierarchy.parents).toEqual(['Instance  Of', 'Parent']);
  });

  it('keeps hidden ahead of every other region, including Up (docs/architecture.md D7)', () => {
    const { hierarchyLowerCase } = buildHierarchyLowerCase({
      hidden: ['secret'],
      abstract: ['secret', 'up'],
      parents: ['secret', 'Parent'],
      children: [],
    });
    expect(hierarchyLowerCase.hidden).toEqual(['secret']);
    expect(hierarchyLowerCase.abstract).toEqual(['up']);
    expect(hierarchyLowerCase.parents).toEqual(['parent']);
  });

  it('sorts every region case-insensitively and keeps the original spelling in the settings', () => {
    const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase({
      parents: [], children: [],
      abstract: ['subtopic of', 'Instance Of', 'member of', 'up'],
      concrete: ['Illustrates', 'example', 'Next Level Detail'],
    });
    expect(hierarchy.abstract).toEqual(['Instance Of', 'member of', 'subtopic of', 'up']);
    expect(hierarchyLowerCase.abstract).toEqual(['instance-of', 'member-of', 'subtopic-of', 'up']);
    expect(hierarchy.concrete).toEqual(['example', 'Illustrates', 'Next Level Detail']);
    expect(hierarchyLowerCase.concrete).toEqual(['example', 'illustrates', 'next-level-detail']);
  });

  it('is pure: the input is not mutated and no array of the result is shared with the input or the defaults', () => {
    const input: Partial<Hierarchy> = { parents: ['up', 'Parent'], children: ['Child'], abstract: ['up'], friends: ['Jump'] };
    const { hierarchy } = buildHierarchyLowerCase(input);
    expect(input).toEqual({ parents: ['up', 'Parent'], children: ['Child'], abstract: ['up'], friends: ['Jump'] });
    const inputArrays = [...Object.values(input), ...Object.values(DEFAULT_HIERARCHY_DEFINITION)];
    for (const list of Object.values(hierarchy)) {
      expect(inputArrays).not.toContain(list);
    }
  });

  it('accepts a missing hierarchy and yields the defaults', () => {
    expect(buildHierarchyLowerCase(undefined)).toEqual(buildHierarchyLowerCase({}));
    expect(buildHierarchyLowerCase(null)).toEqual(buildHierarchyLowerCase({}));
  });

  it('has a lower-case entry for every region', () => {
    const { hierarchyLowerCase } = buildHierarchyLowerCase(DEFAULT_HIERARCHY_DEFINITION);
    expect(Object.keys(hierarchyLowerCase)).toEqual([...HIERARCHY_REGIONS]);
    expect(createEmptyHierarchyLowerCase()).toEqual(Object.fromEntries(HIERARCHY_REGIONS.map((r) => [r, [] as string[]])));
  });
});

describe('compareFieldsIgnoringCase', () => {
  it('orders case-insensitively and never returns 0, like the upstream comparator', () => {
    expect(['b', 'C', 'a'].sort(compareFieldsIgnoringCase)).toEqual(['a', 'b', 'C']);
    expect(compareFieldsIgnoringCase('same', 'SAME')).toBe(1);
    expect(compareFieldsIgnoringCase('SAME', 'same')).toBe(1);
  });
});

describe('toHierarchyKey', () => {
  it('lower-cases and replaces every space with a hyphen', () => {
    expect(toHierarchyKey('Part Of')).toBe('part-of');
    expect(toHierarchyKey('next level detail')).toBe('next-level-detail');
    expect(toHierarchyKey('already-a-key')).toBe('already-a-key');
  });
});

describe('axisOf', () => {
  const { hierarchyLowerCase } = buildHierarchyLowerCase({
    parents: ['Parent', 'origin'],
    children: ['Child'],
    abstract: ['up', 'Part Of'],
    concrete: ['down', 'example'],
  });

  it('returns abstract for Up fields and concrete for Down fields', () => {
    expect(axisOf('up', hierarchyLowerCase)).toBe('abstract');
    expect(axisOf('part-of', hierarchyLowerCase)).toBe('abstract');
    expect(axisOf('down', hierarchyLowerCase)).toBe('concrete');
    expect(axisOf('example', hierarchyLowerCase)).toBe('concrete');
  });

  it('returns null for parents, children, unknown fields and the missing definition of inferred links', () => {
    expect(axisOf('parent', hierarchyLowerCase)).toBeNull();
    expect(axisOf('origin', hierarchyLowerCase)).toBeNull();
    expect(axisOf('child', hierarchyLowerCase)).toBeNull();
    expect(axisOf('file-tree', hierarchyLowerCase)).toBeNull();
    expect(axisOf('', hierarchyLowerCase)).toBeNull();
    expect(axisOf(undefined, hierarchyLowerCase)).toBeNull();
    expect(axisOf(null, hierarchyLowerCase)).toBeNull();
  });

  it('reads the comma-joined definition Page builds when a neighbour is reached through several fields', () => {
    expect(axisOf('Parent, up', hierarchyLowerCase)).toBe('abstract');
    expect(axisOf('example, Child', hierarchyLowerCase)).toBe('concrete');
    expect(axisOf('Parent, origin', hierarchyLowerCase)).toBeNull();
    expect(axisOf('example, up', hierarchyLowerCase)).toBe('abstract');
  });

  it('ignores an empty entry even when a region stores the empty placeholder', () => {
    const withPlaceholder = buildHierarchyLowerCase({ hidden: ['secret'], parents: [], children: [], abstract: [''] }).hierarchyLowerCase;
    expect(withPlaceholder.abstract).toEqual(['']);
    expect(axisOf('', withPlaceholder)).toBeNull();
    expect(axisOf(', ', withPlaceholder)).toBeNull();
  });

  it('accepts the field as written in the note as well as its Dataview key', () => {
    expect(axisOf('Part Of', hierarchyLowerCase)).toBe('abstract');
    expect(axisOf('UP', hierarchyLowerCase)).toBe('abstract');
    expect(axisOf('Example', hierarchyLowerCase)).toBe('concrete');
  });

  it('returns null when Up/Down are empty (settings without the regions)', () => {
    const legacy = buildHierarchyLowerCase(DEFAULT_HIERARCHY_DEFINITION).hierarchyLowerCase;
    expect(axisOf('up', legacy)).toBeNull();
    expect(axisOf('down', legacy)).toBeNull();
  });
});
