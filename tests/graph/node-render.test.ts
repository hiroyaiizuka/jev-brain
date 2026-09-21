import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVEL_COLORS, DEFAULT_NODE_STYLE } from 'src/constants/constants';
import type { ExcaliBrainSettings } from 'src/Settings';
import { Node, readableTextColor, type View3DRender } from 'src/graph/Node';
import type { Page } from 'src/graph/Page';
import type { Level } from 'src/graph/Projection';
import type { ExcalidrawAutomate, ExcalidrawElement, ExcalidrawStyleLike } from 'src/utils/ExcalidrawAutomateCompatibility';

/**
 * What `Node.render()` draws (docs/3d-design.md §6-3): in 2D the upstream text box, four gates, neighbour counts
 * and group; in 3D the text box in the colour of its level, no label, no gates,
 * no counts. The elements go through an ExcalidrawAutomate stub that logs every call with the style at that
 * moment and keeps the elements it made, so a test can read the box back as Scene does.
 */
const CANVAS = '#0c3e6aff'; // DEFAULT_SETTINGS.backgroundColor: the dark blue the labels sit on

const settingsStub = {
  backgroundColor: CANVAS,
  baseNodeStyle: { ...DEFAULT_NODE_STYLE },
  centralNodeStyle: { fontSize: 30, backgroundColor: '#B5B5B5', textColor: '#000000ff' },
  inferredNodeStyle: {},
  urlNodeStyle: {},
  virtualNodeStyle: { backgroundColor: '#ff000066', fillStyle: 'hachure', textColor: '#ffffffff' },
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
type PageOptions = { counts?: Counts; isVirtual?: boolean; settings?: ExcaliBrainSettings };

/** The slice of `Page` the constructor and `render()` read: kind flags, style tags, title and the neighbour counts. */
function makePage(title: string, options: PageOptions = {}): Page {
  const counts = options.counts ?? {};
  return {
    plugin: { settings: options.settings ?? settingsStub },
    path: `${title}.md`,
    file: { path: `${title}.md` },
    isFolder: false,
    isTag: false,
    isURL: false,
    isVirtual: options.isVirtual ?? false,
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
          fillStyle: ea.style.fillStyle,
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

type NodeOptions = PageOptions & { isCentral?: boolean; view3D?: View3DRender & { level: Level } };

/** A text node at (100, 50), rendered. In 3D `level` is set as `Scene.addNodes()` does and `floor` passed as `Scene.render3D()` does. */
async function renderNode(title: string, options: NodeOptions = {}, ea = makeEA()) {
  const node = new Node({
    ea: ea.ea,
    page: makePage(title, options),
    isInferred: false,
    isCentral: options.isCentral ?? false,
    isSibling: false,
    friendGateOnLeft: true,
  });
  node.setCenter({ x: 100, y: 50 });
  if (options.view3D) {
    node.level = options.view3D.level;
    await node.render({ floor: options.view3D.floor });
  } else {
    await node.render();
  }
  const box = ea.elements[node.id];
  const text = ea.elements[box.boundElements[0].id];
  return { node, box, text, ...ea };
}

/** A retained embedded centre (`retainCentralNode`): the frame is already on the canvas and `render()` must not redraw it. */
function retainedNode(ea: ReturnType<typeof makeEA>, embeddedElementIds = ['frame']): Node {
  return new Node({
    ea: ea.ea,
    page: makePage('centre'),
    isInferred: false,
    isCentral: true,
    isSibling: false,
    friendGateOnLeft: true,
    isEmbeded: true,
    embeddedElementIds,
  });
}

const fns = (calls: Call[]) => calls.map((c) => c.fn);
const texts = (calls: Call[]) => calls.filter((c) => c.fn === 'addText').map((c) => c.args[2]);

describe('2D (the defaults): the upstream box, gates, counts and group', () => {
  it('draws the text box, four gates and the counts of the non-zero sides, grouped with the box and its text', async () => {
    const { node, box, text, calls, groups } = await renderNode('if-then プラン', { counts: { parent: 1, children: 12 } });
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
    expect(box.fillStyle).toBe(DEFAULT_NODE_STYLE.fillStyle);
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

  it('a virtual node keeps its hatched red box', async () => {
    const { box } = await renderNode('ghost', { isVirtual: true });
    expect(box).toMatchObject({ backgroundColor: '#ff000066', fillStyle: 'hachure' });
  });

  it('never reads levelColors: a settings object without it renders as before', async () => {
    const settings = { ...settingsStub, levelColors: undefined } as unknown as ExcaliBrainSettings;
    const { box, calls } = await renderNode('a', { settings });
    expect(box.backgroundColor).toBe(DEFAULT_NODE_STYLE.backgroundColor);
    expect(fns(calls)).toContain('addEllipse');
  });

  it('leaves the bound elements of a retained frame alone', async () => {
    const frame: ExcalidrawElement = { id: 'frame', x: 0, y: 0, width: 800, height: 600, boundElements: [{ id: 'arrow-old', type: 'arrow' }] };
    const ea = makeEA({ frame, 'arrow-old': { id: 'arrow-old', isDeleted: true } });
    await retainedNode(ea).render();
    expect(ea.elements.frame.boundElements).toEqual([{ id: 'arrow-old', type: 'arrow' }]);
    expect(fns(ea.calls)).not.toContain('measureText');
  });
});

describe('3D: no gates, no counts, no label, just the level colour', () => {
  it('draws only the text box, grouped with its text (the "L{n}" label was dropped in LEV-130)', async () => {
    const { node, text, calls, groups } = await renderNode('if-then プラン', {
      counts: { parent: 1, children: 12 },
      view3D: { level: 0, floor: -1 },
    });
    expect(fns(calls)).toEqual(['measureText', 'addText', 'addToGroup']);
    expect(texts(calls)).toEqual(['if-then プラン']);
    expect(node.friendGateId).toBeUndefined();
    expect(node.nextFriendGateId).toBeUndefined();
    expect(node.parentGateId).toBeUndefined();
    expect(node.childGateId).toBeUndefined();
    expect(groups).toEqual([[node.id, text.id]]);
  });

  it('colours the box by level − floor, solid, and swaps the white text for black where it would not read', async () => {
    const { box, text } = await renderNode('a', { view3D: { level: 0, floor: -1 } });
    expect(box.backgroundColor).toBe(DEFAULT_LEVEL_COLORS[1]);
    expect(box.fillStyle).toBe('solid');
    expect(text.strokeColor).toBe('#000000ff');
  });

  it.each<[Level, Level, string]>([
    [-1, -1, DEFAULT_LEVEL_COLORS[0]],
    [0, -1, DEFAULT_LEVEL_COLORS[1]],
    [1, -1, DEFAULT_LEVEL_COLORS[2]],
    [0, 0, DEFAULT_LEVEL_COLORS[0]],
    [1, 0, DEFAULT_LEVEL_COLORS[1]],
  ])('level %i on floor %i takes the colour of that step (the step is no longer written out)', async (level, floor, color) => {
    const { box, calls } = await renderNode('a', { view3D: { level, floor } });
    expect(texts(calls)).toEqual(['a']);
    expect(box.backgroundColor).toBe(color);
  });

  it('a level beyond levelColors keeps the node colour, fill and text colour', async () => {
    const settings: ExcaliBrainSettings = { ...settingsStub, levelColors: [DEFAULT_LEVEL_COLORS[0]] };
    const { box, text, calls } = await renderNode('a', { settings, view3D: { level: 1, floor: -1 } });
    expect(texts(calls)).toEqual(['a']);
    expect(box.backgroundColor).toBe(DEFAULT_NODE_STYLE.backgroundColor);
    expect(box.fillStyle).toBe(DEFAULT_NODE_STYLE.fillStyle);
    expect(text.strokeColor).toBe(DEFAULT_NODE_STYLE.textColor);
  });

  it('a virtual node gets a solid level colour instead of its hatching, so its title reads', async () => {
    const { box, text } = await renderNode('ghost', { isVirtual: true, view3D: { level: 0, floor: 0 } });
    expect(box).toMatchObject({ backgroundColor: DEFAULT_LEVEL_COLORS[0], fillStyle: 'solid' });
    expect(text.strokeColor).toBe('#000000ff');
  });

  it('the central node takes its level colour like any other and keeps its black text on the light floor colour', async () => {
    const { box, text, calls } = await renderNode('centre', { isCentral: true, view3D: { level: 0, floor: 0 } });
    expect(texts(calls)).toEqual(['centre']);
    expect(box.backgroundColor).toBe(DEFAULT_LEVEL_COLORS[0]);
    expect(text.strokeColor).toBe('#000000ff');
  });

  it('a retained embedded centre keeps the colour of its frame and draws nothing else', async () => {
    const frame: ExcalidrawElement = { id: 'frame', type: 'embeddable', x: -400, y: -300, width: 800, height: 600, backgroundColor: '#B5B5B5' };
    const ea = makeEA({ frame });
    const node = retainedNode(ea);
    await node.render({ floor: -1 });
    expect(node.id).toBe('frame');
    expect(fns(ea.calls)).toEqual(['addToGroup']);
    expect(ea.elements.frame.backgroundColor).toBe('#B5B5B5');
    expect(ea.groups).toEqual([['frame']]);
  });

  it('drops the deleted arrows from the bound elements of a retained frame (the links bind to it again each render)', async () => {
    const frame: ExcalidrawElement = {
      id: 'frame', x: 0, y: 0, width: 800, height: 600,
      boundElements: [{ id: 'arrow-old', type: 'arrow' }, { id: 'arrow-gone', type: 'arrow' }, { id: 'text-live', type: 'text' }],
    };
    const ea = makeEA({ frame, 'arrow-old': { id: 'arrow-old', isDeleted: true }, 'text-live': { id: 'text-live' } });
    await retainedNode(ea).render({ floor: 0 });
    expect(ea.elements.frame.boundElements).toEqual([{ id: 'text-live', type: 'text' }]);
  });

  it('a retained frame that is no longer on the canvas does not throw', async () => {
    const ea = makeEA();
    const node = retainedNode(ea);
    await expect(node.render({ floor: 0 })).resolves.toBeUndefined();
    expect(fns(ea.calls)).toEqual(['addToGroup']);
    expect(ea.groups).toEqual([['frame']]);
  });
});

describe('readableTextColor', () => {
  it('keeps the default white text on the darkest default level (L4) and swaps it for black on the lighter three', () => {
    const white = DEFAULT_NODE_STYLE.textColor;
    expect(DEFAULT_LEVEL_COLORS.map((color) => readableTextColor(color, white, CANVAS))).toEqual([
      '#000000ff',
      '#000000ff',
      '#000000ff',
      white,
    ]);
  });

  it('keeps a text colour that already reads, and picks white on a dark background', () => {
    expect(readableTextColor(DEFAULT_LEVEL_COLORS[0], '#000000ff')).toBe('#000000ff');
    expect(readableTextColor('#101010ff', '#202020ff')).toBe('#ffffffff');
    expect(readableTextColor(CANVAS, '#000000ff')).toBe('#ffffffff');
  });

  it('measures a translucent background as seen over the canvas: a faint level colour over the dark canvas keeps white text', () => {
    const faint = '#eeedfd4d'; // L1 at opacity 0.3, as the settings picker writes it: a mid blue over the canvas
    expect(readableTextColor(faint, '#ffffffff', CANVAS)).toBe('#ffffffff');
    expect(readableTextColor(faint, '#ffffffff')).toBe('#000000ff'); // opaque without a canvas
    expect(readableTextColor(faint, '#000000ff', CANVAS)).toBe('#000000ff'); // black still reads on the mid blue (4.2:1)
    expect(readableTextColor('#eeedfd1a', '#000000ff', CANVAS)).toBe('#ffffffff'); // at opacity 0.1 it no longer does
  });

  it('keeps the text colour when either colour does not parse', () => {
    expect(readableTextColor('transparent', '#ffffffff')).toBe('#ffffffff');
    expect(readableTextColor(DEFAULT_LEVEL_COLORS[0], 'white')).toBe('white');
    expect(readableTextColor(DEFAULT_LEVEL_COLORS[0], '#ffffffff', 'transparent')).toBe('#000000ff'); // an unparsable canvas is ignored
  });
});
