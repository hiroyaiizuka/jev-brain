import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_OUT,
  RECORD_NAME,
  extractTruth,
  parseArguments,
  parseNote,
  projectRoot,
  resolveOutputPath,
} from '../../scripts/jev-accuracy.mjs';

const fixturesSource = fileURLToPath(new URL('../fixtures', import.meta.url));
const scriptName = 'jev-accuracy.mjs';
const scriptSource = fileURLToPath(new URL(`../../scripts/${scriptName}`, import.meta.url));

/**
 * The 3D notes of `docs/3d-brief.md` §7 (centre plus the seven of its table) and the three added
 * later for the vertical axis and the band rows (LEV-124, LEV-128). Every typed link of the cluster
 * is written in the centre note, so the counts below are the fixture's own numbers.
 */
const THREE_D_NOTES = [
  '習慣はトリガー固定で続く.md',
  '行動デザイン.md',
  '読書メモ：習慣の本.md',
  'if-then プラン.md',
  '意志力で続ける.md',
  '朝のルーティン手順.md',
  '歯磨き後に腕立て.md',
  '9月20日 朝ランの記録.md',
  '習慣ループ.md',
  '習慣トラッカーの使い方.md',
  '週次レビューのテンプレート.md',
];

let root;
let vault;

function addThreeDVault() {
  for (const note of THREE_D_NOTES) {
    cpSync(join(fixturesSource, note), join(vault, note));
  }
}

function addSettings(hierarchy) {
  const directory = join(vault, '.obsidian', 'plugins', 'jevbrain');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'data.json'), `${JSON.stringify({ hierarchy }, null, 2)}\n`);
}

function addNote(name, contents) {
  writeFileSync(join(vault, name), contents);
}

const countsByField = (truth) => Object.fromEntries(truth.summary.byField.map((row) => [row.field, row.count]));
const countsByDirection = (truth) => Object.fromEntries(truth.summary.byDirection.map((row) => [row.direction ?? 'none', row.count]));
const entryFor = (truth, target) => truth.entries.find((entry) => entry.target === target);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'jev-accuracy-test-')));
  vault = join(root, 'vault');
  mkdirSync(vault);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('extract on the 3D fixture notes', () => {
  beforeEach(addThreeDVault);

  it('counts every typed link of the centre note by field', () => {
    const truth = extractTruth(vault);

    expect(truth.notes).toBe(THREE_D_NOTES.length);
    expect(truth.summary.entries).toBe(11);
    expect(countsByField(truth)).toEqual({ up: 3, example: 2, 'leads-to': 2, down: 1, next: 1, origin: 1, similar: 1 });
    expect(truth.entries.every((entry) => entry.note === '習慣はトリガー固定で続く.md')).toBe(true);
  });

  it('takes the direction from the ontology region, upstream defaults when the vault has no settings', () => {
    const truth = extractTruth(vault);

    expect(truth.hierarchySource).toBe('defaults');
    // up と origin は Parents、down と leads to は Children、similar は左友、next は次。example はどの領域にも無い。
    expect(countsByDirection(truth)).toEqual({ parent: 4, child: 3, 'left-friend': 1, next: 1, none: 2 });
    expect(entryFor(truth, '歯磨き後に腕立て')).toMatchObject({ field: 'example', region: null, direction: null });
  });

  it('reads Up and Down from the vault settings (harness E13: up / down, example)', () => {
    addSettings({ abstract: ['up'], concrete: ['down', 'example'], parents: ['up', 'origin'] });

    const truth = extractTruth(vault);

    expect(truth.hierarchySource).toBe('data.json');
    // up は abstract が先に取るので parents の重複は落ちる（src/utils/hierarchy.ts と同じ順序）。
    expect(entryFor(truth, '行動デザイン')).toMatchObject({ region: 'abstract', direction: 'parent' });
    expect(entryFor(truth, '歯磨き後に腕立て')).toMatchObject({ region: 'concrete', direction: 'child' });
    expect(countsByDirection(truth)).toEqual({ parent: 4, child: 5, 'left-friend': 1, next: 1 });
  });

  it('records the neighbour frontmatter and opening characters, and leaves an unresolved link empty', () => {
    const truth = extractTruth(vault);

    expect(entryFor(truth, '行動デザイン')).toMatchObject({
      targetPath: '行動デザイン.md',
      targetFrontmatter: 'tags:\n  - concept',
      targetExcerpt: '# 行動デザイン\n\n行動を環境と手順の設計で引き出す考え方。上位概念（Up の親、3D では +1）。',
    });
    expect(entryFor(truth, '抽象化のはしご')).toMatchObject({
      targetPath: null,
      targetFrontmatter: null,
      targetExcerpt: null,
    });
  });

  it('keeps the note frontmatter and the characters around the link', () => {
    const truth = extractTruth(vault);
    const entry = entryFor(truth, '習慣ループ');

    expect(truth.contextChars).toBe(500);
    expect(entry.noteFrontmatter).toBe('tags:\n  - habit');
    expect(entry.line).toBe(8);
    expect(entry.source).toBe('line');
    expect(entry.contextBefore.startsWith('---\ntags:\n  - habit\n---\n')).toBe(true);
    expect(entry.contextBefore.endsWith('up:: [[行動デザイン]]\nup:: ')).toBe(true);
    expect(entry.contextAfter.startsWith('\nup:: [[抽象化のはしご]]\norigin:: ')).toBe(true);
  });

  it('cuts the context at the requested number of characters', () => {
    const entry = entryFor(extractTruth(vault, { contextChars: 20 }), '習慣ループ');

    expect(entry.contextBefore).toHaveLength(20);
    expect(entry.contextAfter).toHaveLength(20);
  });

  it('counts the typed links against every wiki link of the vault', () => {
    addNote('外部の話題.md', '本文の [[習慣はトリガー固定で続く]] は型を持たない。\n');

    const truth = extractTruth(vault);

    expect(truth.summary.links).toEqual({ total: 12, typed: 11, ratio: 11 / 12 });
  });
});

describe('field forms', () => {
  it('reads frontmatter keys, an inline field and a Relations line, and skips embeds and fenced code', () => {
    const note = [
      '---',
      'tags:',
      '  - note',
      'up: "[[親ノート]]"',
      'similar:',
      '  - "[[友ノート]]"',
      '---',
      '# 合成ノート',
      '',
      '本文に (down:: [[子ノート]]) が入る。ただの [[ただのリンク]] と埋め込み ![[画像ノート]] は型付きではない。',
      '',
      '~~~',
      'next:: [[コードの中のノート]]',
      '~~~',
      '',
      '## Relations',
      '',
      'next:: [[次ノート]]',
      '',
    ].join('\n');

    const parsed = parseNote(note);

    expect(parsed.frontmatter).toBe('tags:\n  - note\nup: "[[親ノート]]"\nsimilar:\n  - "[[友ノート]]"');
    expect(parsed.fields.map(({ field, source, target, line }) => ({ field, source, target, line }))).toEqual([
      { field: 'up', source: 'frontmatter', target: '親ノート', line: 4 },
      { field: 'similar', source: 'frontmatter', target: '友ノート', line: 6 },
      { field: 'down', source: 'inline', target: '子ノート', line: 10 },
      { field: 'next', source: 'relations', target: '次ノート', line: 18 },
    ]);
    // 埋め込みとコードの中のリンクは数えない。
    expect(parsed.links).toBe(5);
  });

  it('keeps the alias and the heading out of the target name', () => {
    const parsed = parseNote('up:: [[親ノート#見出し|別名]]\n');

    expect(parsed.fields).toHaveLength(1);
    expect(parsed.fields[0].target).toBe('親ノート');
  });
});

describe('output paths', () => {
  it('accepts a path under artifacts/', () => {
    const projectPath = projectRoot();

    expect(resolveOutputPath(projectPath, DEFAULT_OUT)).toBe(join(projectPath, DEFAULT_OUT));
  });

  it('refuses to write vault content outside artifacts/', () => {
    const projectPath = projectRoot();

    expect(() => resolveOutputPath(projectPath, 'docs/truth.json')).toThrow(/artifacts/);
    expect(() => resolveOutputPath(projectPath, join(root, 'truth.json'))).toThrow(/artifacts/);
  });
});

describe('arguments', () => {
  it('defaults the output to artifacts/jev-accuracy/truth.json', () => {
    expect(parseArguments(['extract', '--vault', '/tmp/vault'])).toEqual({
      subcommand: 'extract',
      vault: '/tmp/vault',
      out: DEFAULT_OUT,
    });
  });

  it('needs a vault for extract, a known subcommand and known flags', () => {
    expect(() => parseArguments(['extract'])).toThrow(/--vault/);
    expect(() => parseArguments(['measure', '--vault', '/tmp/vault'])).toThrow(/extract or judge/);
    expect(() => parseArguments(['extract', '--vault', '/tmp/vault', '--all', 'yes'])).toThrow(/Unknown argument/);
    expect(() => parseArguments(['extract', '--vault'])).toThrow(/Missing value/);
  });
});

describe('the command', () => {
  function runScript(...args) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(scriptSource, join(root, 'scripts', scriptName));
    return spawnSync(process.execPath, [join('scripts', scriptName), ...args], { cwd: root, encoding: 'utf8' });
  }

  it('writes truth.json and record.md under artifacts/ and prints the tables', () => {
    addThreeDVault();

    const result = runScript('extract', '--vault', vault, '--out', DEFAULT_OUT);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('| up | Parents | 親 | 3 |');
    expect(result.stdout).toContain('| 親 | 4 |');
    const truth = JSON.parse(readFileSync(join(root, DEFAULT_OUT), 'utf8'));
    expect(truth.summary.entries).toBe(11);
    expect(existsSync(join(root, 'artifacts', 'jev-accuracy', RECORD_NAME))).toBe(true);
  });

  it('keeps judge for LEV-163', () => {
    const result = runScript('judge');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LEV-163');
  });
});
