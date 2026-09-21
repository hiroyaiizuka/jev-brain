import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVEL_COLORS, DEFAULT_NODE_STYLE } from 'src/constants/constants';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Node, readableTextColor } from 'src/graph/Node';
import type { Page } from 'src/graph/Page';
import type { Level } from 'src/graph/Projection';
import type { ExcalidrawAutomate, ExcalidrawElement, ExcalidrawStyleLike } from 'src/utils/ExcalidrawAutomateCompatibility';

/**
 * What `Node.render()` draws (docs/3d-design.md §6-3): in 2D the upstream text box, four gates, neighbour counts
 * and group; in 3D the text box in the colour of its level, an "L{n}" label at its top right corner, no gates,
 * no counts. The elements go through an ExcalidrawAutomate stub that logs every call with the style at that
 * moment and keeps the elements it made, so a test can read the box back as Scene does.
 */
const settingsStub = {
  baseNodeStyle: { ...DEFAULT_NODE_STYLE },
  centralNodeStyle: { fontSize: 30, backgroundColor: '#B5B5B5', textColor: '#000000ff' },
  inferredNodeStyle: {},
  urlNodeStyle: {},
  virtualNodeStyle: {},
  siblingNodeStyle: {},
  attachmentNodeStyle: {},
  tagNodeStyles: {},
  tagStyleList: [],
  displayAllStylePrefixes: false,
  centerEmbedWidth: 800,
  centerEmbedHeight: 600,
  showNeighborCount: true,
  levelColors: [...DEFAULT_LEVEL_COLORS],
} satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings;

type Counts = Partial<Record<'parent' | 'children' | 'leftFriend' | 'rightFriend' | 'previousFriend' | 'nextFriend', number>>;

/** The slice of `Page` the constructor and `render()` read: kind flags, style tags, title and the neighbour counts. */
function makePage(title: string, counts: Counts = {}, settings: ExcaliBrainSettings = settingsStub): Page {
  return {
    plugin: { settings },
    path: `${title}.md`,
    file: { path: `${title}.md` },
    isFolder: false,
    isTag: false,
    isURL: false,
    isVirtual: false,
    isAttachment: false,
    primaryStyleTag: undefined,
    styleTags: [],
    maxLabelLength: 30,
    getTitle: () => title,
    parentCount: () => counts.parent ?? 0,
    childrenCount: () => counts.children ?? 0,
    leftFriendCount: () => counts.leftFriend ?? 0,
    rightFriendCount: () => counts.rightFriend ?? 0,
    previousFriendCount: () => counts.previousFriend ?? 0,
    nextFriendCount: () => counts.nextFriend ?? 0,
  } as unknown as Page;
}

type Call = { fn: string; args: unknown[]; style: ExcalidrawStyleLike; id?: string };

/**
 * ExcalidrawAutomate as `Node.render()` uses it. `measureText` is linear in the text length and the current font
 * size, `addText` with `box: true` makes a container padded by `boxPadding` (and returns its id, as EA does),
 * ellipses and plain texts are elements of their own. Every element keeps the style it was made with.
 */
function makeEA(preset: Record<string, ExcalidrawElement> = {}) {
  const calls: Call[] = [];
  const elements: Record<string, ExcalidrawElement> = { ...preset };
  const groups: string[][] = [];
  let next = 0;
  const id = (kind: string) => `${kind}-${++next}`;
  const measure = (text: string) => ({ width: text.length * (ea.style.fontSize ?? 0) * 0.5, height: (ea.style.fontSize ?? 0) * 1.25 });
  const ea = {
    style: {} as ExcalidrawStyleLike,
    measureText(text: string) {
      calls.push({ fn: 'measureText', args: [text], style: { ...ea.style } });
      return measure(text);
    },
    addText(x: number, y: number, text: string, options?: { box?: boolean; boxPadding?: number }): string {
      const size = measure(text);
      const textId = id('text');
      elements[textId] = { id: textId, type: 'text', x, y, ...size, strokeColor: ea.style.strokeColor, fontSize: ea.style.fontSize, text };
      let result = textId;
      if (options?.box) {
        const padding = options.boxPadding ?? 0;
        result = id('box');
        elements[result] = {
          id: result,
          type: 'rectangle',
          x: x - padding,
          y: y - padding,
          width: size.width + 2 * padding,
          height: size.height + 2 * padding,
          backgroundColor: ea.style.backgroundColor,
          boundElements: [{ id: textId, type: 'text' }],
        };
      }
      calls.push({ fn: 'addText', args: [x, y, text], style: { ...ea.style }, id: result });
      return result;
    },
    addEllipse(x: number, y: number, width: number, height: number): string {
      const result = id('ellipse');
      elements[result] = { id: result, type: 'ellipse', x, y, width, height, backgroundColor: ea.style.backgroundColor };
      calls.push({ fn: 'addEllipse', args: [x, y, width, height], style: { ...ea.style }, id: result });
      return result;
    },
    addToGroup(ids: string[]): void {
      calls.push({ fn: 'addToGroup', args: [ids], style: { ...ea.style } });
      groups.push(ids);
    },
    getElement(elementId: string): ExcalidrawElement {
      return elements[elementId];
    },
  };
  return { ea: ea as unknown as ExcalidrawAutomate, calls, elements, groups };
}

type NodeOptions = { counts?: Counts; isCentral?: boolean; view3D?: { level: Level; floor: Level }; settings?: ExcaliBrainSettings };

/** A text node at (100, 50), rendered. In 3D `level` and `floor` are set as `Scene.render3D()` does. */
async function renderNode(title: string, options: NodeOptions = {}, ea = makeEA()) {
  const settings = options.settings ?? settingsStub;
  const node = new Node({
    ea: ea.ea,
    page: makePage(title, options.counts, settings),
    isInferred: false,
    isCentral: options.isCentral ?? false,
    isSibling: false,
    friendGateOnLeft: true,
  });
  node.setCenter({ x: 100, y: 50 });
  if (options.view3D) {
    node.level = options.view3D.level;
    node.view3D = true;
    node.floor = options.view3D.floor;
  }
  await node.render();
  const box = ea.elements[node.id];
  const text = ea.elements[box.boundElements[0].id];
  return { node, box, text, ...ea };
}

const fns = (calls: Call[]) => calls.map((c) => c.fn);
const texts = (calls: Call[]) => calls.filter((c) => c.fn === 'addText').map((c) => c.args[2]);

describe('2D (the defaults): the upstream box, gates, counts and group', () => {
  it('draws the text box, four gates and the counts of the non-zero sides, grouped with the box and its text', async () => {
    const { node, box, text, calls, groups } = await renderNode('if-then プラン', { counts: { parent: 1, children: 12 } });
    expect(node.view3D).toBe(false);
    expect(node.floor).toBe(0);
    expect(fns(calls)).toEqual([
      'measureText', 'addText', // the title in its box
      'addEllipse', // friend gate (left)
      'addEllipse', // next-friend gate (right)
      'addEllipse', 'addText', // parent gate and its count
      'addEllipse', 'addText', // child gate and its count
      'addToGroup',
    ]);
    expect(texts(calls)).toEqual(['if-then プラン', '1', '12']);
    expect(box.backgroundColor).toBe(DEFAULT_NODE_STYLE.backgroundColor);
    expect(text.strokeColor).toBe(DEFAULT_NODE_STYLE.textColor);
    // A non-central node reuses the friend gate as its next-friend gate, so the group holds three gates.
    expect(node.nextFriendGateId).toBe(node.friendGateId);
    const [parentCount, childCount] = calls.filter((c) => c.fn === 'addText').slice(1).map((c) => c.id);
    expect(groups).toEqual([[node.friendGateId, node.parentGateId, node.childGateId, parentCount, childCount, node.id, text.id]]);
  });

  it('places the gates against the box as upstream does (radius 5, padding 10, offset 15)', async () => {
    const { node, box, elements, calls } = await renderNode('a');
    // The second ellipse is the right-hand gate; a non-central node then points nextFriendGateId back at the left one.
    const next = elements[calls.filter((c) => c.fn === 'addEllipse')[1].id];
    const [friend, parent, child] = [node.friendGateId, node.parentGateId, node.childGateId].map((id) => elements[id]);
    // Friend gate on the left: its right edge touches the box; the next-friend gate mirrors it on the right.
    expect(friend.x + friend.width).toBe(box.x);
    expect(friend.y + friend.height / 2).toBe(50);
    expect(next.x).toBe(box.x + box.width);
    // Parent gate above, child gate below, both offset 15 from the centre in opposite directions.
    expect(parent.y + parent.height).toBe(box.y);
    expect(parent.x + parent.width / 2).toBe(100 - 15);
    expect(child.y).toBe(box.y + box.height);
    expect(child.x + child.width / 2).toBe(100 + 15);
    expect(friend.width).toBe(10);
  });

  it('a central node keeps a next-friend gate of its own in the group', async () => {
    const { node, groups } = await renderNode('centre', { isCentral: true });
    expect(node.nextFriendGateId).not.toBe(node.friendGateId);
    expect(groups[0]).toContain(node.nextFriendGateId);
    expect(groups[0]).toHaveLength(6);
  });

  it('never reads levelColors: a settings object without it renders as before', async () => {
    const settings = { ...settingsStub, levelColors: undefined } as unknown as ExcaliBrainSettings;
    const { box, calls } = await renderNode('a', { settings });
    expect(box.backgroundColor).toBe(DEFAULT_NODE_STYLE.backgroundColor);
    expect(fns(calls)).toContain('addEllipse');
  });
});

describe('3D: no gates, no counts, the level colour and the L label', () => {
  it('draws only the text box and the "L{n}" label, grouped together', async () => {
    const { node, box, text, calls, groups, elements } = await renderNode('if-then プラン', {
      counts: { parent: 1, children: 12 },
      view3D: { level: 0, floor: -1 },
    });
    expect(fns(calls)).toEqual(['measureText', 'addText', 'measureText', 'addText', 'addToGroup']);
    expect(texts(calls)).toEqual(['if-then プラン', 'L2']);
    expect(node.friendGateId).toBeUndefined();
    expect(node.nextFriendGateId).toBeUndefined();
    expect(node.parentGateId).toBeUndefined();
    expect(node.childGateId).toBeUndefined();

    const label = elements[calls[3].id];
    expect(groups).toEqual([[label.id, node.id, text.id]]);
    // Right-aligned with the box, its bottom on the box's top, 0.6 of the node font in the node's text colour.
    expect(label.x + label.width).toBe(box.x + box.width);
    expect(label.y + label.height).toBe(box.y);
    expect(label.fontSize).toBe(DEFAULT_NODE_STYLE.fontSize * 0.6);
    expect(label.strokeColor).toBe(DEFAULT_NODE_STYLE.textColor);
  });

  it('colours the box by level − floor and swaps the white text for black where it would not read', async () => {
    const { box, text } = await renderNode('a', { view3D: { level: 0, floor: -1 } });
    expect(box.backgroundColor).toBe(DEFAULT_LEVEL_COLORS[1]);
    expect(text.strokeColor).toBe('#000000ff');
  });

  it.each<[Level, Level, string, string]>([
    [-1, -1, 'L1', DEFAULT_LEVEL_COLORS[0]],
    [0, -1, 'L2', DEFAULT_LEVEL_COLORS[1]],
    [1, -1, 'L3', DEFAULT_LEVEL_COLORS[2]],
    [0, 0, 'L1', DEFAULT_LEVEL_COLORS[0]],
    [1, 0, 'L2', DEFAULT_LEVEL_COLORS[1]],
  ])('level %i on floor %i is %s in the colour of that step', async (level, floor, expected, color) => {
    const { box, calls } = await renderNode('a', { view3D: { level, floor } });
    expect(texts(calls)).toEqual(['a', expected]);
    expect(box.backgroundColor).toBe(color);
  });

  it('a level beyond levelColors keeps the node colour and text colour but still gets its label', async () => {
    const settings: ExcaliBrainSettings = { ...settingsStub, levelColors: [DEFAULT_LEVEL_COLORS[0]] };
    const { box, text, calls } = await renderNode('a', { settings, view3D: { level: 1, floor: -1 } });
    expect(texts(calls)).toEqual(['a', 'L3']);
    expect(box.backgroundColor).toBe(DEFAULT_NODE_STYLE.backgroundColor);
    expect(text.strokeColor).toBe(DEFAULT_NODE_STYLE.textColor);
  });

  it('the central node takes its level colour like any other', async () => {
    const { box, text, calls } = await renderNode('centre', { isCentral: true, view3D: { level: 0, floor: 0 } });
    expect(texts(calls)).toEqual(['centre', 'L1']);
    expect(box.backgroundColor).toBe(DEFAULT_LEVEL_COLORS[0]);
    // The central style's black text already reads on the light floor colour, so it stays.
    expect(text.strokeColor).toBe('#000000ff');
  });

  it('a retained embedded centre keeps the colour of its frame and gets the label from the frame bounds', async () => {
    const frame: ExcalidrawElement = { id: 'frame', type: 'embeddable', x: -400, y: -300, width: 800, height: 600, backgroundColor: '#B5B5B5' };
    const ea = makeEA({ frame });
    const node = new Node({
      ea: ea.ea,
      page: makePage('centre'),
      isInferred: false,
      isCentral: true,
      isSibling: false,
      friendGateOnLeft: true,
      isEmbeded: true,
      embeddedElementIds: ['frame'],
    });
    node.view3D = true;
    node.floor = -1;
    await node.render();
    expect(node.id).toBe('frame');
    expect(fns(ea.calls)).toEqual(['measureText', 'addText', 'addToGroup']);
    expect(texts(ea.calls)).toEqual(['L2']);
    expect(ea.elements.frame.backgroundColor).toBe('#B5B5B5');
    const label = ea.elements[ea.calls[1].id];
    expect(label.x + label.width).toBe(400);
    expect(label.y + label.height).toBe(-300);
    expect(ea.groups).toEqual([[label.id, 'frame']]);
  });
});

describe('readableTextColor', () => {
  it('keeps the default white text on the darkest default level (L4) and swaps it for black on the lighter three', () => {
    const white = DEFAULT_NODE_STYLE.textColor;
    expect(DEFAULT_LEVEL_COLORS.map((color) => readableTextColor(color, white))).toEqual([
      '#000000ff',
      '#000000ff',
      '#000000ff',
      white,
    ]);
  });

  it('keeps a text colour that already reads, and picks white on a dark background', () => {
    expect(readableTextColor(DEFAULT_LEVEL_COLORS[0], '#000000ff')).toBe('#000000ff');
    expect(readableTextColor('#101010ff', '#202020ff')).toBe('#ffffffff');
  });

  it('keeps the text colour when either colour does not parse', () => {
    expect(readableTextColor('transparent', '#ffffffff')).toBe('#ffffffff');
    expect(readableTextColor(DEFAULT_LEVEL_COLORS[0], 'white')).toBe('white');
  });
});
