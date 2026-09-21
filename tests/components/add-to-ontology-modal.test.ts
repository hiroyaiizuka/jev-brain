import { beforeEach, describe, expect, it } from 'vitest';
// The stubs by their own path: Vitest serves the same module for `obsidian`, and their test-only
// members (`Setting.created`, `Notice.messages`) are not on the real typings.
import { Notice, Setting } from '../mocks/obsidian';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import type { Hierarchy } from 'src/Types';
import { AddToOntologyModal, Ontology } from 'src/Components/AddToOntologyModal';
import { buildHierarchyLowerCase } from 'src/utils/hierarchy';

/**
 * The slice of the plugin the modal touches: the ontology (settings + Dataview keys), load/save
 * and the scene flag. `loadSettings` is a no-op so the test's ontology stays as written.
 */
function makePlugin(hierarchy: Partial<Hierarchy>) {
  const normalized = buildHierarchyLowerCase(hierarchy);
  const saves: number[] = [];
  const plugin = {
    app: {},
    settings: { hierarchy: normalized.hierarchy } as unknown as ExcaliBrainSettings,
    hierarchyLowerCase: normalized.hierarchyLowerCase,
    loadSettings: () => Promise.resolve(),
    saveSettings: () => { saves.push(1); return Promise.resolve(); },
    scene: null,
  } as unknown as ExcaliBrain;
  return { plugin, modal: new AddToOntologyModal(plugin.app, plugin), saves };
}

const ontology: Partial<Hierarchy> = {
  abstract: ['part of'],
  concrete: ['example'],
  parents: ['origin', 'up'],
  children: ['down'],
};

describe('AddToOntologyModal with the Up / Down regions', () => {
  beforeEach(() => {
    Setting.created = [];
    Notice.messages = [];
  });

  it('offers Up and Down between Hidden and Parents, and highlights the region the field is in', async () => {
    const { modal } = makePlugin(ontology);
    await modal.show('part of');
    const buttons = Setting.created.at(-1)?.buttons ?? [];
    expect(buttons.map((b) => b.text)).toEqual([
      'Hidden', 'Up (abstract)', 'Down (concrete)', 'Parents', 'Children',
      'Left-Side Friends', 'Right-Side Friends', 'Previous (Friends)', 'Next (Friends)',
    ]);
    expect(buttons.filter((b) => b.cta).map((b) => b.text)).toEqual(['Up (abstract)']);
  });

  it('moves a field from Parents to Up: settings and Dataview keys of both regions, one save, a notice', async () => {
    const { plugin, modal, saves } = makePlugin(ontology);
    await modal.addFieldToOntology(Ontology.Up, 'origin');
    expect(plugin.settings.hierarchy.parents).toEqual(['up']);
    expect(plugin.settings.hierarchy.abstract).toEqual(['origin', 'part of']);
    expect(plugin.hierarchyLowerCase.parents).toEqual(['up']);
    expect(plugin.hierarchyLowerCase.abstract).toEqual(['origin', 'part-of']);
    expect(saves).toHaveLength(1);
    expect(Notice.messages).toEqual(['Added origin as up']);
  });

  it('moves a field from Up to Down and from Down to Children', async () => {
    const { plugin, modal } = makePlugin(ontology);
    await modal.addFieldToOntology(Ontology.Down, 'part of');
    expect(plugin.settings.hierarchy.abstract).toEqual([]);
    expect(plugin.settings.hierarchy.concrete).toEqual(['example', 'part of']);
    expect(plugin.hierarchyLowerCase.concrete).toEqual(['example', 'part-of']);

    await modal.addFieldToOntology(Ontology.Child, 'part of');
    expect(plugin.settings.hierarchy.concrete).toEqual(['example']);
    expect(plugin.hierarchyLowerCase.concrete).toEqual(['example']);
    expect(plugin.settings.hierarchy.children).toEqual(['down', 'part of']);
  });

  it('adds a new field to Down without touching the other regions', async () => {
    const { plugin, modal } = makePlugin(ontology);
    await modal.addFieldToOntology(Ontology.Down, 'Illustrates');
    expect(plugin.settings.hierarchy.concrete).toEqual(['example', 'Illustrates']);
    expect(plugin.hierarchyLowerCase.concrete).toEqual(['example', 'illustrates']);
    expect(plugin.settings.hierarchy).toMatchObject({ abstract: ['part of'], parents: ['origin', 'up'], children: ['down'] });
  });

  it('does nothing when the field is already in the chosen region', async () => {
    const { plugin, modal, saves } = makePlugin(ontology);
    await modal.addFieldToOntology(Ontology.Up, 'part of');
    expect(plugin.settings.hierarchy.abstract).toEqual(['part of']);
    expect(saves).toHaveLength(0);
  });
});
