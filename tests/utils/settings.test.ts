import { describe, expect, it } from 'vitest';
import { DEFAULT_JEV_SETTINGS } from 'src/constants/constants';
import { DEFAULT_SETTINGS, isJevActive, normalizeRelationsHeading, withJevDefaults, type ExcaliBrainSettings } from 'src/Settings';
import type { JevSettings } from 'src/Types';

const settingsWithJev = (jev: Partial<JevSettings>): ExcaliBrainSettings =>
  ({ ...DEFAULT_SETTINGS, jev: withJevDefaults(jev) });

describe('Jev settings defaults (docs/jev-link-typer-design.md §6)', () => {
  it('are the values of the design table', () => {
    expect(DEFAULT_JEV_SETTINGS).toEqual({
      apiKey: '',
      enabled: false,
      suggestOnLinkClose: true,
      contextChars: 500,
      relationsHeading: 'Relations',
      writeMode: 'relations',
      autoConfirmThreshold: 0.8,
      reviewThreshold: 0.9,
      endpoint: 'https://api.typesafe.ai/v1/systemone',
      model: 'jev-latest',
    });
  });

  it('reach the settings as a copy, so an edit in the settings tab stays out of the constant', () => {
    expect(DEFAULT_SETTINGS.jev).toEqual(DEFAULT_JEV_SETTINGS);
    expect(DEFAULT_SETTINGS.jev).not.toBe(DEFAULT_JEV_SETTINGS);
  });
});

describe('withJevDefaults (what loadSettings does with a saved data.json)', () => {
  it('gives the defaults to a data.json that has no jev object at all', () => {
    expect(withJevDefaults(undefined)).toEqual(DEFAULT_JEV_SETTINGS);
  });

  it('keeps the saved keys and fills in the ones the file lacks', () => {
    const merged = withJevDefaults({ apiKey: 'saved-key', enabled: true, contextChars: 900 });

    expect(merged.apiKey).toBe('saved-key');
    expect(merged.enabled).toBe(true);
    expect(merged.contextChars).toBe(900);
    expect(merged.relationsHeading).toBe(DEFAULT_JEV_SETTINGS.relationsHeading);
    expect(merged.endpoint).toBe(DEFAULT_JEV_SETTINGS.endpoint);
    expect(merged.reviewThreshold).toBe(DEFAULT_JEV_SETTINGS.reviewThreshold);
  });

  it('returns a new object every load, so the settings tab never writes into the defaults', () => {
    expect(withJevDefaults(DEFAULT_SETTINGS.jev)).not.toBe(DEFAULT_SETTINGS.jev);
  });
});

describe('normalizeRelationsHeading (Jev writes the ## itself)', () => {
  it('keeps a plain heading, spaces and all', () => {
    expect(normalizeRelationsHeading('Relations')).toBe('Relations');
    expect(normalizeRelationsHeading('  Jev の関係  ')).toBe('Jev の関係');
  });

  it('drops the markers of a heading typed as Markdown', () => {
    expect(normalizeRelationsHeading('## Relations')).toBe('Relations');
    expect(normalizeRelationsHeading('#Relations')).toBe('Relations');
    expect(normalizeRelationsHeading('### My links')).toBe('My links');
  });

  it('falls back to the default for an emptied box', () => {
    expect(normalizeRelationsHeading('')).toBe(DEFAULT_JEV_SETTINGS.relationsHeading);
    expect(normalizeRelationsHeading('  ')).toBe(DEFAULT_JEV_SETTINGS.relationsHeading);
    expect(normalizeRelationsHeading('##')).toBe(DEFAULT_JEV_SETTINGS.relationsHeading);
  });
});

describe('isJevActive (nothing of Jev is registered without a key)', () => {
  it('is false while the key is empty, however enabled Jev is', () => {
    expect(isJevActive(settingsWithJev({ enabled: true }))).toBe(false);
    expect(isJevActive(settingsWithJev({ enabled: true, apiKey: '   ' }))).toBe(false);
  });

  it('is false, rather than throwing, for a data.json with a null key', () => {
    const corrupted = settingsWithJev({ enabled: true, apiKey: null });

    expect(isJevActive(corrupted)).toBe(false);
  });

  it('is false with a key while the switch is off', () => {
    expect(isJevActive(settingsWithJev({ apiKey: 'a-key' }))).toBe(false);
  });

  it('is true with a key and the switch on', () => {
    expect(isJevActive(settingsWithJev({ apiKey: 'a-key', enabled: true }))).toBe(true);
  });
});
