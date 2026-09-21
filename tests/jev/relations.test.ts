import { beforeEach, describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
// The stubs by their own path: Vitest serves the same module for `obsidian`, and their test-only
// members (`Notice.messages`, `VaultStub.notes`) are not on the real typings.
import { Notice, VaultStub } from '../mocks/obsidian';
import { appendRelation, replaceRelation } from 'src/jev/relations';
import type { RelationEdit } from 'src/jev/relations';
import { appendLogEntry, undo, undoBatch } from 'src/jev/log';

const MANIFEST_DIR = '.obsidian/plugins/jevbrain';
const LOG_PATH = `${MANIFEST_DIR}/jev-log.json`;
const HEADING = { heading: 'Relations' };

function setup(notes: Record<string, string>) {
  const vault = new VaultStub(notes);
  const app = { vault } as unknown as App;
  const file = (path: string): TFile => vault.getAbstractFileByPath(path) as unknown as TFile;
  const log = (): unknown[] => JSON.parse(vault.dataFiles.get(LOG_PATH) ?? '[]') as unknown[];
  return { vault, app, file, log };
}

/** What the entry points (JEV-2〜4) do with one link: write the line, then record where it went. */
async function writeAndLog(
  app: App,
  file: TFile,
  field: string,
  target: string,
  options: { heading: string; mode?: 'relations' | 'inline' },
  meta: { batchId: string; source: string },
) {
  const edit = await appendRelation(app, file, field, target, options);
  if (!edit) throw new Error('nothing was written');
  return appendLogEntry(app, MANIFEST_DIR, { ...edit, file: file.path, ...meta });
}

beforeEach(() => {
  Notice.messages = [];
});

describe('appendRelation into the Relations section', () => {
  it('appends the field line at the end of an existing section, leaving the prose and the trailing blank line alone', async () => {
    const { app, file, vault } = setup({ 'Note.md': '# Note\n\nabout [[A]]\n\n## Relations\nup:: [[A]]\n' });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'B', HEADING);

    expect(vault.notes.get('Note.md')).toBe('# Note\n\nabout [[A]]\n\n## Relations\nup:: [[A]]\norigin:: [[B]]\n');
    expect(edit).toEqual<RelationEdit>({ line: 6, before: '', after: 'origin:: [[B]]' });
  });

  it('keeps the new line inside the section when another heading follows', async () => {
    const { app, file, vault } = setup({ 'Note.md': '## Relations\nup:: [[A]]\n\n## Notes\ntail\n' });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'B', HEADING);

    expect(vault.notes.get('Note.md')).toBe('## Relations\nup:: [[A]]\norigin:: [[B]]\n\n## Notes\ntail\n');
    expect(edit).toEqual<RelationEdit>({ line: 2, before: '', after: 'origin:: [[B]]' });
  });

  it('creates the section at the end of the note when it is missing, with a blank line before the heading', async () => {
    const { app, file, vault } = setup({ 'Note.md': '# Note\n\nabout [[A]]' });
    const edit = await appendRelation(app, file('Note.md'), 'up', 'A', HEADING);

    expect(vault.notes.get('Note.md')).toBe('# Note\n\nabout [[A]]\n\n## Relations\nup:: [[A]]');
    expect(edit).toEqual<RelationEdit>({ line: 3, before: '', after: '\n## Relations\nup:: [[A]]' });
  });

  it('writes only the heading and the line into an empty note', async () => {
    const { app, file, vault } = setup({ 'Note.md': '' });
    const edit = await appendRelation(app, file('Note.md'), 'up', 'A', HEADING);

    expect(vault.notes.get('Note.md')).toBe('## Relations\nup:: [[A]]');
    expect(edit).toEqual<RelationEdit>({ line: 0, before: '', after: '## Relations\nup:: [[A]]' });
  });

  it('uses the heading from the settings', async () => {
    const { app, file, vault } = setup({ 'Note.md': '# Note\n\n## 関係\nup:: [[A]]\n' });
    await appendRelation(app, file('Note.md'), 'origin', 'B', { heading: '関係' });

    expect(vault.notes.get('Note.md')).toBe('# Note\n\n## 関係\nup:: [[A]]\norigin:: [[B]]\n');
  });

  it('does nothing when the same relation is already in the section, however it is written', async () => {
    const note = '## Relations\nup::[[A]]\nOrigin:: [[B|ビー]]\n';
    const { app, file, vault } = setup({ 'Note.md': note });

    expect(await appendRelation(app, file('Note.md'), 'up', 'A', HEADING)).toBeNull();
    expect(await appendRelation(app, file('Note.md'), 'origin', 'B', HEADING)).toBeNull();
    expect(vault.notes.get('Note.md')).toBe(note);
  });

  it('ignores a heading quoted inside a code block and creates a real section', async () => {
    const { app, file, vault } = setup({ 'Note.md': '# Note\n\n```md\n## Relations\nup:: [[Z]]\n```\n' });
    await appendRelation(app, file('Note.md'), 'up', 'A', HEADING);

    expect(vault.notes.get('Note.md')).toBe('# Note\n\n```md\n## Relations\nup:: [[Z]]\n```\n\n## Relations\nup:: [[A]]');
  });

  it('keeps the line endings of a note written on Windows', async () => {
    const { app, file, vault } = setup({ 'Note.md': '# Note\r\n\r\n## Relations\r\nup:: [[A]]\r\n' });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'B', HEADING);

    expect(vault.notes.get('Note.md')).toBe('# Note\r\n\r\n## Relations\r\nup:: [[A]]\r\norigin:: [[B]]\r\n');
    expect(edit).toEqual<RelationEdit>({ line: 4, before: '', after: 'origin:: [[B]]' });
  });

  it('keeps the blank lines of a note that holds nothing else', async () => {
    const { app, file, vault } = setup({ 'Note.md': '\n\n\n' });
    const edit = await appendRelation(app, file('Note.md'), 'up', 'A', HEADING);

    expect(vault.notes.get('Note.md')).toBe('\n\n\n\n## Relations\nup:: [[A]]');
    expect(edit).toEqual<RelationEdit>({ line: 4, before: '', after: '## Relations\nup:: [[A]]' });
  });
});

describe('appendRelation with writeMode inline', () => {
  it('types the first bare link in the prose and leaves the rest of the line as it is', async () => {
    const { app, file, vault } = setup({ 'Note.md': '# Note\n\n昨日 [[A]] を読んだ。[[A]] はよい。\n' });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', { ...HEADING, mode: 'inline' });

    expect(vault.notes.get('Note.md')).toBe('# Note\n\n昨日 (origin:: [[A]]) を読んだ。[[A]] はよい。\n');
    expect(edit).toEqual<RelationEdit>({
      line: 2,
      before: '昨日 [[A]] を読んだ。[[A]] はよい。',
      after: '昨日 (origin:: [[A]]) を読んだ。[[A]] はよい。',
    });
  });

  it('skips links that already carry a field, inline or on their own line', async () => {
    const { app, file, vault } = setup({ 'Note.md': 'up:: [[A]]\nsee (similar:: [[A]])\nand [[A]] here\n' });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', { ...HEADING, mode: 'inline' });

    expect(vault.notes.get('Note.md')).toBe('up:: [[A]]\nsee (similar:: [[A]])\nand (origin:: [[A]]) here\n');
    expect(edit?.line).toBe(2);
  });

  it('does nothing when the note already has the same inline field, or no bare link at all', async () => {
    const note = 'see (origin:: [[A]]) and [[B]]\n';
    const { app, file, vault } = setup({ 'Note.md': note });

    expect(await appendRelation(app, file('Note.md'), 'origin', 'A', { ...HEADING, mode: 'inline' })).toBeNull();
    expect(await appendRelation(app, file('Note.md'), 'up', 'C', { ...HEADING, mode: 'inline' })).toBeNull();
    expect(vault.notes.get('Note.md')).toBe(note);
  });

  it('types a link written with an alias or a heading, keeping how it was written', async () => {
    const { app, file, vault } = setup({ 'Note.md': 'see [[A|エー]] today\n' });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', { ...HEADING, mode: 'inline' });

    expect(vault.notes.get('Note.md')).toBe('see (origin:: [[A|エー]]) today\n');
    expect(edit?.after).toBe('see (origin:: [[A|エー]]) today');
  });

  it('leaves frontmatter, code blocks and embeds alone, and types the link in the prose', async () => {
    const note = '---\nrelated: "[[A]]"\n---\n\n```md\nsample [[A]]\n```\n\n![[A]]\nabout [[A]] here\n';
    const { app, file, vault } = setup({ 'Note.md': note });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', { ...HEADING, mode: 'inline' });

    expect(vault.notes.get('Note.md')).toBe(
      '---\nrelated: "[[A]]"\n---\n\n```md\nsample [[A]]\n```\n\n![[A]]\nabout (origin:: [[A]]) here\n',
    );
    expect(edit?.line).toBe(9);
  });
});

describe('replaceRelation', () => {
  it('replaces the field of an existing line, and of an inline field, leaving the target alone', async () => {
    const { app, file, vault } = setup({
      'Line.md': '## Relations\nup:: [[A]]\n',
      'Inline.md': 'about (up:: [[A]]) today\n',
    });

    expect(await replaceRelation(app, file('Line.md'), 'up', 'origin', 'A')).toEqual<RelationEdit>({
      line: 1, before: 'up:: [[A]]', after: 'origin:: [[A]]',
    });
    expect(vault.notes.get('Line.md')).toBe('## Relations\norigin:: [[A]]\n');

    expect(await replaceRelation(app, file('Inline.md'), 'up', 'origin', 'A')).toEqual<RelationEdit>({
      line: 0, before: 'about (up:: [[A]]) today', after: 'about (origin:: [[A]]) today',
    });
    expect(vault.notes.get('Inline.md')).toBe('about (origin:: [[A]]) today\n');
  });

  it('keeps the indentation, the rest of the line, and note names that look like replacement patterns', async () => {
    const { app, file, vault } = setup({
      'List.md': '- list\n  up:: [[A]] <- note\n',
      'Dollar.md': 'about (up:: [[A$&B]]) today\n',
    });

    await replaceRelation(app, file('List.md'), 'up', 'origin', 'A');
    expect(vault.notes.get('List.md')).toBe('- list\n  origin:: [[A]] <- note\n');

    await replaceRelation(app, file('Dollar.md'), 'up', 'origin', 'A$&B');
    expect(vault.notes.get('Dollar.md')).toBe('about (origin:: [[A$&B]]) today\n');
  });

  it('does nothing when the note has no such field for the target', async () => {
    const { app, file, vault } = setup({ 'Note.md': '## Relations\nup:: [[B]]\n' });

    expect(await replaceRelation(app, file('Note.md'), 'up', 'origin', 'A')).toBeNull();
    expect(vault.notes.get('Note.md')).toBe('## Relations\nup:: [[B]]\n');
  });
});

describe('jev-log.json and undo', () => {
  it('records what was written, in the plugin data folder', async () => {
    const { app, file, log } = setup({ 'Note.md': '## Relations\n' });
    const entry = await writeAndLog(app, file('Note.md'), 'up', 'A', HEADING, { batchId: 'b1', source: 'suggester' });

    expect(entry).toMatchObject({
      batchId: 'b1', file: 'Note.md', line: 1, before: '', after: 'up:: [[A]]', source: 'suggester',
    });
    expect(entry.id).not.toBe('');
    expect(Date.parse(entry.at)).not.toBeNaN();
    expect(log()).toEqual([entry]);
  });

  it('undoes one line: the note goes back, including the section the write created, and the entry is dropped', async () => {
    const before = '# Note\n\nabout [[A]]';
    const { app, file, vault, log } = setup({ 'Note.md': before });
    const entry = await writeAndLog(app, file('Note.md'), 'up', 'A', HEADING, { batchId: 'b1', source: 'queue' });

    expect(await undo(app, MANIFEST_DIR, entry.id)).toBe('undone');
    expect(vault.notes.get('Note.md')).toBe(before);
    expect(log()).toEqual([]);
    expect(Notice.messages).toEqual([]);
  });

  it('undoes an inline write back to the original line', async () => {
    const before = '昨日 [[A]] を読んだ。\n';
    const { app, file, vault } = setup({ 'Note.md': before });
    const entry = await writeAndLog(
      app, file('Note.md'), 'origin', 'A', { ...HEADING, mode: 'inline' }, { batchId: 'b1', source: 'suggester' },
    );

    expect(await undo(app, MANIFEST_DIR, entry.id)).toBe('undone');
    expect(vault.notes.get('Note.md')).toBe(before);
  });

  it('keeps a line that changed by hand, with a notice, and keeps the entry', async () => {
    const { app, file, vault, log } = setup({ 'Note.md': '## Relations\n' });
    const entry = await writeAndLog(app, file('Note.md'), 'up', 'A', HEADING, { batchId: 'b1', source: 'queue' });
    const byHand = '## Relations\nup:: [[A]] <- mine now\n';
    vault.notes.set('Note.md', byHand);

    expect(await undo(app, MANIFEST_DIR, entry.id)).toBe('line-changed');
    expect(vault.notes.get('Note.md')).toBe(byHand);
    expect(log()).toEqual([entry]);
    expect(Notice.messages).toHaveLength(1);
    expect(Notice.messages[0]).toContain('1 line(s)');
  });

  it('reports a gone note instead of writing it back', async () => {
    const { app, file, vault, log } = setup({ 'Note.md': '## Relations\n' });
    const entry = await writeAndLog(app, file('Note.md'), 'up', 'A', HEADING, { batchId: 'b1', source: 'queue' });
    vault.notes.delete('Note.md');

    expect(await undo(app, MANIFEST_DIR, entry.id)).toBe('file-missing');
    expect(log()).toEqual([entry]);
    expect(Notice.messages).toHaveLength(1);
  });

  it('undoes a whole batch, last line first, and leaves the lines of other batches', async () => {
    const before = '# Note\n\nabout [[A]] and [[B]]';
    const { app, file, vault, log } = setup({ 'Note.md': before });
    await writeAndLog(app, file('Note.md'), 'up', 'A', HEADING, { batchId: 'bulk', source: 'bulk' });
    await writeAndLog(app, file('Note.md'), 'origin', 'B', HEADING, { batchId: 'bulk', source: 'bulk' });
    const kept = await writeAndLog(app, file('Note.md'), 'similar', 'C', HEADING, { batchId: 'b2', source: 'queue' });

    expect(await undoBatch(app, MANIFEST_DIR, 'bulk')).toEqual({ undone: 2, skipped: 0 });
    expect(vault.notes.get('Note.md')).toBe('# Note\n\nabout [[A]] and [[B]]\n\n## Relations\nsimilar:: [[C]]');
    // 上の 2 行が消えたぶん、残った記録の行番号も動く。
    expect(log()).toEqual([{ ...kept, line: 5 }]);
    expect(Notice.messages).toEqual([]);
  });

  it('undoes the rest of the batch and notices once when one line changed by hand', async () => {
    const { app, file, vault, log } = setup({ 'A.md': '## Relations\n', 'B.md': '## Relations\n' });
    const changed = await writeAndLog(app, file('A.md'), 'up', 'X', HEADING, { batchId: 'bulk', source: 'bulk' });
    await writeAndLog(app, file('B.md'), 'up', 'Y', HEADING, { batchId: 'bulk', source: 'bulk' });
    vault.notes.set('A.md', '## Relations\nparent:: [[X]]\n');

    expect(await undoBatch(app, MANIFEST_DIR, 'bulk')).toEqual({ undone: 1, skipped: 1 });
    expect(vault.notes.get('A.md')).toBe('## Relations\nparent:: [[X]]\n');
    expect(vault.notes.get('B.md')).toBe('## Relations\n');
    expect(log()).toEqual([changed]);
    expect(Notice.messages).toHaveLength(1);
  });

  it('moves the lines of the entries below the one it undid, so the next undo still finds its line', async () => {
    const { app, file, vault, log } = setup({ 'Note.md': '## Relations\n' });
    const first = await writeAndLog(app, file('Note.md'), 'up', 'A', HEADING, { batchId: 'b1', source: 'suggester' });
    const second = await writeAndLog(app, file('Note.md'), 'origin', 'B', HEADING, { batchId: 'b2', source: 'queue' });

    expect(await undo(app, MANIFEST_DIR, first.id)).toBe('undone');
    expect(vault.notes.get('Note.md')).toBe('## Relations\norigin:: [[B]]\n');
    expect(log()).toEqual([{ ...second, line: 1 }]);

    expect(await undo(app, MANIFEST_DIR, second.id)).toBe('undone');
    expect(vault.notes.get('Note.md')).toBe('## Relations\n');
    expect(Notice.messages).toEqual([]);
  });

  it('undoes a batch by line, not by the order the parallel writes were recorded in', async () => {
    const { app, file, vault, log } = setup({ 'Note.md': '## Relations\n' });
    const meta = { batchId: 'bulk', source: 'bulk' };
    // 一括は判定を並列に走らせるので、書いた順と記録の順は入れ替わりうる（設計 §4-3）。
    const upper = await appendRelation(app, file('Note.md'), 'up', 'A', HEADING);
    const lower = await appendRelation(app, file('Note.md'), 'origin', 'B', HEADING);
    if (!upper || !lower) throw new Error('nothing was written');
    await appendLogEntry(app, MANIFEST_DIR, { ...lower, file: 'Note.md', ...meta });
    await appendLogEntry(app, MANIFEST_DIR, { ...upper, file: 'Note.md', ...meta });

    expect(await undoBatch(app, MANIFEST_DIR, 'bulk')).toEqual({ undone: 2, skipped: 0 });
    expect(vault.notes.get('Note.md')).toBe('## Relations\n');
    expect(log()).toEqual([]);
    expect(Notice.messages).toEqual([]);
  });

  it('answers not-found for an id that is not in the log', async () => {
    const { app } = setup({ 'Note.md': '## Relations\n' });

    expect(await undo(app, MANIFEST_DIR, 'no-such-id')).toBe('not-found');
    expect(Notice.messages).toEqual([]);
  });
});
