import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TFile } from 'obsidian';
import type { Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from 'obsidian';
// The stubs by their own path: Vitest serves the same module for `obsidian`, and their test-only
// members (`Notice.messages`, `requestUrlMock`, `VaultStub.notes`) are not on the real typings.
import { Notice, VaultStub, requestUrlMock } from '../mocks/obsidian';
import type { RequestUrlReply } from '../mocks/obsidian';
import type ExcaliBrain from 'src/excalibrain-main';
import type { ExcaliBrainSettings } from 'src/Settings';
import type { Hierarchy, JevSettings } from 'src/Types';
import { DEFAULT_JEV_SETTINGS } from 'src/constants/constants';
import { buildHierarchyLowerCase } from 'src/utils/hierarchy';
import { JevLinkSuggest } from 'src/Suggesters/JevLinkSuggest';
import type { JevSuggestion } from 'src/Suggesters/JevLinkSuggest';

const fixtures = fileURLToPath(new URL('../fixtures/jev', import.meta.url));
const MANIFEST_DIR = '.obsidian/plugins/jevbrain';

/** A recorded reply: `status` plus either a JSON `body` or, when it is not valid JSON, raw `bodyText`. */
interface RecordedReply { status: number; body?: unknown; bodyText?: string }

function recorded(name: string): RequestUrlReply {
  const reply = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as RecordedReply;
  return { status: reply.status, text: reply.bodyText ?? JSON.stringify(reply.body) };
}

/** A Dataview link value, as `tests/jev/collect.test.ts` writes it. */
type DvLink = { path: string };

/** A note of the stub vault: its text, its Dataview fields and its frontmatter. */
type Note = { content?: string; fields?: Record<string, DvLink>; frontmatter?: Record<string, unknown> };

/** One field per region, so the settings' order of `judge`'s candidates is easy to read. */
const ONTOLOGY: Partial<Hierarchy> = {
  hidden: ['ignore'],
  abstract: ['up'],
  concrete: ['down'],
  parents: ['origin'],
  children: ['steps'],
  leftFriends: ['similar'],
  rightFriends: ['opposes'],
  previous: ['before'],
  next: ['after'],
  exclusions: [],
};

/** The order `buildQuestions` puts the ontology in: region by region, as the settings list them. */
const SETTINGS_ORDER = ['up', 'down', 'origin', 'steps', 'similar', 'opposes', 'before', 'after'];

/** `cachedRead` is the only vault member the suggester needs on top of the shared stub. */
class Vault extends VaultStub {
  cachedRead(file: TFile): Promise<string> {
    return Promise.resolve(this.notes.get(file.path) ?? '');
  }
}

function setup(
  notes: Record<string, Note>,
  options: { jev?: Partial<JevSettings>; ontology?: Partial<Hierarchy>; excludeFilepaths?: string[] } = {},
) {
  const vault = new Vault(
    Object.fromEntries(Object.entries(notes).map(([path, note]) => [path, note.content ?? ''])),
  );
  const files = new Map(
    Object.keys(notes).map((path) => [path, Object.assign(new TFile(), { path })]),
  );
  // Links resolve by path or by basename (`[[B]]` → `B.md`); an unlisted note stays unresolved.
  const resolve = (linkpath: string): TFile | null =>
    files.get(linkpath) ?? files.get(`${linkpath}.md`) ?? null;
  const { hierarchy, hierarchyLowerCase } = buildHierarchyLowerCase(options.ontology ?? ONTOLOGY);
  const opened: ((file: TFile | null) => void)[] = [];

  const plugin = {
    settings: {
      hierarchy,
      excalibrainFilepath: 'excalibrain.md',
      excludeFilepaths: options.excludeFilepaths ?? [],
      jev: { ...DEFAULT_JEV_SETTINGS, apiKey: 'test-key', enabled: true, ...options.jev },
    } satisfies Partial<ExcaliBrainSettings> as unknown as ExcaliBrainSettings,
    hierarchyLowerCase,
    manifest: { dir: MANIFEST_DIR },
    registerEvent: (): void => { /* the suggester's event ref is not read back */ },
    app: {
      vault,
      workspace: {
        on: (name: string, callback: (file: TFile | null) => void) => {
          if (name === 'file-open') opened.push(callback);
          return { name };
        },
      },
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) => resolve(linkpath),
        getFileCache: (file: TFile) => ({ frontmatter: notes[file.path]?.frontmatter }),
      },
    },
    DVAPI: {
      page: (path: string) => (notes[path] ? { ...notes[path].fields, file: { path } } : undefined),
    },
  } as unknown as ExcaliBrain;

  const suggester = new JevLinkSuggest(plugin);
  return {
    plugin,
    vault,
    suggester,
    file: (path: string) => files.get(path),
    /** Tells the suggester another note was opened, as Obsidian's `file-open` would. */
    open: (path: string | null) => { opened.forEach((callback) => { callback(path ? files.get(path) : null); }); },
  };
}

/** The editor members `onTrigger` reads: the line under the cursor, the buffer and the offset. */
function editorFor(text: string): Editor {
  const lines = text.split('\n');
  return {
    getLine: (line: number) => lines[line] ?? '',
    getValue: () => text,
    posToOffset: ({ line, ch }: EditorPosition) =>
      lines.slice(0, line).reduce((sum, own) => sum + own.length + 1, 0) + ch,
  } as unknown as Editor;
}

/** The cursor at the end of a line, which is where `]]` has just been closed. */
const endOf = (editor: Editor, line: number): EditorPosition => ({ line, ch: editor.getLine(line).length });

const contextOf = (info: EditorSuggestTriggerInfo, editor: Editor, file: TFile): EditorSuggestContext =>
  ({ ...info, editor, file });

/** Lets the pending `askJev` (and the writes of a confirmation) settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** `[[B]]` written at the end of the only line of `A.md`, with `B.md` in the vault. */
const TWO_NOTES: Record<string, Note> = {
  'A.md': { content: '習慣はトリガー固定で続く。関連: [[B]]' },
  'B.md': { content: '# B\n行動デザインの話。' },
};

describe('JevLinkSuggest.onTrigger', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    requestUrlMock.reset();
    requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-200.json'));
    Notice.messages = [];
  });

  it('fires on the link the cursor just closed and asks Jev once', async () => {
    const { suggester, file } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    const cursor = endOf(editor, 0);

    const info = suggester.onTrigger(cursor, editor, file('A.md'));
    expect(info).toEqual({ start: { line: 0, ch: 17 }, end: cursor, query: 'B' });
    // The popup opens on the placeholder: the answer is still on its way.
    expect(suggester.getSuggestions(contextOf(info, editor, file('A.md')))).toEqual([{ kind: 'asking' }]);
    await flush();
    expect(requestUrlMock.calls).toHaveLength(1);
  });

  it('sends the note around the link and the target note, and nothing else (設計 §2-2)', async () => {
    const { suggester, file } = setup({
      ...TWO_NOTES,
      'A.md': { ...TWO_NOTES['A.md'], frontmatter: { tags: ['習慣'] } },
    });
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    suggester.onTrigger(endOf(editor, 0), editor, file('A.md'));
    await flush();

    const sent = JSON.parse(requestUrlMock.calls[0].body ?? '{}') as {
      state: string;
      questions: Record<string, { criteria: Record<string, string> }>;
    };
    expect(JSON.parse(sent.state)).toEqual({
      note: { frontmatter: { tags: ['習慣'] }, context: TWO_NOTES['A.md'].content },
      target: { name: 'B', frontmatter: null, excerpt: TWO_NOTES['B.md'].content },
    });
    expect(Object.keys(sent.questions)).toEqual(['field', 'direction']);
    expect(Object.keys(sent.questions.field.criteria)).toEqual(SETTINGS_ORDER);
  });

  it('stays out of the way when the setting is off', () => {
    const { suggester, file } = setup(TWO_NOTES, { jev: { suggestOnLinkClose: false } });
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    expect(suggester.onTrigger(endOf(editor, 0), editor, file('A.md'))).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(0);
  });

  it('needs the cursor right after the closing `]]`', () => {
    const content = '関連: [[B]] を読む。';
    const { suggester, file } = setup({ ...TWO_NOTES, 'A.md': { content } });
    const editor = editorFor(content);
    expect(suggester.onTrigger({ line: 0, ch: content.length }, editor, file('A.md'))).toBeNull();
    expect(suggester.onTrigger({ line: 0, ch: 8 }, editor, file('A.md'))).toBeNull(); // 「[[B]」まで
    expect(suggester.onTrigger({ line: 0, ch: 9 }, editor, file('A.md'))).not.toBeNull();
  });

  it('leaves out an embed, a heading link of the note itself and a line that already writes a field', () => {
    const notes = {
      'B.md': {},
      'A.md': { content: '![[B]]\n[[#見出し]]\nup:: [[B]]\n本文 (similar:: [[B]]' },
    };
    const { suggester, file } = setup(notes);
    const editor = editorFor(notes['A.md'].content);
    for (const line of [0, 1, 2, 3]) {
      expect(suggester.onTrigger(endOf(editor, line), editor, file('A.md'))).toBeNull();
    }
  });

  it('leaves out a target that either note already types, including through a hidden field', () => {
    const content = '[[B]] と [[C]] と [[D]]';
    const notes: Record<string, Note> = {
      'A.md': { content, fields: { origin: { path: 'B.md' }, ignore: { path: 'D.md' } } },
      'B.md': {},
      // C types the pair from its own side: there is nothing left to ask (設計 §2-1).
      'C.md': { fields: { similar: { path: 'A.md' } } },
      'D.md': {},
    };
    const { suggester, file } = setup(notes);
    const editor = editorFor(content);
    for (const ch of [5, 13, 21]) {
      expect(suggester.onTrigger({ line: 0, ch }, editor, file('A.md'))).toBeNull();
    }
    expect(requestUrlMock.calls).toHaveLength(0);
  });

  it('leaves out the note itself, the brain drawing and an excluded path', () => {
    const content = '[[A]]\n[[excalibrain]]\n[[アーカイブ/C]]';
    const notes: Record<string, Note> = {
      'A.md': { content }, 'excalibrain.md': {}, 'アーカイブ/C.md': {},
    };
    const { suggester, file } = setup(notes, { excludeFilepaths: ['アーカイブ/'] });
    const editor = editorFor(content);
    for (const line of [0, 1, 2]) {
      expect(suggester.onTrigger(endOf(editor, line), editor, file('A.md'))).toBeNull();
    }
  });

  it('offers a link whose note does not exist yet, keyed by the link text', async () => {
    const content = '[[まだ無いノート]]';
    const { suggester, file } = setup({ 'A.md': { content } });
    const editor = editorFor(content);
    expect(suggester.onTrigger(endOf(editor, 0), editor, file('A.md'))).not.toBeNull();
    await flush();
    const sent = JSON.parse(requestUrlMock.calls[0].body ?? '{}') as { state: string };
    expect(JSON.parse(sent.state)).toMatchObject({ target: { name: 'まだ無いノート' } });
  });

  it('asks about the same link once a session, but keeps answering while the popup is on it', async () => {
    const content = '[[B]] と、もう一度 [[B]]';
    const { suggester, file } = setup({ ...TWO_NOTES, 'A.md': { content } });
    const editor = editorFor(content);

    const first = suggester.onTrigger({ line: 0, ch: 5 }, editor, file('A.md'));
    expect(first).not.toBeNull();
    await flush();
    // The redraw that follows the answer runs onTrigger again: the link on show is let through.
    expect(suggester.onTrigger({ line: 0, ch: 5 }, editor, file('A.md'))).toEqual(first);
    // The second occurrence is the same target, so it is not asked again.
    expect(suggester.onTrigger({ line: 0, ch: content.length }, editor, file('A.md'))).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
  });

  it('forgets a note once another one is opened (設計 §4-1)', async () => {
    const { suggester, file, open } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    const cursor = endOf(editor, 0);
    suggester.onTrigger(cursor, editor, file('A.md'));
    await flush();
    expect(suggester.onTrigger(cursor, editor, file('A.md'))).not.toBeNull();

    open('B.md');
    expect(suggester.onTrigger(cursor, editor, file('A.md'))).not.toBeNull();
    await flush();
    expect(requestUrlMock.calls).toHaveLength(2);
  });
});

describe('JevLinkSuggest.getSuggestions', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    requestUrlMock.reset();
    Notice.messages = [];
  });

  /** Triggers on `[[B]]` of `A.md` and waits for the recorded reply. */
  async function answered(reply: string, options?: { ontology?: Partial<Hierarchy> }) {
    requestUrlMock.respond = () => Promise.resolve(recorded(reply));
    const harness = setup(TWO_NOTES, options);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    const file = harness.file('A.md');
    const info = harness.suggester.onTrigger(endOf(editor, 0), editor, file);
    await flush();
    return { ...harness, suggestions: harness.suggester.getSuggestions(contextOf(info, editor, file)) };
  }

  it('lists every field by probability when Q1 and Q2 agree (自信あり)', async () => {
    const { suggestions } = await answered('two-choice-200.json');
    expect(suggestions).toEqual([
      { kind: 'candidate', field: 'up', probability: 0.82, direction: 'parent', confident: true },
      { kind: 'candidate', field: 'origin', probability: 0.11, direction: 'parent', confident: true },
      { kind: 'candidate', field: 'similar', probability: 0.04, direction: 'leftFriend', confident: true },
      { kind: 'candidate', field: 'down', probability: 0.03, direction: 'child', confident: true },
      { kind: 'candidate', field: 'steps', probability: undefined, direction: 'child', confident: true },
      { kind: 'candidate', field: 'opposes', probability: undefined, direction: 'rightFriend', confident: true },
      { kind: 'candidate', field: 'before', probability: undefined, direction: 'previous', confident: true },
      { kind: 'candidate', field: 'after', probability: undefined, direction: 'next', confident: true },
    ]);
  });

  it('hides the probabilities and keeps the settings order when they disagree (自信なし)', async () => {
    const { suggestions } = await answered('field-direction-mismatch-200.json');
    expect(suggestions.map((suggestion) => suggestion.kind === 'candidate' && suggestion.field))
      .toEqual(SETTINGS_ORDER);
    expect(suggestions.every((suggestion) =>
      suggestion.kind === 'candidate' && suggestion.probability === undefined && !suggestion.confident)).toBe(true);
  });

  it('closes the popup when the request fails (client.ts has already said so)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { suggestions } = await answered('unauthorized-401.json');
    expect(suggestions).toEqual([]);
    expect(Notice.messages).toEqual(['Jev request failed. See the developer console for details.']);
  });

  it('redraws through the trigger of EditorSuggest, dropping the context first', async () => {
    requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-200.json'));
    const { suggester, file } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    const info = suggester.onTrigger(endOf(editor, 0), editor, file('A.md'));
    const context = contextOf(info, editor, file('A.md'));
    suggester.context = context;

    // Obsidian's own `trigger` is not in obsidian.d.ts; this stands in for it.
    const calls: { manual: boolean; context: unknown }[] = [];
    (suggester as unknown as { trigger: (editor: Editor, file: TFile, manual: boolean) => void }).trigger =
      (_editor, _file, manual) => { calls.push({ manual, context: suggester.context }); };

    await flush();
    expect(calls).toEqual([{ manual: true, context: null }]);
    expect(suggester.getSuggestions(context)[0]).toMatchObject({ field: 'up', probability: 0.82 });
  });
});

describe('JevLinkSuggest.selectSuggestion', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    requestUrlMock.reset();
    requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-200.json'));
    Notice.messages = [];
  });

  it('appends the field to the Relations section and records it so it can be undone', async () => {
    const { suggester, vault, file } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    suggester.onTrigger(endOf(editor, 0), editor, file('A.md'));
    await flush();

    suggester.selectSuggestion({ kind: 'candidate', field: 'up', probability: 0.82, direction: 'parent', confident: true });
    await flush();

    expect(vault.notes.get('A.md')).toBe(`${TWO_NOTES['A.md'].content ?? ''}\n\n## Relations\nup:: [[B]]`);
    const log = JSON.parse(vault.dataFiles.get(`${MANIFEST_DIR}/jev-log.json`) ?? '[]') as { source: string; file: string; after: string }[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ source: 'suggest', file: 'A.md', line: 1, after: '\n## Relations\nup:: [[B]]' });
    expect(Notice.messages).toEqual(['Jev: added up:: [[B]]']);
  });

  it('stops offering the link it has just written', async () => {
    const { suggester, file } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    const cursor = endOf(editor, 0);
    suggester.onTrigger(cursor, editor, file('A.md'));
    await flush();

    suggester.selectSuggestion({ kind: 'candidate', field: 'up', probability: 0.82, direction: 'parent', confident: true });
    await flush();
    expect(suggester.onTrigger(cursor, editor, file('A.md'))).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
  });

  it('writes nothing for the placeholder row', async () => {
    const { suggester, vault, file } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    suggester.onTrigger(endOf(editor, 0), editor, file('A.md'));

    suggester.selectSuggestion({ kind: 'asking' });
    await flush();
    expect(vault.notes.get('A.md')).toBe(TWO_NOTES['A.md'].content);
    expect(vault.dataFiles.size).toBe(0);
  });
});

describe('JevLinkSuggest.openAt', () => {
  it('re-enters onTrigger for the hotkey of LEV-172', () => {
    const { suggester, file } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');
    const calls: boolean[] = [];
    (suggester as unknown as { trigger: (editor: Editor, file: TFile, manual: boolean) => void }).trigger =
      (_editor, _file, manual) => { calls.push(manual); };

    suggester.openAt(editor, file('A.md'));
    expect(calls).toEqual([true]);
  });
});

describe('JevLinkSuggest.renderSuggestion', () => {
  /** The two members of an Obsidian element that a suggestion row uses. */
  class ElementStub {
    readonly parts: { tag: string; text: string }[] = [];
    createEl(tag: string, options: { text?: string }): ElementStub {
      this.parts.push({ tag, text: options.text ?? '' });
      return this;
    }
    createSpan(options: { text?: string }): ElementStub {
      return this.createEl('span', options);
    }
  }

  const render = (suggestion: JevSuggestion): { tag: string; text: string }[] => {
    const el = new ElementStub();
    const { suggester } = setup(TWO_NOTES);
    suggester.renderSuggestion(suggestion, el as unknown as HTMLElement);
    return el.parts;
  };

  it('writes the field, its probability and its direction', () => {
    expect(render({ kind: 'candidate', field: 'up', probability: 0.82, direction: 'parent', confident: true }))
      .toEqual([{ tag: 'code', text: 'up' }, { tag: 'span', text: ' 82% · parent' }]);
  });

  it('says so instead of showing a probability when Jev is not confident', () => {
    expect(render({ kind: 'candidate', field: 'up', direction: 'parent', confident: false }))
      .toEqual([{ tag: 'code', text: 'up' }, { tag: 'span', text: ' parent · Jev is not confident' }]);
  });

  it('shows one line while the answer is on its way', () => {
    expect(render({ kind: 'asking' })).toEqual([{ tag: 'span', text: 'Jev is answering…' }]);
  });
});
