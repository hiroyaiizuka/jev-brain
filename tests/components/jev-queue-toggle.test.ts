import { beforeEach, describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import {
  JEV_QUEUE_VIEW_TYPE,
  isJevQueueOpen,
  showsJevQueueButton,
  toggleJevQueue,
} from 'src/Components/JevQueueView';
import { DEFAULT_SETTINGS, withJevDefaults, type ExcaliBrainSettings } from 'src/Settings';

/**
 * LEV-175: the Jev button of the tools panel (docs/jev-link-typer-design.md §4-2). When it shows,
 * and what a press does to the workspace. The drawn button and the queue itself are E20.
 */

const settingsWithJev = (jev: Partial<ExcaliBrainSettings['jev']>): ExcaliBrainSettings =>
  ({ ...DEFAULT_SETTINGS, jev: withJevDefaults(jev) });

const ACTIVE = settingsWithJev({ apiKey: 'a-key', enabled: true });

describe('showsJevQueueButton', () => {
  it('shows on the desktop when this load registered Jev and Jev is still on', () => {
    expect(showsJevQueueButton({ EA: { DEVICE: { isDesktop: true } }, jevRegistered: true, settings: ACTIVE })).toBe(true);
  });

  it('never shows on mobile', () => {
    expect(showsJevQueueButton({ EA: { DEVICE: { isDesktop: false } }, jevRegistered: true, settings: ACTIVE })).toBe(false);
  });

  it('does not show before Excalidraw told the device', () => {
    expect(showsJevQueueButton({ jevRegistered: true, settings: ACTIVE })).toBe(false);
  });

  it('does not show when this load did not register the queue view, even if a key was entered since', () => {
    expect(showsJevQueueButton({ EA: { DEVICE: { isDesktop: true } }, jevRegistered: false, settings: ACTIVE })).toBe(false);
  });

  it('does not show once the key is emptied or the switch turned off', () => {
    const desktop = { EA: { DEVICE: { isDesktop: true } }, jevRegistered: true };
    expect(showsJevQueueButton({ ...desktop, settings: settingsWithJev({ apiKey: '', enabled: true }) })).toBe(false);
    expect(showsJevQueueButton({ ...desktop, settings: settingsWithJev({ apiKey: 'a-key', enabled: false }) })).toBe(false);
  });
});

/** Just the workspace members the toggle uses: leaves of a type, the right sidebar, and detach. */
class FakeLeaf {
  type: string | null = null;
  constructor(private readonly workspace: FakeWorkspace) {}
  setViewState(state: { type: string }): Promise<void> {
    this.type = state.type;
    this.workspace.leaves.push(this);
    return Promise.resolve();
  }
  detach(): void {
    this.workspace.leaves = this.workspace.leaves.filter((leaf) => leaf !== this);
  }
}

class FakeWorkspace {
  leaves: FakeLeaf[] = [];
  revealed: FakeLeaf[] = [];
  getLeavesOfType(type: string): FakeLeaf[] {
    return this.leaves.filter((leaf) => leaf.type === type);
  }
  getRightLeaf(): FakeLeaf { return new FakeLeaf(this); }
  revealLeaf(leaf: FakeLeaf): Promise<void> {
    this.revealed.push(leaf);
    return Promise.resolve();
  }
}

describe('toggleJevQueue', () => {
  let workspace: FakeWorkspace;
  let app: App;

  beforeEach(() => {
    workspace = new FakeWorkspace();
    app = { workspace } as unknown as App;
  });

  it('opens the queue in the right sidebar when it is closed', async () => {
    await toggleJevQueue(app);

    expect(isJevQueueOpen(app)).toBe(true);
    expect(workspace.getLeavesOfType(JEV_QUEUE_VIEW_TYPE)).toHaveLength(1);
    expect(workspace.revealed).toHaveLength(1);
  });

  it('closes every open queue on the next press', async () => {
    await toggleJevQueue(app);
    await workspace.getRightLeaf().setViewState({ type: JEV_QUEUE_VIEW_TYPE });

    await toggleJevQueue(app);

    expect(isJevQueueOpen(app)).toBe(false);
  });

  it('leaves the other leaves alone', async () => {
    await workspace.getRightLeaf().setViewState({ type: 'markdown' });
    await toggleJevQueue(app);
    await toggleJevQueue(app);

    expect(workspace.leaves.map((leaf) => leaf.type)).toEqual(['markdown']);
  });
});
