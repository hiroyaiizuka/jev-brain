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
