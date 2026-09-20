import { describe, expect, it } from 'vitest';
import { linkRegex } from 'src/graph/URLParser';

/** Every `[alias](url)` and bare URL the regex finds, as the parser reads them (groups 1/2 or 3/4). */
function findLinks(text: string): { alias: string; url: string }[] {
  return Array.from(text.matchAll(linkRegex), (match) => ({
    alias: match[1] ?? match[3] ?? '',
    url: match[2] ?? match[4] ?? '',
  }));
}

describe('linkRegex (URL nodes)', () => {
  it('reads a Markdown link as alias plus URL', () => {
    expect(findLinks('See [Obsidian](https://obsidian.md/) for details.')).toEqual([
      { alias: 'Obsidian', url: 'https://obsidian.md/' },
    ]);
  });

  it('reads a bare URL with an empty alias', () => {
    expect(findLinks('Docs: https://docs.obsidian.md/Plugins ok')).toEqual([
      { alias: '', url: 'https://docs.obsidian.md/Plugins' },
    ]);
  });

  it('stops a bare URL before trailing punctuation', () => {
    expect(findLinks('Read https://example.com/page. Then https://example.com/other, later').map((link) => link.url)).toEqual([
      'https://example.com/page',
      'https://example.com/other',
    ]);
  });

  it('cuts a bare URL at an opening parenthesis (upstream behaviour, pinned here)', () => {
    expect(findLinks('See https://en.wikipedia.org/wiki/Foo_(bar) too').map((link) => link.url)).toEqual([
      'https://en.wikipedia.org/wiki/Foo_',
    ]);
  });

  it('accepts www. and bare domain forms that the parser later prefixes with https://', () => {
    expect(findLinks('www.example.org/a and example.com/page').map((link) => link.url)).toEqual([
      'www.example.org/a',
      'example.com/page',
    ]);
  });

  it('ignores wiki links and plain words', () => {
    expect(findLinks('[[Isaac Asimov]] wrote Foundation in 1951.')).toEqual([]);
  });
});
