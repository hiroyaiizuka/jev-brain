import { describe, expect, it } from 'vitest';
import { suggestNoticeFor } from 'src/Components/JevSuggestLinkCommand';

/**
 * The hotkey command's only UI of its own (LEV-172): one Notice when the suggestion could not
 * open. What it opens is tests/suggesters/jev-link-suggest.test.ts (`openAt`).
 */

describe('suggestNoticeFor', () => {
  it('says nothing when the popup opened: the popup is the answer', () => {
    expect(suggestNoticeFor({ status: 'opened', target: 'B' })).toBeNull();
    expect(suggestNoticeFor({ status: 'opened', target: 'B', currentField: 'down' })).toBeNull();
  });

  it('tells each reason apart', () => {
    expect(suggestNoticeFor({ status: 'no-link' })).toBe('Put the cursor on a [[link]] in the body of the note.');
    expect(suggestNoticeFor({ status: 'inactive' })).toBe(
      'Jev is turned off or has no API key. Reload the plugin after changing that.',
    );
    expect(suggestNoticeFor({ status: 'no-dataview' })).toBe('Jev needs Dataview to read the fields of your notes.');
    expect(suggestNoticeFor({ status: 'excluded' })).toContain('left out of the graph');
    expect(suggestNoticeFor({ status: 'typed-elsewhere', target: 'C' })).toBe(
      '[[C]] is typed by a field of the other note, so this note has nothing to change.',
    );
    expect(suggestNoticeFor({ status: 'hidden', target: "Q&A $' H" })).toBe(
      "[[Q&A $' H]] is joined by a hidden field, so Jev leaves it alone.",
    );
  });
});
