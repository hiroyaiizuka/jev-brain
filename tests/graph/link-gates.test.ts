import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_STYLE } from 'src/constants/constants';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Link } from 'src/graph/Link';
import { Links } from 'src/graph/Links';
import type { Node } from 'src/graph/Node';
import { DEFAULT_VIEW_3D_SETTINGS } from 'src/constants/constants';
import { type Level, project, type ProjectionParams } from 'src/graph/Projection';
import { LinkDirection, RelationType, Role } from 'src/Types';
import type { ExcalidrawAutomate } from 'src/utils/ExcalidrawAutomateCompatibility';
import { createEmptyHierarchyLowerCase } from 'src/utils/hierarchy';

/**
 * Which gates `Link.render()` connects (docs/3d-design.md §1 「ゲートの向きの問題」): by role in 2D, by the
 * projected centres in 3D. The style layering is covered by link-style.test.ts; here the plugin and the
 * settings carry the base style only.
 */
const settingsStub = {
  baseLinkStyle: { ...DEFAULT_LINK_STYLE },
  inferredLinkStyle: {},
  folderLinkStyle: {},
  tagLinkStyle: {},
  upLinkStyle: {},
  downLinkStyle: {},
  inverseArrowDirection: false,
} satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings;

const plugin = {
  hierarchyLinkStylesExtended: {},
  hierarchyLowerCase: createEmptyHierarchyLowerCase(),
  settings: settingsStub,
} as unknown as ExcaliBrain;

type Center = { x: number; y: number };

/**
 * A Node as `Link` sees it: the four gate ids, the centre `Scene.render3D()` stored with `setCenter()`
 * (after projection) and the page path `Links.addLink()` keys by. y grows downward as in Excalidraw.
 */
function makeNode(prefix: string, center: Center = { x: 0, y: 0 }): Node {
  return {
    page: { path: `${prefix}.md` },
    parentGateId: `${prefix}-parent`,
    childGateId: `${prefix}-child`,
    friendGateId: `${prefix}-friend`,
    nextFriendGateId: `${prefix}-next`,
    getCenter: () => ({ ...center }),
  } as unknown as Node;
}

/** Records the start and end gate `render()` hands to `connectObjects`. */
function makeEA() {
  const gates: [start: string, end: string][] = [];
  const ea = {
    style: {},
    connectObjects(startId: string, _start: unknown, endId: string): string {
      gates.push([startId, endId]);
      return 'arrow';
    },
    addLabelToLine(): void {},
  };
  return { ea: ea as unknown as ExcalidrawAutomate, gates };
}

/** The gates of a link from `a` to `b` where `b` has `role` relative to `a`. `view3D` defaults as in `Link.render()`. */
function gatesOf(a: Node, b: Node, role: Role, view3D = false): [string, string] {
  const { ea, gates } = makeEA();
  new Link(a, b, role, RelationType.DEFINED, 'origin', ea, settingsStub, plugin).render(false, view3D);
  expect(gates).toHaveLength(1);
  return gates[0];
}

const centre = () => makeNode('c', { x: 0, y: 0 });
const above = () => makeNode('n', { x: 0, y: -200 });
const below = () => makeNode('s', { x: 0, y: 200 });
const beside = () => makeNode('e', { x: 300, y: 0 });

describe('2D: the gates follow the role, whatever the centres say', () => {
  it('Role.CHILD joins the child gate of nodeA to the parent gate of nodeB, even with nodeB above nodeA', () => {
    expect(gatesOf(centre(), above(), Role.CHILD, false)).toEqual(['c-child', 'n-parent']);
  });

  it('Role.PARENT joins the parent gate of nodeA to the child gate of nodeB, even with nodeB below nodeA', () => {
    expect(gatesOf(centre(), below(), Role.PARENT, false)).toEqual(['c-parent', 's-child']);
  });

  it('Role.LEFT joins the friend gates, Role.RIGHT the next-friend gates', () => {
    expect(gatesOf(centre(), beside(), Role.LEFT, false)).toEqual(['c-friend', 'e-friend']);
    expect(gatesOf(centre(), beside(), Role.RIGHT, false)).toEqual(['c-next', 'e-next']);
  });

  it('view3D false (what Scene passes in 2D) never reads the centre', () => {
    const noCentre = (prefix: string) => {
      const node = makeNode(prefix);
      delete (node as unknown as { getCenter?: unknown }).getCenter;
      return node;
    };
    expect(gatesOf(noCentre('c'), noCentre('s'), Role.PARENT, false)).toEqual(['c-parent', 's-child']);
    expect(gatesOf(noCentre('c'), noCentre('s'), Role.CHILD, false)).toEqual(['c-child', 's-parent']);
  });
});

describe('3D: the projected centres pick the parent/child gates', () => {
  it('a parent projected above the centre keeps the 2D gates', () => {
    expect(gatesOf(centre(), above(), Role.PARENT, true)).toEqual(['c-parent', 'n-child']);
  });

  it('a parent projected below the centre leaves the bottom of the centre and enters the top of the parent', () => {
    expect(gatesOf(centre(), below(), Role.PARENT, true)).toEqual(['c-child', 's-parent']);
  });

  it('a child projected below the centre keeps the 2D gates', () => {
    expect(gatesOf(centre(), below(), Role.CHILD, true)).toEqual(['c-child', 's-parent']);
  });

  it('a child projected above the centre leaves the top of the centre and enters the bottom of the child', () => {
    expect(gatesOf(centre(), above(), Role.CHILD, true)).toEqual(['c-parent', 'n-child']);
  });

  it('the start gate stays on nodeA when the link is stored the other way round (nodeA the parent)', () => {
    // Links.addLink() swaps nodeA/nodeB for LinkDirection.FROM; the arrow direction must survive the gate swap.
    expect(gatesOf(below(), centre(), Role.CHILD, true)).toEqual(['s-parent', 'c-child']);
  });

  it('the same y falls back to the role', () => {
    expect(gatesOf(centre(), beside(), Role.PARENT, true)).toEqual(['c-parent', 'e-child']);
    expect(gatesOf(centre(), beside(), Role.CHILD, true)).toEqual(['c-child', 'e-parent']);
  });

  it('a NaN centre (a projection fed a NaN nodeHeight) falls back to the role instead of one fixed pair', () => {
    const broken = () => makeNode('x', { x: 0, y: Number.NaN });
    expect(gatesOf(centre(), broken(), Role.PARENT, true)).toEqual(['c-parent', 'x-child']);
    expect(gatesOf(centre(), broken(), Role.CHILD, true)).toEqual(['c-child', 'x-parent']);
    expect(gatesOf(broken(), centre(), Role.CHILD, true)).toEqual(['x-child', 'c-parent']);
  });

  it('left/right links keep the friend gates whatever the centres', () => {
    expect(gatesOf(centre(), above(), Role.LEFT, true)).toEqual(['c-friend', 'n-friend']);
    expect(gatesOf(centre(), below(), Role.LEFT, true)).toEqual(['c-friend', 's-friend']);
    expect(gatesOf(centre(), above(), Role.RIGHT, true)).toEqual(['c-next', 'n-next']);
    expect(gatesOf(centre(), below(), Role.RIGHT, true)).toEqual(['c-next', 's-next']);
  });

  it('with the cabinet projection a parent north of the centre never swaps, but a parent displayed south of a friend does', () => {
    // 3D-2 defaults with a nodeHeight of 60 and the floor at -1 (a Down child on screen).
    const params: ProjectionParams = {
      northShearX: DEFAULT_VIEW_3D_SETTINGS.northShearX,
      northRise: DEFAULT_VIEW_3D_SETTINGS.northRise,
      levelHeight: DEFAULT_VIEW_3D_SETTINGS.levelHeightFactor * 60,
    };
    const at = (prefix: string, center: { x: number; y: number }, level: Level) => {
      const p = project(center, level, params);
      return makeNode(prefix, { x: p.x, y: p.y });
    };
    const c = at('c', { x: 0, y: 0 }, 0);
    expect(c.getCenter()).toEqual({ x: 0, y: 0 });

    // The origin parent (level 0) in the north band, and the same parent raised to +1: both stay above the centre.
    for (const level of [0, 1] as const) {
      const origin = at('origin', { x: 600, y: -150 }, level);
      expect(origin.getCenter().y, String(level)).toBeLessThan(0);
      expect(gatesOf(c, origin, Role.PARENT, true)).toEqual(['c-parent', 'origin-child']);
    }

    // A friend (level 0, centre band) whose parent is a Down child of the centre (level -1, south band): the parent is
    // projected below the friend, so the link leaves the bottom of the friend and enters the top of the parent.
    const friend = at('friend', { x: 300, y: 0 }, 0);
    const downChild = at('down', { x: 0, y: 200 }, -1);
    expect(downChild.getCenter().y).toBeGreaterThan(friend.getCenter().y);
    expect(gatesOf(friend, downChild, Role.PARENT, true)).toEqual(['friend-child', 'down-parent']);
  });
});

describe('Links.render() hands view3D to every link', () => {
  it('defaults to 2D and passes true through to each link, one connect per link per render', () => {
    const { ea, gates } = makeEA();
    const links = new Links(plugin);
    // Two links from the centre whose gates swap in 3D: a parent projected below it, a child projected above it.
    links.addLink(centre(), below(), Role.PARENT, RelationType.DEFINED, 'origin', LinkDirection.TO, ea, settingsStub);
    links.addLink(centre(), above(), Role.CHILD, RelationType.DEFINED, 'example', LinkDirection.TO, ea, settingsStub);

    links.render([]);
    expect(gates.splice(0)).toEqual([
      ['c-parent', 's-child'],
      ['c-child', 'n-parent'],
    ]);

    links.render([], true);
    expect(gates.splice(0)).toEqual([
      ['c-child', 's-parent'],
      ['c-parent', 'n-child'],
    ]);
  });
});
