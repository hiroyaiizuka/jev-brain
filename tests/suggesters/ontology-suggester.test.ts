import { describe, expect, it } from 'vitest';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import type { Hierarchy } from 'src/Types';
import { FieldSuggester } from 'src/Suggesters/OntologySuggester';

/** `getKeys()` reads only the ontology and the primary tag field. */
function makeSuggester(hierarchy: Partial<Hierarchy>, suggestType: FieldSuggester['suggestType']) {
  const plugin = {
    app: {},
    settings: { hierarchy, primaryTagField: 'Note type' } as unknown as ExcaliBrainSettings,
  } as unknown as ExcaliBrain;
  const suggester = new FieldSuggester(plugin);
  suggester.suggestType = suggestType;
  return suggester;
}

const ontology: Partial<Hierarchy> = {
  hidden: ['secret'],
  abstract: ['part of'],
  concrete: ['example'],
  parents: ['origin'],
  children: ['steps'],
  leftFriends: ['similar'],
  rightFriends: ['opposes'],
  previous: ['before'],
  next: ['after'],
};

describe('FieldSuggester.getKeys with the Up / Down regions', () => {
  it('lists the Up and Down fields in the generic suggester, sorted with the rest', () => {
    expect(makeSuggester(ontology, 'all').getKeys()).toEqual([
      'after', 'before', 'example', 'Note type', 'opposes', 'origin', 'part of', 'secret', 'similar', 'steps',
    ]);
  });

  it('keeps the direction-specific lists as they were: Up is not in the parent list, Down not in the child list', () => {
    expect(makeSuggester(ontology, 'parent').getKeys()).toEqual(['origin']);
    expect(makeSuggester(ontology, 'child').getKeys()).toEqual(['steps']);
  });
});
