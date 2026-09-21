import { describe, expect, it } from 'vitest';
import { DEFAULT_AXIS_LINK_STYLE, DEFAULT_LINK_STYLE } from 'src/constants/constants';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Link } from 'src/graph/Link';
import { Links } from 'src/graph/Links';
import type { Node } from 'src/graph/Node';
import { LinkDirection, RelationType, Role } from 'src/Types';
import type { ExcalidrawAutomate, ExcalidrawStyleLike } from 'src/utils/ExcalidrawAutomateCompatibility';
import { createEmptyHierarchyLowerCase } from 'src/utils/hierarchy';

/**
 * What `Link.render()` connects and how (docs/3d-design.md §6-3): in 2D the gates, by role, as upstream does;
 * in 3D the boxes themselves, thin and faint. The style layering is covered by link-style.test.ts; here the
 * plugin carries an Up region so a test can check that the region colour survives the 3D thinning.
 */
const settingsStub = {
  baseLinkStyle: { ...DEFAULT_LINK_STYLE },
  inferredLinkStyle: {},
  folderLinkStyle: {},
  tagLinkStyle: {},
  upLinkStyle: { ...DEFAULT_AXIS_LINK_STYLE },
  downLinkStyle: {},
  inverseArrowDirection: false,
} satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings;

const plugin = {
  hierarchyLinkStylesExtended: {},
  hierarchyLowerCase: { ...createEmptyHierarchyLowerCase(), abstract: ['up'] },
  settings: settingsStub,
} as unknown as ExcaliBrain;

/**
 * A Node as `Link` sees it in 2D: the four gate ids and the page path `Links.addLink()` keys by. It has no `id`,
 * so a 2D render that reached for the box would hand `undefined` to `connectObjects`.
 */
function gatedNode(prefix: string): Node {
  return {
    page: { path: `${prefix}.md` },
    parentGateId: `${prefix}-parent`,
    childGateId: `${prefix}-child`,
    friendGateId: `${prefix}-friend`,
    nextFriendGateId: `${prefix}-next`,
  } as unknown as Node;
}

/**
 * A Node as `Link` sees it in 3D: the box `id` (`Node.render()` leaves the gate ids unset in 3D, so a render
 * that reached for a gate would hand `undefined` to `connectObjects`) and the page path.
 */
function boxNode(prefix: string): Node {
  return {
    page: { path: `${prefix}.md` },
    id: `${prefix}-box`,
  } as unknown as Node;
}

/** Records every `connectObjects` call: the start and end element and the style at that moment. */
function makeEA() {
  const connects: { start: string; end: string; style: ExcalidrawStyleLike }[] = [];
  const ea = {
    style: {} as ExcalidrawStyleLike,
    connectObjects(startId: string, _start: unknown, endId: string): string {
      connects.push({ start: startId, end: endId, style: { ...ea.style } });
      return 'arrow';
    },
    addLabelToLine(): void {},
  };
  return { ea: ea as unknown as ExcalidrawAutomate, connects };
}

/** One rendered link from `a` to `b` where `b` has `role` relative to `a`. `view3D` defaults as in `Link.render()`. */
function renderOne(a: Node, b: Node, role: Role, options: { view3D?: boolean; hide?: boolean; field?: string } = {}) {
  const { ea, connects } = makeEA();
  new Link(a, b, role, RelationType.DEFINED, options.field ?? 'origin', ea, settingsStub, plugin).render(
    options.hide ?? false,
    options.view3D,
  );
  expect(connects).toHaveLength(1);
  return connects[0];
}

const endsOf = (...args: Parameters<typeof renderOne>): [string, string] => {
  const { start, end } = renderOne(...args);
  return [start, end];
};

describe('2D: the gates follow the role, as upstream', () => {
  it('Role.CHILD joins the child gate of nodeA to the parent gate of nodeB', () => {
    expect(endsOf(gatedNode('c'), gatedNode('s'), Role.CHILD)).toEqual(['c-child', 's-parent']);
  });

  it('Role.PARENT joins the parent gate of nodeA to the child gate of nodeB', () => {
    expect(endsOf(gatedNode('c'), gatedNode('n'), Role.PARENT)).toEqual(['c-parent', 'n-child']);
  });

  it('Role.LEFT joins the friend gates, Role.RIGHT the next-friend gates', () => {
    expect(endsOf(gatedNode('c'), gatedNode('e'), Role.LEFT)).toEqual(['c-friend', 'e-friend']);
    expect(endsOf(gatedNode('c'), gatedNode('e'), Role.RIGHT)).toEqual(['c-next', 'e-next']);
  });

  it('view3D false (what Scene passes in 2D) draws the style width at full opacity, 10 when hidden', () => {
    expect(renderOne(gatedNode('c'), gatedNode('n'), Role.PARENT, { view3D: false, field: 'up' }).style).toMatchObject({
      strokeColor: DEFAULT_AXIS_LINK_STYLE.strokeColor,
      strokeWidth: DEFAULT_AXIS_LINK_STYLE.strokeWidth,
      opacity: 100,
    });
    expect(renderOne(gatedNode('c'), gatedNode('n'), Role.PARENT, { view3D: false, hide: true }).style).toMatchObject({
      strokeWidth: DEFAULT_LINK_STYLE.strokeWidth,
      opacity: 10,
    });
  });
});

describe('3D: the links join the boxes, thin and faint', () => {
  it.each([Role.PARENT, Role.CHILD, Role.LEFT, Role.RIGHT])('%s connects the box of nodeA to the box of nodeB, never a gate', (role) => {
    expect(endsOf(boxNode('c'), boxNode('x'), role, { view3D: true })).toEqual(['c-box', 'x-box']);
  });

  it('the start stays on nodeA when the link is stored the other way round (the arrow keeps its direction)', () => {
    expect(endsOf(boxNode('s'), boxNode('c'), Role.CHILD, { view3D: true })).toEqual(['s-box', 'c-box']);
  });

  it('draws width 1 at opacity 50 and keeps the region colour (§6-3: thinner than the Up style, same green)', () => {
    const { style } = renderOne(boxNode('c'), boxNode('n'), Role.PARENT, { view3D: true, field: 'up' });
    expect(style).toMatchObject({ strokeColor: DEFAULT_AXIS_LINK_STYLE.strokeColor, strokeWidth: 1, opacity: 50 });
    expect(DEFAULT_AXIS_LINK_STYLE.strokeWidth).toBeGreaterThan(1);
  });

  it('a hidden link stays at opacity 10 in 3D too', () => {
    expect(renderOne(boxNode('c'), boxNode('n'), Role.PARENT, { view3D: true, hide: true }).style).toMatchObject({
      strokeWidth: 1,
      opacity: 10,
    });
  });

  it('does not read the projected centres: a node without getCenter() renders', () => {
    const c = boxNode('c');
    const n = boxNode('n');
    expect('getCenter' in c || 'getCenter' in n).toBe(false);
    expect(endsOf(c, n, Role.PARENT, { view3D: true })).toEqual(['c-box', 'n-box']);
  });
});

describe('Links.render() hands view3D to every link', () => {
  it('defaults to 2D (gates) and passes true through to each link (boxes), one connect per link per render', () => {
    const { ea, connects } = makeEA();
    const links = new Links(plugin);
    // Nodes that carry both the gates and the box, so the same two links can be rendered both ways.
    const both = (prefix: string): Node => ({ ...gatedNode(prefix), ...boxNode(prefix) }) as Node;
    links.addLink(both('c'), both('n'), Role.PARENT, RelationType.DEFINED, 'origin', LinkDirection.TO, ea, settingsStub);
    links.addLink(both('c'), both('s'), Role.CHILD, RelationType.DEFINED, 'example', LinkDirection.TO, ea, settingsStub);

    links.render([]);
    expect(connects.splice(0).map(({ start, end }) => [start, end])).toEqual([
      ['c-parent', 'n-child'],
      ['c-child', 's-parent'],
    ]);

    links.render([], true);
    expect(connects.splice(0).map(({ start, end }) => [start, end])).toEqual([
      ['c-box', 'n-box'],
      ['c-box', 's-box'],
    ]);
  });
});
