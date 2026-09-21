import { describe, expect, it } from 'vitest';
import { Layout } from 'src/graph/Layout';
import type { Node } from 'src/graph/Node';
import type { LayoutSpecification } from 'src/Types';

type Center = { x: number; y: number };

/** Lets every pending microtask run, so an awaited `render()` is observably still in flight. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The three members of `Node` that `Layout` touches: `title` (sort key), `setCenter()` (placing)
 * and `render()` (drawing). Every call is appended to a shared log so a test can check the order.
 * `render()` logs its start, yields once, then logs its end: a sequential caller produces
 * `render:a, done:a, render:b, …`, a parallel one `render:a, render:b, …, done:a, …`.
 */
class NodeStub {
  center: Center | null = null;

  constructor(readonly title: string, private readonly log: string[]) {}

  setCenter(center: Center): void {
    this.center = center;
    this.log.push(`place:${this.title}`);
  }

  async render(): Promise<void> {
    this.log.push(`render:${this.title}`);
    await flush();
    this.log.push(`done:${this.title}`);
  }
}

/** One column, unconstrained, 100 high rows and 200 wide columns; each case overrides only what differs. */
const baseSpec: LayoutSpecification = {
  columns: 1,
  origoX: 0,
  origoY: 0,
  top: null,
  bottom: null,
  rowHeight: 100,
  columnWidth: 200,
  maxLabelLength: 30,
};

function makeLayout(titles: string[], spec: Partial<LayoutSpecification> = {}) {
  const log: string[] = [];
  const layout = new Layout({ ...baseSpec, ...spec });
  const stubs = titles.map((title) => new NodeStub(title, log));
  layout.nodes.push(...(stubs as unknown as Node[]));
  return { layout, stubs, log };
}

/** Centres keyed by title, so an expectation reads as a small table. */
function centersOf(stubs: NodeStub[]): Record<string, Center | null> {
  return Object.fromEntries(stubs.map((stub) => [stub.title, stub.center]));
}

const rendered = (log: string[]) => log.filter((entry) => entry.startsWith('render:'));

describe('Layout.place()', () => {
  // `y` is the node CENTRE (Node.render* subtracts the label's half height from it). Upstream uses
  // `origoY - rows*rowHeight/2` as the centre of row 0, so the block of centres sits half a row above
  // origoY; the tables below pin that upstream placement, they do not correct it.
  it.each<{ name: string; spec?: Partial<LayoutSpecification>; titles: string[]; centers: Record<string, Center> }>([
    {
      name: 'sorts by title ignoring case and stacks one column downwards from origoY - height/2',
      spec: { origoX: 10 },
      titles: ['B', 'a', 'c'], // code-point order would give B, a, c
      centers: { a: { x: 10, y: -150 }, B: { x: 10, y: -50 }, c: { x: 10, y: 50 } },
    },
    {
      name: '2 columns: a full row, then a lone item in the first column',
      spec: { columns: 2 },
      titles: ['a', 'b', 'c'],
      centers: { a: { x: -100, y: -100 }, b: { x: 100, y: -100 }, c: { x: -100, y: 0 } },
    },
    {
      name: '3 columns: a lone item is centred',
      spec: { columns: 3 },
      titles: ['a', 'b', 'c', 'd'],
      centers: { a: { x: -200, y: -100 }, b: { x: 0, y: -100 }, c: { x: 200, y: -100 }, d: { x: 0, y: 0 } },
    },
    {
      name: '3 columns: 2 leftovers sit in the middle and right columns (upstream row vector)',
      spec: { columns: 3 },
      titles: ['a', 'b', 'c', 'd', 'e'],
      centers: {
        a: { x: -200, y: -100 }, b: { x: 0, y: -100 }, c: { x: 200, y: -100 },
        d: { x: 0, y: 0 }, e: { x: 200, y: 0 },
      },
    },
    {
      name: '4 columns: 3 leftovers fill from the left (even columns, odd leftover)',
      spec: { columns: 4 },
      titles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      centers: {
        a: { x: -300, y: -100 }, b: { x: -100, y: -100 }, c: { x: 100, y: -100 }, d: { x: 300, y: -100 },
        e: { x: -300, y: 0 }, f: { x: -100, y: 0 }, g: { x: 100, y: 0 },
      },
    },
    {
      name: '4 columns: 2 leftovers go to columns 1 and 3 (even columns, even leftover, upstream row vector)',
      spec: { columns: 4 },
      titles: ['a', 'b', 'c', 'd', 'e', 'f'],
      centers: {
        a: { x: -300, y: -100 }, b: { x: -100, y: -100 }, c: { x: 100, y: -100 }, d: { x: 300, y: -100 },
        e: { x: -100, y: 0 }, f: { x: 300, y: 0 },
      },
    },
    {
      name: 'top: row 0 is clamped to top when origoY - height/2 would be above it',
      spec: { top: 0 },
      titles: ['a', 'b'],
      centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }, // unconstrained: -100 / 0
    },
    {
      name: 'top: no clamp when origoY - height/2 is already below it',
      spec: { top: -500 },
      titles: ['a', 'b'],
      centers: { a: { x: 0, y: -100 }, b: { x: 0, y: 0 } },
    },
    {
      name: 'bottom: the block moves up by its height when origoY + height/2 would be below it',
      spec: { bottom: 0 },
      titles: ['a', 'b'],
      centers: { a: { x: 0, y: -200 }, b: { x: 0, y: -100 } }, // unconstrained: -100 / 0
    },
    {
      name: 'bottom: no clamp when origoY + height/2 is already above it',
      spec: { bottom: 500 },
      titles: ['a', 'b'],
      centers: { a: { x: 0, y: -100 }, b: { x: 0, y: 0 } },
    },
  ])('$name', ({ spec, titles, centers }) => {
    const { layout, stubs } = makeLayout(titles, spec);
    layout.place();
    expect(centersOf(stubs)).toEqual(centers);
  });

  it('only places; nothing is rendered', () => {
    const { layout, log } = makeLayout(['a', 'b', 'c'], { columns: 2 });
    layout.place();
    expect(log).toEqual(['place:a', 'place:b', 'place:c']);
  });

  it('does nothing for an empty layout', () => {
    const { layout, log } = makeLayout([]);
    layout.place();
    expect(layout.renderedNodes).toEqual([]);
    expect(log).toEqual([]);
  });

  it('forgets the previous rows when nodes are emptied and placed again', async () => {
    const { layout, log } = makeLayout(['a']);
    layout.place();
    layout.nodes.length = 0;
    layout.place();
    expect(layout.renderedNodes).toEqual([]);
    await layout.renderNodes();
    expect(rendered(log)).toEqual([]);
  });
});

describe('Layout.renderNodes()', () => {
  it('renders the placed nodes row by row, skipping empty slots, each exactly once', async () => {
    const { layout, log } = makeLayout(['a', 'b', 'c', 'd'], { columns: 3 });
    layout.place();
    await layout.renderNodes();
    expect(rendered(log)).toEqual(['render:a', 'render:b', 'render:c', 'render:d']);
  });

  it('waits for each render before starting the next', async () => {
    const { layout, log } = makeLayout(['a', 'b', 'c']);
    layout.place();
    await layout.renderNodes();
    expect(log.filter((entry) => !entry.startsWith('place:'))).toEqual([
      'render:a', 'done:a', 'render:b', 'done:b', 'render:c', 'done:c',
    ]);
  });
});

describe('Layout.render() (the 2D path)', () => {
  it('places every node first, then renders each once, sequentially, in layout order', async () => {
    const { layout, stubs, log } = makeLayout(['c', 'a', 'b'], { columns: 2 });
    await layout.render();
    expect(log).toEqual([
      'place:a', 'place:b', 'place:c',
      'render:a', 'done:a', 'render:b', 'done:b', 'render:c', 'done:c',
    ]);
    expect(stubs.every((stub) => stub.center !== null)).toBe(true);
  });

  it('renders nothing for an empty layout', async () => {
    const { layout, log } = makeLayout([]);
    await layout.render();
    expect(log).toEqual([]);
  });
});
