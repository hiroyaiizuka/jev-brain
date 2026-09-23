/**
 * The few runtime members of the `obsidian` module that the unit-tested code touches.
 * Vitest aliases `obsidian` to this file (vitest.config.ts); everything else in the real
 * module is type-only for the tested code, so esbuild drops those imports before they run.
 */
export class TFile {
  path = '';
  get name(): string { return this.path.split('/').pop() ?? ''; }
  get basename(): string { return this.name.replace(/\.[^.]+$/u, ''); }
  get extension(): string { return this.name.includes('.') ? this.name.split('.').pop() ?? '' : ''; }
}

export class TFolder {
  path = '';
  children: (TFile | TFolder)[] = [];
  get name(): string { return this.path.split('/').pop() ?? ''; }
  isRoot(): boolean { return this.path === '/'; }
}

export type TAbstractFile = TFile | TFolder;

/**
 * Obsidian's rules: forward slashes, no run of slashes, none leading or trailing,
 * the empty result is the root `/`. Nothing else: `.` and `..` segments stay.
 */
export function normalizePath(path: string): string {
  const normalized = path.replace(/[\\/]+/gu, '/').replace(/^\/+|\/+$/gu, '');
  return normalized === '' ? '/' : normalized;
}

export class Vault {
  static recurseChildren(folder: TFolder, callback: (file: TAbstractFile) => void): void {
    for (const child of folder.children) {
      callback(child);
      if (child instanceof TFolder) Vault.recurseChildren(child, callback);
    }
  }
}

export class Notice {
  static messages: string[] = [];
  constructor(message: string) { Notice.messages.push(message); }
}

/** `moment.locale()` is all `src/lang/helpers.ts` reads at import time. */
export const moment = Object.assign(
  (): { format(): string } => ({ format: () => '' }),
  { locale: (): string => 'en' },
);

/** The surface of an Obsidian element that `AddToOntologyModal.open()` touches: title text, a paragraph and a class. */
export class ElementStub {
  text = '';
  classes: string[] = [];
  children: ElementStub[] = [];
  setText(text: string): void { this.text = text; }
  createEl(_tag: string, options?: { text?: string }): ElementStub {
    const el = new ElementStub();
    el.text = options?.text ?? '';
    this.children.push(el);
    return el;
  }
  addClass(cls: string): void { this.classes.push(cls); }
  empty(): void { this.children = []; }
}

/** Enough of `Modal` for `AddToOntologyModal`: it only sets the title, adds content and closes itself. */
export class Modal {
  app: unknown;
  contentEl = new ElementStub();
  titleEl = new ElementStub();
  constructor(app: unknown) { this.app = app; }
  open(): void {}
  close(): void {}
}

export class ButtonStub {
  text = '';
  cta = false;
  handler: () => void = () => {};
  setButtonText(text: string): this { this.text = text; return this; }
  setCta(): this { this.cta = true; return this; }
  onClick(handler: () => void): this { this.handler = handler; return this; }
}

/** `Setting` as the ontology modal uses it: a row of buttons. Instances are kept so a test can read the buttons back. */
export class Setting {
  static created: Setting[] = [];
  buttons: ButtonStub[] = [];
  settingEl = new ElementStub();
  constructor() { Setting.created.push(this); }
  addButton(configure: (button: ButtonStub) => void): this {
    const button = new ButtonStub();
    configure(button);
    this.buttons.push(button);
    return this;
  }
}

/** `EditorSuggest` as `FieldSuggester` needs it at construction time; the generic and the tested members are the suggester's own. */
export class EditorSuggest {
  app: unknown;
  context: { query: string } | null = null;
  constructor(app: unknown) { this.app = app; }
}

// ---- LEV-165 ----
/** `ExcaliBrainSettingTab extends PluginSettingTab`, so the class has to exist to import `src/Settings` at all. */
export class PluginSettingTab {
  app: unknown;
  containerEl = new ElementStub();
  constructor(app: unknown) { this.app = app; }
}

// ---- LEV-166 ----

/** The request `src/jev/client.ts` builds, not the whole `RequestUrlParam`. */
export interface RequestUrlCall {
  url: string;
  method?: string;
  contentType?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

/** The two fields of `RequestUrlResponse` that the Jev client reads. */
export interface RequestUrlReply {
  status: number;
  text: string;
}

const noReply = (): Promise<RequestUrlReply> =>
  Promise.reject(new Error('requestUrl stub: set requestUrlMock.respond first'));

/**
 * `requestUrl` for the Jev client tests: a test sets `respond` (it gets the call index, so a retry
 * can answer differently) and reads `calls` back. The replies come from `tests/fixtures/jev/`.
 */
export const requestUrlMock: {
  calls: RequestUrlCall[];
  respond: (call: RequestUrlCall, index: number) => Promise<RequestUrlReply>;
  reset(): void;
} = {
  calls: [],
  respond: () => noReply(),
  reset(): void {
    requestUrlMock.calls = [];
    requestUrlMock.respond = () => noReply();
  },
};

export function requestUrl(call: RequestUrlCall): Promise<RequestUrlReply> {
  const index = requestUrlMock.calls.length;
  requestUrlMock.calls.push(call);
  return requestUrlMock.respond(call, index);
}

// ---- LEV-169 ----

/**
 * The vault surface `src/jev/relations.ts` and `src/jev/log.ts` touch: atomic note edits through
 * `process`, and the plugin's own data folder (`jev-log.json`) through the adapter. All in memory.
 */
export class VaultStub {
  /** Note path -> body. */
  readonly notes: Map<string, string>;
  /** Adapter path -> content: the files outside the vault's file list, such as `jev-log.json`. */
  readonly dataFiles = new Map<string, string>();

  readonly adapter = {
    exists: (path: string): Promise<boolean> => Promise.resolve(this.dataFiles.has(path)),
    read: (path: string): Promise<string> => {
      const data = this.dataFiles.get(path);
      return data === undefined
        ? Promise.reject(new Error(`no such file: ${path}`))
        : Promise.resolve(data);
    },
    write: (path: string, data: string): Promise<void> => {
      this.dataFiles.set(path, data);
      return Promise.resolve();
    },
  };

  constructor(notes: Record<string, string> = {}) {
    this.notes = new Map(Object.entries(notes));
  }

  getAbstractFileByPath(path: string): TFile | null {
    if (!this.notes.has(path)) return null;
    const file = new TFile();
    file.path = path;
    return file;
  }

  process(file: TFile, fn: (data: string) => string): Promise<string> {
    const data = fn(this.notes.get(file.path) ?? '');
    this.notes.set(file.path, data);
    return Promise.resolve(data);
  }
}

// ---- LEV-170 ----

/**
 * `MarkdownView` as `src/Components/JevTypeLinkCommand.ts` uses it: only `ctx instanceof MarkdownView`
 * and `save()`, which flushes the editor buffer to the file before Jev writes a line.
 */
export class MarkdownView {
  file: TFile | null = null;
  save(): Promise<void> { return Promise.resolve(); }
}

// ---- LEV-172 ----
/** `JevLinkSuggest.close()` calls `super.close()`; the real one hides the popover. */
(EditorSuggest.prototype as unknown as { close: () => void }).close = function close(): void {
  (this as EditorSuggest).context = null;
};
