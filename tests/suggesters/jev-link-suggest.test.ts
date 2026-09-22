import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TFile } from 'obsidian';
import type { MarkdownView } from 'obsidian';
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
  // The open editor of `A.md`: a confirmation flushes its buffer before writing to the file.
  const saves: string[] = [];
  const view = {
    file: files.get('A.md'),
    save: (): Promise<void> => {
      saves.push(vault.notes.get('A.md') ?? '');
      return Promise.resolve();
    },
  } as unknown as MarkdownView;

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
        getActiveViewOfType: () => view,
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
    /** What `A.md` held each time its editor was asked to save. */
    saves,
    file: (path: string) => files.get(path),
    /** Tells the suggester another note was opened, as Obsidian's `file-open` would. */
    open: (path: string | null) => { opened.forEach((callback) => { callback(path ? files.get(path) : null); }); },
  };
}

/** The editor members `onTrigger` reads: the lines, the buffer and the offset of a position. */
function editorFor(text: string): Editor {
  const lines = text.split('\n');
  return {
    getLine: (line: number) => lines[line] ?? '',
    lastLine: () => lines.length - 1,
    getValue: () => text,
    posToOffset: ({ line, ch }: EditorPosition) =>
      lines.slice(0, line).reduce((sum, own) => sum + own.length + 1, 0) + ch,
  } as unknown as Editor;
}

/** The cursor at the end of a line, which is where `]]` has just been closed. */
const endOf = (text: string, line = 0): EditorPosition => ({ line, ch: text.split('\n')[line].length });

/**
 * The keystroke that closes a link. `onTrigger` runs on every key and on every caret move and only
 * asks when the line changed since the call before, so a test has to play the key before it too.
 */
function typeClosing(suggester: JevLinkSuggest, file: TFile, text: string, cursor: EditorPosition) {
  const lines = text.split('\n');
  const before = [...lines];
  before[cursor.line] = lines[cursor.line].slice(0, cursor.ch - 1) + lines[cursor.line].slice(cursor.ch);
  suggester.onTrigger({ ...cursor, ch: cursor.ch - 1 }, editorFor(before.join('\n')), file);
  const editor = editorFor(text);
  return { editor, info: suggester.onTrigger(cursor, editor, file) };
}

const contextOf = (info: EditorSuggestTriggerInfo, editor: Editor, file: TFile): EditorSuggestContext =>
  ({ ...info, editor, file });

/** Lets the pending `askJev` (and the writes of a confirmation) settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** `[[B]]` written at the end of the only line of `A.md`, with `B.md` in the vault. */
const TWO_NOTES: Record<string, Note> = {
  'A.md': { content: '習慣はトリガー固定で続く。関連: [[B]]' },
  'B.md': { content: '# B\n行動デザインの話。' },
};

const CURSOR = endOf(TWO_NOTES['A.md'].content ?? '');

beforeEach(() => {
  // `client.ts` races the request against `window.setTimeout`; this suite runs on the node environment.
  vi.stubGlobal('window', globalThis);
  requestUrlMock.reset();
  // 既定は整合する応答。実機 E18 の記録（two-choice-200.json）は Q1 と Q2 が食い違う組み合わせなので、
  // それを測るテストだけが名前で指す。
  requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-agree-200.json'));
  Notice.messages = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JevLinkSuggest.onTrigger', () => {
  it('fires on the link the cursor just closed and asks Jev once', async () => {
    const { suggester, file } = setup(TWO_NOTES);
    const { editor, info } = typeClosing(suggester, file('A.md'), TWO_NOTES['A.md'].content ?? '', CURSOR);

    expect(info).toEqual({ start: { line: 0, ch: 17 }, end: CURSOR, query: 'B' });
    // The popup opens on the placeholder: the answer is still on its way.
    expect(suggester.getSuggestions(contextOf(info, editor, file('A.md')))).toEqual([{ kind: 'asking' }]);
    await flush();
    expect(requestUrlMock.calls).toHaveLength(1);
  });

  it('sends the note around the link and the target note, and nothing else (設計 §2-2)', async () => {
    const content = TWO_NOTES['A.md'].content ?? '';
    const { suggester, file } = setup({ ...TWO_NOTES, 'A.md': { content, frontmatter: { tags: ['習慣'] } } });
    typeClosing(suggester, file('A.md'), content, CURSOR);
    await flush();

    const sent = JSON.parse(requestUrlMock.calls[0].body ?? '{}') as {
      state: string;
      questions: Record<string, { criteria: Record<string, string> }>;
    };
    expect(JSON.parse(sent.state)).toEqual({
      note: { frontmatter: { tags: ['習慣'] }, context: content },
      target: { name: 'B', frontmatter: null, excerpt: TWO_NOTES['B.md'].content },
    });
    expect(Object.keys(sent.questions)).toEqual(['field', 'direction']);
    expect(Object.keys(sent.questions.field.criteria)).toEqual(SETTINGS_ORDER);
  });

  it('stays out of the way when the setting is off, and when the key is gone', () => {
    const content = TWO_NOTES['A.md'].content ?? '';
    const off = setup(TWO_NOTES, { jev: { suggestOnLinkClose: false } });
    expect(typeClosing(off.suggester, off.file('A.md'), content, CURSOR).info).toBeNull();

    // Registration happens once at load, so a key emptied mid-session has to be caught here.
    const keyless = setup(TWO_NOTES, { jev: { apiKey: '  ' } });
    expect(typeClosing(keyless.suggester, keyless.file('A.md'), content, CURSOR).info).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(0);
  });

  it('needs the cursor right after the closing `]]`', () => {
    const content = '関連: [[B]] を読む。';
    const { suggester, file } = setup({ ...TWO_NOTES, 'A.md': { content } });
    expect(typeClosing(suggester, file('A.md'), content, { line: 0, ch: content.length }).info).toBeNull();
    expect(typeClosing(suggester, file('A.md'), content, { line: 0, ch: 8 }).info).toBeNull(); // 「[[B]」まで
    expect(typeClosing(suggester, file('A.md'), content, { line: 0, ch: 9 }).info).not.toBeNull();
  });

  it('does not ask when the caret is only put behind a link that was closed earlier', async () => {
    const { suggester, file } = setup(TWO_NOTES);
    const editor = editorFor(TWO_NOTES['A.md'].content ?? '');

    // Clicking at the end of the line, or coming back to it: the line did not change.
    expect(suggester.onTrigger(CURSOR, editor, file('A.md'))).toBeNull();
    expect(suggester.onTrigger(CURSOR, editor, file('A.md'))).toBeNull();
    await flush();
    expect(requestUrlMock.calls).toHaveLength(0);
  });

  it('leaves out an embed, a heading link of the note itself and a line that already writes a field', () => {
    const content = '![[B]]\n[[#見出し]]\nup:: [[B]]\n本文 (similar:: [[B]]';
    const { suggester, file } = setup({ 'B.md': {}, 'A.md': { content } });
    for (const line of [0, 1, 2, 3]) {
      expect(typeClosing(suggester, file('A.md'), content, endOf(content, line)).info).toBeNull();
    }
  });

  it('leaves out frontmatter and fenced code, which Obsidian does not count as links either', async () => {
    // Every one of these lines ends in `]]`, so only the frontmatter and the fence keep them out.
    const content = ['---', 'related: [[B]]', '---', '', '```md', 'see [[B]]', '```', '', '本文 [[B]]'].join('\n');
    const { suggester, file } = setup({ 'B.md': {}, 'A.md': { content } });
    expect(typeClosing(suggester, file('A.md'), content, endOf(content, 1)).info).toBeNull();
    expect(typeClosing(suggester, file('A.md'), content, endOf(content, 5)).info).toBeNull();
    expect(typeClosing(suggester, file('A.md'), content, endOf(content, 8)).info).not.toBeNull();
    await flush();
    expect(requestUrlMock.calls).toHaveLength(1);
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
    for (const ch of [5, 13, 21]) {
      expect(typeClosing(suggester, file('A.md'), content, { line: 0, ch }).info).toBeNull();
    }
    expect(requestUrlMock.calls).toHaveLength(0);
  });

  it('leaves out the note itself, the brain drawing and an excluded path', () => {
    const content = '[[A]]\n[[excalibrain]]\n[[アーカイブ/C]]';
    const notes: Record<string, Note> = { 'A.md': { content }, 'excalibrain.md': {}, 'アーカイブ/C.md': {} };
    const { suggester, file } = setup(notes, { excludeFilepaths: ['アーカイブ/'] });
    for (const line of [0, 1, 2]) {
      expect(typeClosing(suggester, file('A.md'), content, endOf(content, line)).info).toBeNull();
    }
  });

  it('offers a link whose note does not exist yet, keyed by the link text', async () => {
    const content = '[[まだ無いノート]]';
    const { suggester, file } = setup({ 'A.md': { content } });
    expect(typeClosing(suggester, file('A.md'), content, endOf(content)).info).not.toBeNull();
    await flush();
    const sent = JSON.parse(requestUrlMock.calls[0].body ?? '{}') as { state: string };
    expect(JSON.parse(sent.state)).toMatchObject({ target: { name: 'まだ無いノート' } });
  });

  it('asks about the same link once a session, but keeps answering while the popup is on it', async () => {
    const content = '[[B]] と、もう一度 [[B]]';
    const { suggester, file } = setup({ ...TWO_NOTES, 'A.md': { content } });
    const { editor, info: first } = typeClosing(suggester, file('A.md'), content, { line: 0, ch: 5 });
    expect(first).not.toBeNull();
    await flush();

    // The redraw that follows the answer runs onTrigger again: the link on show is let through.
    expect(suggester.onTrigger({ line: 0, ch: 5 }, editor, file('A.md'))).toEqual(first);
    // The second occurrence is the same target, so it is not asked again.
    expect(typeClosing(suggester, file('A.md'), content, endOf(content)).info).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
  });

  it('forgets a note once another one is opened (設計 §4-1)', async () => {
    const content = TWO_NOTES['A.md'].content ?? '';
    const { suggester, file, open } = setup(TWO_NOTES);
    typeClosing(suggester, file('A.md'), content, CURSOR);
    await flush();

    open('B.md');
    expect(typeClosing(suggester, file('A.md'), content, CURSOR).info).not.toBeNull();
    await flush();
    expect(requestUrlMock.calls).toHaveLength(2);
  });
});

describe('JevLinkSuggest.getSuggestions', () => {
  /** Closes `[[B]]` in `A.md` and waits for the recorded reply. */
  async function answered(reply: string) {
    requestUrlMock.respond = () => Promise.resolve(recorded(reply));
    const harness = setup(TWO_NOTES);
    const file = harness.file('A.md');
    const { editor, info } = typeClosing(harness.suggester, file, TWO_NOTES['A.md'].content ?? '', CURSOR);
    await flush();
    return { ...harness, suggestions: harness.suggester.getSuggestions(contextOf(info, editor, file)) };
  }

  it('lists the answered fields by probability when Q1 and Q2 agree (自信あり)', async () => {
    const { suggestions } = await answered('two-choice-agree-200.json');
    // 応答が確率を返した 4 件だけ。確率の無いオントロジーの残り（steps・opposes・before・after）は出ない。
    expect(suggestions).toEqual([
      { kind: 'candidate', field: 'up', probability: 0.82, direction: 'parent', confident: true },
      { kind: 'candidate', field: 'origin', probability: 0.11, direction: 'parent', confident: true },
      { kind: 'candidate', field: 'similar', probability: 0.04, direction: 'leftFriend', confident: true },
      { kind: 'candidate', field: 'down', probability: 0.03, direction: 'child', confident: true },
    ]);
  });

  it('keeps the same order and the same probabilities when they disagree (自信なし、LEV-187)', async () => {
    // 実機 E18 で記録した応答そのもの: Q1 が up（親の領域）なのに Q2 が child。
    const { suggestions } = await answered('two-choice-200.json');
    // 応答の確率は up 0.39・down 0.3・similar 0.17・next 0.14（`next` はこのオントロジーの
    // フィールド名ではない＝出さない）。自信なしでも並びは確率順のまま。
    expect(suggestions).toEqual([
      { kind: 'candidate', field: 'up', probability: 0.39, direction: 'parent', confident: false },
      { kind: 'candidate', field: 'down', probability: 0.3, direction: 'child', confident: false },
      { kind: 'candidate', field: 'similar', probability: 0.17, direction: 'leftFriend', confident: false },
    ]);
  });

  it('shows five candidates at most (LEV-187)', async () => {
    // オントロジーの 8 フィールドのうち 7 つに確率が返った応答（after は 0.4%、opposes は確率なし）。
    const { suggestions } = await answered('eight-candidates-200.json');

    expect(suggestions.map((suggestion) => suggestion.kind === 'candidate' && suggestion.field))
      .toEqual(['up', 'down', 'origin', 'steps', 'similar']);
  });

  it('lets a link whose answer left no candidate be asked again (LEV-187)', async () => {
    // オントロジーのどのフィールドにも確率が付かなかった応答。出すものが無いので黙って閉じるが、
    // 「もう聞いた」に数えると、このセッション中は二度と出せなくなる。
    const content = '[[B]]\nもう一度 [[B]]';
    requestUrlMock.respond = () => Promise.resolve(recorded('unknown-fields-200.json'));
    const { suggester, file } = setup({ ...TWO_NOTES, 'A.md': { content } });
    const first = typeClosing(suggester, file('A.md'), content, endOf(content, 0));
    await flush();

    expect(suggester.getSuggestions(contextOf(first.info, first.editor, file('A.md')))).toEqual([]);
    expect(typeClosing(suggester, file('A.md'), content, endOf(content, 1)).info).not.toBeNull();
    await flush();
    expect(requestUrlMock.calls).toHaveLength(2);
  });

  it('closes the popup when the request fails (client.ts has already said so)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { suggestions } = await answered('unauthorized-401.json');
    expect(suggestions).toEqual([]);
    expect(Notice.messages).toEqual(['Jev request failed. See the developer console for details.']);
  });

  it('lets a link it could not ask about be asked again later', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const content = '[[B]]\nもう一度 [[B]]';
    requestUrlMock.respond = () => Promise.resolve(recorded('unauthorized-401.json'));
    const { suggester, file } = setup({ ...TWO_NOTES, 'A.md': { content } });
    typeClosing(suggester, file('A.md'), content, endOf(content, 0));
    await flush();

    // A failed ask does not count as asked, so writing the link again asks once more.
    requestUrlMock.respond = () => Promise.resolve(recorded('two-choice-agree-200.json'));
    expect(typeClosing(suggester, file('A.md'), content, endOf(content, 1)).info).not.toBeNull();
    await flush();
    expect(requestUrlMock.calls).toHaveLength(2);
  });

  it('redraws through the trigger of EditorSuggest, dropping the context first', async () => {
    const { suggester, file } = setup(TWO_NOTES);
    const { editor, info } = typeClosing(suggester, file('A.md'), TWO_NOTES['A.md'].content ?? '', CURSOR);
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
  const UP: JevSuggestion = { kind: 'candidate', field: 'up', probability: 0.82, direction: 'parent', confident: true };

  it('types the link it was opened on and records it so it can be undone', async () => {
    const { suggester, vault, file } = setup(TWO_NOTES);
    typeClosing(suggester, file('A.md'), TWO_NOTES['A.md'].content ?? '', CURSOR);
    await flush();

    suggester.selectSuggestion(UP);
    await flush();

    // 既定はインライン（LEV-185）。文中のリンクなので括弧付きで、`## Relations` は増えない。
    expect(vault.notes.get('A.md')).toBe('習慣はトリガー固定で続く。関連: (up:: [[B]])');
    const log = JSON.parse(vault.dataFiles.get(`${MANIFEST_DIR}/jev-log.json`) ?? '[]') as { source: string; file: string; after: string }[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      source: 'suggest',
      file: 'A.md',
      line: 0,
      before: '習慣はトリガー固定で続く。関連: [[B]]',
      after: '習慣はトリガー固定で続く。関連: (up:: [[B]])',
    });
    expect(Notice.messages).toEqual(['Jev: added up:: [[B]]']);
  });

  it('types the occurrence it was opened on, not the first one to the same note (LEV-185)', async () => {
    const content = '[[B]] の話。もう一度 [[B]]';
    const { suggester, vault, file } = setup({ ...TWO_NOTES, 'A.md': { content } });
    typeClosing(suggester, file('A.md'), content, endOf(content));
    await flush();

    suggester.selectSuggestion(UP);
    await flush();

    expect(vault.notes.get('A.md')).toBe('[[B]] の話。もう一度 (up:: [[B]])');
  });

  it('appends to the Relations section when the settings choose it', async () => {
    const { suggester, vault, file } = setup(TWO_NOTES, { jev: { writeMode: 'relations' } });
    typeClosing(suggester, file('A.md'), TWO_NOTES['A.md'].content ?? '', CURSOR);
    await flush();

    suggester.selectSuggestion(UP);
    await flush();

    expect(vault.notes.get('A.md')).toBe(`${TWO_NOTES['A.md'].content ?? ''}\n\n## Relations\nup:: [[B]]`);
  });

  it('writes nothing and says so when the link moved away while Jev was answering', async () => {
    const { suggester, vault, file } = setup(TWO_NOTES);
    typeClosing(suggester, file('A.md'), TWO_NOTES['A.md'].content ?? '', CURSOR);
    await flush();
    // 判定を待つ間に本文が書き換わり、閉じた `]]` の位置にはもうリンクが無い。
    vault.notes.set('A.md', '別の文。');

    suggester.selectSuggestion(UP);
    await flush();

    expect(vault.notes.get('A.md')).toBe('別の文。');
    expect(vault.dataFiles.size).toBe(0);
    expect(Notice.messages).toEqual(['Jev did not write up:: [[B]]: the link is no longer where it was closed.']);
  });

  it('flushes the editor buffer before it writes, so the next autosave keeps the line', async () => {
    const content = TWO_NOTES['A.md'].content ?? '';
    const { suggester, vault, file, saves } = setup(TWO_NOTES);
    typeClosing(suggester, file('A.md'), content, CURSOR);
    await flush();

    suggester.selectSuggestion(UP);
    await flush();

    // Saved once, and before the field was written: `vault.process` reads the file, not the buffer.
    expect(saves).toEqual([content]);
    expect(vault.notes.get('A.md')).toContain('(up:: [[B]])');
  });

  it('says so when the line was written but could not be recorded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { suggester, vault, file } = setup(TWO_NOTES);
    vault.adapter.write = () => Promise.reject(new Error('no such folder'));
    typeClosing(suggester, file('A.md'), TWO_NOTES['A.md'].content ?? '', CURSOR);
    await flush();

    suggester.selectSuggestion(UP);
    await flush();

    expect(vault.notes.get('A.md')).toContain('up:: [[B]]');
    expect(Notice.messages).toEqual(['Jev: added up:: [[B]], but it was not recorded and cannot be undone.']);
  });

  it('stops offering the link it has just written', async () => {
    const content = TWO_NOTES['A.md'].content ?? '';
    const { suggester, file } = setup(TWO_NOTES);
    typeClosing(suggester, file('A.md'), content, CURSOR);
    await flush();

    suggester.selectSuggestion(UP);
    await flush();
    expect(typeClosing(suggester, file('A.md'), content, CURSOR).info).toBeNull();
    expect(requestUrlMock.calls).toHaveLength(1);
  });

  it('writes nothing for the placeholder row', async () => {
    const { suggester, vault, file } = setup(TWO_NOTES);
    typeClosing(suggester, file('A.md'), TWO_NOTES['A.md'].content ?? '', CURSOR);

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

  it('keeps the probability and adds the note when Jev is not confident (LEV-187)', () => {
    expect(render({ kind: 'candidate', field: 'up', probability: 0.39, direction: 'parent', confident: false }))
      .toEqual([{ tag: 'code', text: 'up' }, { tag: 'span', text: ' 39% · parent · Jev is not confident' }]);
  });

  it('writes no percentage for a candidate the answer gave no probability', () => {
    expect(render({ kind: 'candidate', field: 'up', direction: 'parent', confident: true }))
      .toEqual([{ tag: 'code', text: 'up' }, { tag: 'span', text: ' parent' }]);
  });

  it('shows one line while the answer is on its way', () => {
    expect(render({ kind: 'asking' })).toEqual([{ tag: 'span', text: 'Jev is answering…' }]);
  });
});
