import { beforeEach, describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
// The stubs by their own path: Vitest serves the same module for `obsidian`, and their test-only
// members (`Notice.messages`, `VaultStub.notes`) are not on the real typings.
import { Notice, VaultStub } from '../mocks/obsidian';
import { appendRelation, isRelationEdit, replaceRelation } from 'src/jev/relations';
import type { RelationEdit, RelationResult } from 'src/jev/relations';
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

/** The edit of a result that wrote something; a test that expects a write fails loudly otherwise. */
function edited(result: RelationResult): RelationEdit {
  if (!isRelationEdit(result)) throw new Error(`nothing was written (${result.skipped})`);
  return result;
}

/** What the entry points (JEV-2〜4) do with one link: write the line, then record where it went. */
async function writeAndLog(
  app: App,
  file: TFile,
  field: string,
  target: string,
  options: { heading: string; mode?: 'relations' | 'inline'; at?: { line: number; ch: number } },
  meta: { batchId: string; source: string },
) {
  const edit = edited(await appendRelation(app, file, field, target, options));
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

    expect(await appendRelation(app, file('Note.md'), 'up', 'A', HEADING)).toEqual({ skipped: 'already-typed' });
    expect(await appendRelation(app, file('Note.md'), 'origin', 'B', HEADING)).toEqual({ skipped: 'already-typed' });
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
  const INLINE = { ...HEADING, mode: 'inline' as const };

  it('wraps a link in the middle of a sentence and leaves the rest of the line as it is', async () => {
    const note = '# Note\n\n昨日 [[A]] を読んだ。\n';
    const { app, file, vault } = setup({ 'Note.md': note });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', { ...INLINE, at: { line: 2, ch: 3 } });

    expect(vault.notes.get('Note.md')).toBe('# Note\n\n昨日 (origin:: [[A]]) を読んだ。\n');
    expect(edit).toEqual<RelationEdit>({
      line: 2,
      before: '昨日 [[A]] を読んだ。',
      after: '昨日 (origin:: [[A]]) を読んだ。',
    });
  });

  it('writes no brackets when the link is the whole line, keeping the indentation and the list marker', async () => {
    const { app, file, vault } = setup({
      'Bare.md': '[[A]]\n',
      'List.md': '- [[A]]\n',
      'Ordered.md': '  1. [[A]]  \n',
    });

    expect(await appendRelation(app, file('Bare.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 0 } }))
      .toEqual<RelationEdit>({ line: 0, before: '[[A]]', after: 'up:: [[A]]' });
    expect(vault.notes.get('Bare.md')).toBe('up:: [[A]]\n');

    await appendRelation(app, file('List.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 2 } });
    expect(vault.notes.get('List.md')).toBe('- up:: [[A]]\n');

    await appendRelation(app, file('Ordered.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 5 } });
    expect(vault.notes.get('Ordered.md')).toBe('  1. up:: [[A]]  \n');
  });

  it('brackets a link that shares its line with anything else, including a heading or a checkbox', async () => {
    const { app, file, vault } = setup({ 'Head.md': '# [[A]]\n', 'Task.md': '- [ ] [[A]]\n' });

    await appendRelation(app, file('Head.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 2 } });
    expect(vault.notes.get('Head.md')).toBe('# (up:: [[A]])\n');

    await appendRelation(app, file('Task.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 6 } });
    expect(vault.notes.get('Task.md')).toBe('- [ ] (up:: [[A]])\n');
  });

  it('types the occurrence the entry point pointed at, not the first one to the same note', async () => {
    // 再現 1（LEV-185）: 同じ相手への `[[A]]` が 2 つある本文で、2 つ目にカーソルを置く。
    const note = '昨日 [[A]] を読んだ。\n今日も [[A]] を読む。\n';
    const { app, file, vault } = setup({ 'Note.md': note });

    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', { ...INLINE, at: { line: 1, ch: 4 } });

    expect(vault.notes.get('Note.md')).toBe('昨日 [[A]] を読んだ。\n今日も (origin:: [[A]]) を読む。\n');
    expect(edit).toMatchObject({ line: 1 });
  });

  it('takes the occurrence the position falls inside, and the nearer one at a border', async () => {
    const { app, file, vault } = setup({ 'Inside.md': 'x [[A]] y\n', 'Border.md': '[[A]][[A|エー]]\n' });

    // `[` ではなくリンクの中を指してもその出現。
    await appendRelation(app, file('Inside.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 4 } });
    expect(vault.notes.get('Inside.md')).toBe('x (up:: [[A]]) y\n');

    // 隣り合う 2 つの境目（5）は、そこから始まる 2 つ目のもの。
    await appendRelation(app, file('Border.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 5 } });
    expect(vault.notes.get('Border.md')).toBe('[[A]](up:: [[A|エー]])\n');
  });

  it('keeps how the link was written, aliases and headings included', async () => {
    const { app, file, vault } = setup({ 'Note.md': 'see [[A|エー]] today\n' });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', { ...INLINE, at: { line: 0, ch: 4 } });

    expect(vault.notes.get('Note.md')).toBe('see (origin:: [[A|エー]]) today\n');
    expect(edited(edit).after).toBe('see (origin:: [[A|エー]]) today');
  });

  it('says already-typed when that occurrence carries a field, whichever field it is', async () => {
    const note = 'see (origin:: [[A]]) here\nup:: [[B]]\n';
    const { app, file, vault } = setup({ 'Note.md': note });

    // 同じフィールドでも別のフィールドでも、付け替え（replaceRelation）の仕事なのでここでは書かない。
    expect(await appendRelation(app, file('Note.md'), 'origin', 'A', { ...INLINE, at: { line: 0, ch: 14 } }))
      .toEqual({ skipped: 'already-typed' });
    expect(await appendRelation(app, file('Note.md'), 'similar', 'B', { ...INLINE, at: { line: 1, ch: 5 } }))
      .toEqual({ skipped: 'already-typed' });
    expect(vault.notes.get('Note.md')).toBe(note);
  });

  it('says not-found when the link has moved away from the position it was pointed at', async () => {
    const note = '昨日 [[A]] を読んだ。\n';
    const { app, file, vault } = setup({ 'Note.md': note });

    // 別の桁・別の行・frontmatter やコードブロックの中の行は、どれも当てるリンクが無い。
    expect(await appendRelation(app, file('Note.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 0 } }))
      .toEqual({ skipped: 'not-found' });
    expect(await appendRelation(app, file('Note.md'), 'up', 'A', { ...INLINE, at: { line: 9, ch: 3 } }))
      .toEqual({ skipped: 'not-found' });
    expect(vault.notes.get('Note.md')).toBe(note);

    const fenced = setup({ 'Note.md': '```md\nsample [[A]]\n```\n' });
    expect(await appendRelation(fenced.app, fenced.file('Note.md'), 'up', 'A', { ...INLINE, at: { line: 1, ch: 7 } }))
      .toEqual({ skipped: 'not-found' });
    expect(fenced.vault.notes.get('Note.md')).toBe('```md\nsample [[A]]\n```\n');
  });

  it('leaves an embed alone: it is not a link to type', async () => {
    const note = '![[A]] と [[A]]\n';
    const { app, file, vault } = setup({ 'Note.md': note });

    expect(await appendRelation(app, file('Note.md'), 'up', 'A', { ...INLINE, at: { line: 0, ch: 1 } }))
      .toEqual({ skipped: 'not-found' });
    expect(vault.notes.get('Note.md')).toBe(note);
  });

  it('drops a markdown link into the Relations section, where a wikilink can reach the note', async () => {
    // 再現 2（LEV-185）: `(up:: [B](notes/B.md))` は書かず、節に `[[…]]` で 1 行足す（設計 §3）。
    const note = 'テンプレートは [B](notes/B.md) に寄せる。';
    const { app, file, vault } = setup({ 'Note.md': note });
    const edit = await appendRelation(app, file('Note.md'), 'up', 'notes/B.md', { ...INLINE, at: { line: 0, ch: 8 } });

    expect(vault.notes.get('Note.md')).toBe(`${note}\n\n## Relations\nup:: [[notes/B.md]]`);
    expect(edit).toEqual<RelationEdit>({ line: 1, before: '', after: '\n## Relations\nup:: [[notes/B.md]]' });
  });

  it('types the first untyped occurrence when no position is given (the bulk run has no cursor)', async () => {
    const { app, file, vault } = setup({
      'Note.md': 'up:: [[A]]\nsee (similar:: [[A]])\nand [[A]] here\nand [[A]] again\n',
    });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', INLINE);

    expect(vault.notes.get('Note.md'))
      .toBe('up:: [[A]]\nsee (similar:: [[A]])\nand (origin:: [[A]]) here\nand [[A]] again\n');
    expect(edit).toMatchObject({ line: 2 });
  });

  it('says already-typed without a position when the same field is already on a link', async () => {
    const note = 'see (origin:: [[A]]) and [[B]]\n';
    const { app, file, vault } = setup({ 'Note.md': note });

    expect(await appendRelation(app, file('Note.md'), 'origin', 'A', INLINE)).toEqual({ skipped: 'already-typed' });
    expect(await appendRelation(app, file('Note.md'), 'up', 'C', INLINE)).toEqual({ skipped: 'not-found' });
    expect(vault.notes.get('Note.md')).toBe(note);
  });

  it('leaves frontmatter, code blocks and embeds alone without a position too', async () => {
    const note = '---\nrelated: "[[A]]"\n---\n\n```md\nsample [[A]]\n```\n\n![[A]]\nabout [[A]] here\n';
    const { app, file, vault } = setup({ 'Note.md': note });
    const edit = await appendRelation(app, file('Note.md'), 'origin', 'A', INLINE);

    expect(vault.notes.get('Note.md')).toBe(
      '---\nrelated: "[[A]]"\n---\n\n```md\nsample [[A]]\n```\n\n![[A]]\nabout (origin:: [[A]]) here\n',
    );
    expect(edit).toMatchObject({ line: 9 });
  });

  it('keeps the line endings of a note written on Windows', async () => {
    const { app, file, vault } = setup({ 'Note.md': '# Note\r\n\r\n昨日 [[A]] を読んだ。\r\n' });
    await appendRelation(app, file('Note.md'), 'up', 'A', { ...INLINE, at: { line: 2, ch: 3 } });

    expect(vault.notes.get('Note.md')).toBe('# Note\r\n\r\n昨日 (up:: [[A]]) を読んだ。\r\n');
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

    expect(await replaceRelation(app, file('Note.md'), 'up', 'origin', 'A')).toEqual({ skipped: 'not-found' });
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
      app, file('Note.md'), 'origin', 'A',
      { ...HEADING, mode: 'inline', at: { line: 0, ch: 3 } },
      { batchId: 'b1', source: 'suggester' },
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
    const upper = edited(await appendRelation(app, file('Note.md'), 'up', 'A', HEADING));
    const lower = edited(await appendRelation(app, file('Note.md'), 'origin', 'B', HEADING));
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
