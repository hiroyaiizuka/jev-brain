import { describe, expect, it } from 'vitest';
import { TARGET_EXCERPT_CHARS, buildState, type BuildStateInput } from 'src/jev/state';

const body = (marker: string) => `${'あ'.repeat(1000)}${marker}${'い'.repeat(1000)}`;

const input = (overrides: Partial<BuildStateInput> = {}): BuildStateInput => ({
  note: { frontmatter: { tags: ['book'], up: '[[Philosophy]]' }, text: body('[[Kant]]') },
  link: { target: 'Kant', offset: 1000, length: '[[Kant]]'.length },
  targetNote: { frontmatter: { tags: ['person'] }, text: 'Immanuel Kant was a philosopher.' },
  contextChars: 500,
  ...overrides,
});

const parse = (state: string) => JSON.parse(state) as {
  note: { frontmatter: Record<string, unknown> | null; context: string };
  target: { name: string; frontmatter?: Record<string, unknown> | null; excerpt?: string };
  currentField?: string;
};

describe('buildState', () => {
  it('keeps the frontmatter and the whole link with the window on each side', () => {
    const state = parse(buildState(input()));

    expect(state.note.frontmatter).toEqual({ tags: ['book'], up: '[[Philosophy]]' });
    expect(state.note.context).toBe(`${'あ'.repeat(500)}[[Kant]]${'い'.repeat(500)}`);
  });

  it('keeps the window behind the link when the link is long', () => {
    const link = '[[Projects/2026 Q3 Roadmap|roadmap]]';
    const text = `${'a'.repeat(50)}${link}${'b'.repeat(50)}`;
    const state = parse(buildState(input({
      note: { frontmatter: null, text },
      link: { target: 'Projects/2026 Q3 Roadmap', offset: 50, length: link.length },
      contextChars: 30,
    })));

    expect(state.note.context).toBe(`${'a'.repeat(30)}${link}${'b'.repeat(30)}`);
  });

  it('does not carry the body outside the window', () => {
    const text = `${'x'.repeat(100)}far-away${'x'.repeat(100)}[[Kant]]${'y'.repeat(2000)}`;
    const state = buildState(input({ note: { frontmatter: null, text }, link: { target: 'Kant', offset: 208, length: 8 }, contextChars: 50 }));

    expect(state).not.toContain('far-away');
    expect(parse(state).note.context.length).toBe(108);
  });

  it('clips the window at both ends of the note', () => {
    const text = 'short note with [[Kant]] in it';
    const state = parse(buildState(input({ note: { frontmatter: null, text }, link: { target: 'Kant', offset: 16, length: 8 }, contextChars: 500 })));

    expect(state.note.context).toBe(text);
  });

  it('drops the offsets Obsidian keeps in the frontmatter', () => {
    const frontmatter = { tags: ['book'], position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 3, col: 3, offset: 42 } } };
    const state = buildState(input({ note: { frontmatter, text: body('[[Kant]]') } }));

    expect(parse(state).note.frontmatter).toEqual({ tags: ['book'] });
    expect(state).not.toContain('position');
  });

  it('cuts the target note at its opening', () => {
    const text = `${'z'.repeat(400)}tail`;
    const state = parse(buildState(input({ targetNote: { frontmatter: null, text } })));

    expect(state.target.excerpt).toBe('z'.repeat(TARGET_EXCERPT_CHARS));
    expect(state.target.name).toBe('Kant');
  });

  it('sends only the name of a link with no file', () => {
    const state = parse(buildState(input({ targetNote: null })));

    expect(state.target).toEqual({ name: 'Kant' });
  });

  it('carries the current field only for a typed link', () => {
    expect(parse(buildState(input({ currentField: 'origin' }))).currentField).toBe('origin');
    expect(parse(buildState(input()))).not.toHaveProperty('currentField');
  });
});
