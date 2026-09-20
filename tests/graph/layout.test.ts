import { describe, expect, it } from 'vitest';
import { Layout } from 'src/graph/Layout';
import type { Node } from 'src/graph/Node';
import type { LayoutSpecification } from 'src/Types';

type Center = { x: number; y: number };

/**
 * The three members of `Node` that `Layout` touches: `title` (sort key), `setCenter()` (placing)
 * and `render()` (drawing). Every call is appended to a shared log so a test can check the order.
 * `settle` lets a test hold `render()` open to prove the nodes are drawn one after the other.
 */
class NodeStub {
  center: Center | null = null;

  constructor(
    readonly title: string,
    private readonly log: string[],
    private readonly settle?: () => Promise<void>,
  ) {}

  setCenter(center: Center): void {
    this.center = center;
    this.log.push(`place:${this.title}`);
  }

  render(): Promise<void> {
    this.log.push(`render:${this.title}`);
    return this.settle ? this.settle() : Promise.resolve();
  }
}

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

function makeLayout(spec: Partial<LayoutSpecification>, titles: string[], settle?: () => Promise<void>) {
  const log: string[] = [];
  const layout = new Layout({ ...baseSpec, ...spec });
  const stubs = titles.map((title) => new NodeStub(title, log, settle));
  layout.nodes.push(...(stubs as unknown as Node[]));
  return { layout, stubs, log };
}

/** Centres keyed by title, so an expectation reads as a small table. */
function centersOf(stubs: NodeStub[]): Record<string, Center | null> {
  return Object.fromEntries(stubs.map((stub) => [stub.title, stub.center]));
}

/** Lets every pending microtask (awaited renders and the loop after them) run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Layout.place()', () => {
  it('sorts by title (case-insensitive) and stacks a single column around origoY', () => {
    const { layout, stubs } = makeLayout({ columns: 1, origoX: 10, origoY: 0 }, ['b', 'A', 'c']);
    layout.place();
    // 3 rows × 100 = 300 high, centred on origoY: rows at -150, -50, 50.
    expect(centersOf(stubs)).toEqual({
      A: { x: 10, y: -150 },
      b: { x: 10, y: -50 },
      c: { x: 10, y: 50 },
    });
  });

  it('spreads full rows over the columns and puts a lone last item in the first column of 2', () => {
    const { layout, stubs } = makeLayout({ columns: 2, origoX: 0, origoY: 0 }, ['a', 'b', 'c']);
    layout.place();
    // column 0 is origoX - columnWidth/2, column 1 is origoX + columnWidth/2; 2 rows → -100 / 0.
    expect(centersOf(stubs)).toEqual({
      a: { x: -100, y: -100 },
      b: { x: 100, y: -100 },
      c: { x: -100, y: 0 },
    });
  });

  it('centres a lone last item under 3 columns and leaves the empty slots null', () => {
    const { layout, stubs } = makeLayout({ columns: 3, origoX: 0, origoY: 0 }, ['a', 'b', 'c', 'd']);
    layout.place();
    expect(centersOf(stubs)).toEqual({
      a: { x: -200, y: -100 },
      b: { x: 0, y: -100 },
      c: { x: 200, y: -100 },
      d: { x: 0, y: 0 },
    });
    expect(layout.renderedNodes[1].map((node) => (node ? node.title : null))).toEqual([null, 'd', null, null]);
  });

  it('pins the upstream row vector for 2 leftovers under 3 columns (one extra slot, items at columns 1 and 2)', () => {
    const { layout, stubs } = makeLayout({ columns: 3, origoX: 0, origoY: 0 }, ['a', 'b', 'c', 'd', 'e']);
    layout.place();
    expect(centersOf(stubs)).toEqual({
      a: { x: -200, y: -100 },
      b: { x: 0, y: -100 },
      c: { x: 200, y: -100 },
      d: { x: 0, y: 0 },
      e: { x: 200, y: 0 },
    });
  });

  it('clamps to top when the centred block would start above it', () => {
    const { layout, stubs } = makeLayout({ columns: 1, origoY: 0, top: 0 }, ['a', 'b']);
    layout.place();
    // Unconstrained the block would start at -100; top = 0 wins.
    expect(centersOf(stubs)).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } });
  });

  it('keeps the centred block when top is far enough away', () => {
    const { layout, stubs } = makeLayout({ columns: 1, origoY: 0, top: -500 }, ['a', 'b']);
    layout.place();
    expect(centersOf(stubs)).toEqual({ a: { x: 0, y: -100 }, b: { x: 0, y: 0 } });
  });

  it('clamps to bottom when the centred block would end below it', () => {
    const { layout, stubs } = makeLayout({ columns: 1, origoY: 0, bottom: 0 }, ['a', 'b']);
    layout.place();
    // Unconstrained the block would end at +100; bottom = 0 moves it up by 200 (its height).
    expect(centersOf(stubs)).toEqual({ a: { x: 0, y: -200 }, b: { x: 0, y: -100 } });
  });

  it('keeps the centred block when bottom is far enough away', () => {
    const { layout, stubs } = makeLayout({ columns: 1, origoY: 0, bottom: 500 }, ['a', 'b']);
    layout.place();
    expect(centersOf(stubs)).toEqual({ a: { x: 0, y: -100 }, b: { x: 0, y: 0 } });
  });

  it('only places; nothing is rendered', () => {
    const { layout, log } = makeLayout({ columns: 2 }, ['a', 'b', 'c']);
    layout.place();
    expect(log).toEqual(['place:a', 'place:b', 'place:c']);
  });

  it('does nothing for an empty layout', () => {
    const { layout, log } = makeLayout({}, []);
    layout.place();
    expect(layout.renderedNodes).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe('Layout.renderNodes()', () => {
  it('renders the placed nodes row by row, skipping empty slots, each exactly once', async () => {
    const { layout, log } = makeLayout({ columns: 3 }, ['a', 'b', 'c', 'd']);
    layout.place();
    await layout.renderNodes();
    expect(log.filter((entry) => entry.startsWith('render:'))).toEqual(['render:a', 'render:b', 'render:c', 'render:d']);
  });

  it('waits for each render before starting the next', async () => {
    const gates: (() => void)[] = [];
    const settle = () => new Promise<void>((resolve) => { gates.push(resolve); });
    const { layout, log } = makeLayout({ columns: 1 }, ['a', 'b', 'c'], settle);
    layout.place();
    const rendered = (entries: string[]) => entries.filter((entry) => entry.startsWith('render:'));

    const done = layout.renderNodes();
    await flush();
    expect(rendered(log)).toEqual(['render:a']);

    gates.shift()?.();
    await flush();
    expect(rendered(log)).toEqual(['render:a', 'render:b']);

    gates.shift()?.();
    await flush();
    expect(rendered(log)).toEqual(['render:a', 'render:b', 'render:c']);

    gates.shift()?.();
    await done;
  });
});

describe('Layout.render() (the 2D path)', () => {
  it('places every node first, then renders each once in layout order', async () => {
    const { layout, stubs, log } = makeLayout({ columns: 2, origoX: 0, origoY: 0 }, ['c', 'a', 'b']);
    await layout.render();
    expect(log).toEqual(['place:a', 'place:b', 'place:c', 'render:a', 'render:b', 'render:c']);
    expect(centersOf(stubs)).toEqual({
      a: { x: -100, y: -100 },
      b: { x: 100, y: -100 },
      c: { x: -100, y: 0 },
    });
  });

  it('renders nothing for an empty layout', async () => {
    const { layout, log } = makeLayout({}, []);
    await layout.render();
    expect(log).toEqual([]);
  });
});
