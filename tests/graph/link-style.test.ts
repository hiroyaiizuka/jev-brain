import { describe, expect, it } from 'vitest';
import { DEFAULT_AXIS_LINK_STYLE, DEFAULT_LINK_STYLE } from 'src/constants/constants';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Link } from 'src/graph/Link';
import type { Node } from 'src/graph/Node';
import { RelationType, Role } from 'src/Types';
import type { ExcalidrawAutomate, ExcalidrawStyleLike } from 'src/utils/ExcalidrawAutomateCompatibility';
import { createEmptyHierarchyLowerCase, type HierarchyLowerCase } from 'src/utils/hierarchy';
import type { LinkStyle } from 'src/Types';

/**
 * What `Link` reads from the plugin: the per-field styles (as `setHierarchyLinkStylesExtended()`
 * builds them, keyed by the field as written and as a Dataview key), the regions of the ontology
 * (as `buildHierarchyLowerCase()` builds them, Dataview keys only) and the settings. `settings`
 * is passed twice because the constructor takes it as an argument and reads
 * `plugin.settings.folderLinkStyle` / `tagLinkStyle` from the plugin.
 */
type PluginStub = {
  hierarchyLinkStylesExtended: Record<string, LinkStyle>;
  hierarchyLowerCase: HierarchyLowerCase;
  settings: ExcaliBrainSettings;
};

/** The link styles of DEFAULT_SETTINGS (src/Settings.ts) with Up and Down told apart by colour and width. */
const UP: LinkStyle = { ...DEFAULT_AXIS_LINK_STYLE };
const DOWN: LinkStyle = { strokeColor: '#ec2223cc', strokeWidth: 3 };
const settingsStub = {
  baseLinkStyle: { ...DEFAULT_LINK_STYLE },
  inferredLinkStyle: { strokeStyle: 'dashed' },
  folderLinkStyle: { strokeColor: '#ffd700ff' },
  tagLinkStyle: { strokeColor: '#4682b4ff' },
  upLinkStyle: UP,
  downLinkStyle: DOWN,
} satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings;

function makePlugin(
  regions: Partial<Pick<HierarchyLowerCase, 'abstract' | 'concrete' | 'parents' | 'children'>> = {},
  fieldStyles: Record<string, LinkStyle> = {},
): PluginStub {
  return {
    hierarchyLinkStylesExtended: fieldStyles,
    hierarchyLowerCase: { ...createEmptyHierarchyLowerCase(), ...regions },
    settings: settingsStub,
  };
}

/** The four gate ids `Link.render()` picks from by role. */
function makeNode(prefix: string): Node {
  return {
    parentGateId: `${prefix}-parent`,
    childGateId: `${prefix}-child`,
    friendGateId: `${prefix}-friend`,
    nextFriendGateId: `${prefix}-next`,
  } as unknown as Node;
}

/** Records what `render()` hands to ExcalidrawAutomate: the style at connect time, the gates and the label. */
function makeEA() {
  const calls: { connect?: { style: ExcalidrawStyleLike; gates: unknown[] }; label?: unknown[] } = {};
  const ea = {
    style: {} as ExcalidrawStyleLike,
    connectObjects(...args: unknown[]): string {
      calls.connect = { style: { ...ea.style }, gates: args };
      return 'arrow';
    },
    addLabelToLine(...args: unknown[]): void {
      calls.label = args;
    },
  };
  return { ea: ea as unknown as ExcalidrawAutomate, calls };
}

function makeLink(
  plugin: PluginStub,
  definition: string | undefined, // undefined is what Scene passes for an inferred link (Neighbour.typeDefinition)
  relation: RelationType = RelationType.DEFINED,
  role: Role = Role.PARENT,
  ea: ExcalidrawAutomate = makeEA().ea,
): Link {
  return new Link(
    makeNode('a'),
    makeNode('b'),
    role,
    relation,
    definition,
    ea,
    plugin.settings,
    plugin as unknown as ExcaliBrain,
  );
}

describe('DEFAULT_AXIS_LINK_STYLE', () => {
  it('is the green, 4.5 wide style of docs/ontology-axis-design.md §1 and sets nothing else', () => {
    expect(DEFAULT_AXIS_LINK_STYLE).toEqual({ strokeColor: '#22ec23cc', strokeWidth: 4.5 });
  });
});

describe('Link style layering (base → inferred → region → per-field)', () => {
  it('region only: an Up field without a per-field style draws with upLinkStyle over the base style', () => {
    const link = makeLink(makePlugin({ abstract: ['part-of'] }), 'part-of');
    expect(link.style).toEqual({ ...DEFAULT_LINK_STYLE, ...UP });
    expect(link.isInferred).toBe(false);
  });

  it('region only: a Down field draws with downLinkStyle, not upLinkStyle', () => {
    const link = makeLink(makePlugin({ concrete: ['example'] }), 'example', RelationType.DEFINED, Role.CHILD);
    expect(link.style).toEqual({ ...DEFAULT_LINK_STYLE, ...DOWN });
  });

  it('per-field only: a field outside Up/Down keeps upstream behaviour (base then the field style)', () => {
    const field: LinkStyle = { strokeColor: '#ff00ffff', strokeStyle: 'dotted' };
    const link = makeLink(makePlugin({ parents: ['origin'] }, { origin: field }), 'origin');
    expect(link.style).toEqual({ ...DEFAULT_LINK_STYLE, ...field });
    expect(link.style.strokeWidth).toBe(DEFAULT_LINK_STYLE.strokeWidth);
  });

  it('both: the per-field style wins over the region for what it sets, the region fills the rest', () => {
    const field: LinkStyle = { strokeColor: '#ff00ffff' };
    const link = makeLink(makePlugin({ abstract: ['part-of'] }, { 'part-of': field }), 'part-of');
    expect(link.style).toEqual({ ...DEFAULT_LINK_STYLE, ...UP, ...field });
    expect(link.style.strokeColor).toBe('#ff00ffff');
    expect(link.style.strokeWidth).toBe(UP.strokeWidth);
  });

  it('inferred: no definition means no region, only base then inferredLinkStyle', () => {
    const link = makeLink(makePlugin({ abstract: ['part-of'] }), undefined, RelationType.INFERRED);
    expect(link.isInferred).toBe(true);
    expect(link.style).toEqual({ ...DEFAULT_LINK_STYLE, strokeStyle: 'dashed' });
  });

  it('inferred with an Up definition (not produced by Page today): dashed stays, colour and width come from the region', () => {
    const link = makeLink(makePlugin({ abstract: ['part-of'] }), 'part-of', RelationType.INFERRED);
    expect(link.style).toEqual({ ...DEFAULT_LINK_STYLE, strokeStyle: 'dashed', ...UP });
  });

  it('a ", "-joined definition (Page.addParent through two fields) takes the region of the Up/Down field in it', () => {
    const plugin = makePlugin({ abstract: ['part-of'], parents: ['origin'] });
    expect(makeLink(plugin, 'origin, part-of').style).toEqual({ ...DEFAULT_LINK_STYLE, ...UP });
    expect(makeLink(plugin, 'part-of, origin').style).toEqual({ ...DEFAULT_LINK_STYLE, ...UP });
  });

  it('Up wins over Down when a definition names both (as axisOf does)', () => {
    const plugin = makePlugin({ abstract: ['part-of'], concrete: ['example'] });
    expect(makeLink(plugin, 'example, part-of').style).toEqual({ ...DEFAULT_LINK_STYLE, ...UP });
  });

  it('a field of Parents/Children without a per-field style is unchanged: base only', () => {
    const link = makeLink(makePlugin({ parents: ['origin'] }), 'origin');
    expect(link.style).toEqual(DEFAULT_LINK_STYLE);
  });

  it('file-tree and tag-tree keep folderLinkStyle / tagLinkStyle (no region)', () => {
    const plugin = makePlugin({ abstract: ['part-of'] });
    expect(makeLink(plugin, 'file-tree').style).toEqual({ ...DEFAULT_LINK_STYLE, strokeColor: '#ffd700ff' });
    expect(makeLink(plugin, 'tag-tree').style).toEqual({ ...DEFAULT_LINK_STYLE, strokeColor: '#4682b4ff' });
  });

  it('a settings object without upLinkStyle/downLinkStyle (older data.json merged by hand) still resolves', () => {
    const plugin = makePlugin({ abstract: ['part-of'] });
    const legacy = { ...settingsStub, upLinkStyle: undefined, downLinkStyle: undefined } as unknown as ExcaliBrainSettings;
    const link = new Link(makeNode('a'), makeNode('b'), Role.PARENT, RelationType.DEFINED, 'part-of', makeEA().ea, legacy, {
      ...plugin,
      settings: legacy,
    } as unknown as ExcaliBrain);
    expect(link.style).toEqual(DEFAULT_LINK_STYLE);
  });
});

describe('Link.render() with a region style', () => {
  it('hands the region colour and width to ExcalidrawAutomate and connects the parent gates for Role.PARENT', () => {
    const { ea, calls } = makeEA();
    const link = makeLink(makePlugin({ abstract: ['part-of'] }), 'part-of', RelationType.DEFINED, Role.PARENT, ea);
    link.render(false);
    expect(calls.connect?.style).toMatchObject({
      strokeColor: UP.strokeColor,
      strokeWidth: UP.strokeWidth,
      strokeStyle: 'solid',
      opacity: 100,
    });
    expect(calls.connect?.gates.slice(0, 4)).toEqual(['a-parent', null, 'b-child', null]);
    expect(calls.label).toBeUndefined(); // showLabel is false in the base style
  });

  it('a hidden link keeps the region style at opacity 10', () => {
    const { ea, calls } = makeEA();
    const link = makeLink(makePlugin({ concrete: ['example'] }), 'example', RelationType.DEFINED, Role.CHILD, ea);
    link.render(true);
    expect(calls.connect?.style).toMatchObject({ strokeColor: DOWN.strokeColor, strokeWidth: DOWN.strokeWidth, opacity: 10 });
    expect(calls.connect?.gates.slice(0, 4)).toEqual(['a-child', null, 'b-parent', null]);
  });
});
