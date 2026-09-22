import { describe, expect, it } from 'vitest';
import { noticeFor } from 'src/Components/JevTypeLinkCommand';

/**
 * The command's only UI: one Notice per run (LEV-170). The wiring itself is
 * tests/jev/typeLink.test.ts; here only the wording of each outcome is fixed.
 */

describe('noticeFor', () => {
  it('names the field, the link, the probability and the tokens of a written line', () => {
    expect(
      noticeFor({
        status: 'written',
        field: 'up',
        target: 'B',
        probability: 0.82,
        inputTokens: 1873,
        logged: true,
      }),
    ).toBe('Jev wrote up:: [[B]] (82%, 1873 tokens).');
  });

  it('keeps a note name with $ in it intact', () => {
    // `String.replace` would expand `$'` into the rest of the template and leave the later
    // placeholders unfilled; the name comes from the vault, so it has to pass through as written.
    const message = noticeFor({
      status: 'written',
      field: 'up',
      target: "Q&A $' メモ",
      probability: 0.5,
      inputTokens: 100,
      logged: true,
    });
    expect(message).toBe("Jev wrote up:: [[Q&A $' メモ]] (50%, 100 tokens).");
  });

  it('says a written line cannot be undone when the record could not be written', () => {
    const message = noticeFor({
      status: 'written', field: 'up', target: 'B', probability: 0.82, inputTokens: 1873, logged: false,
    });
    expect(message).toContain('cannot be undone');
  });

  it('shows a question mark when the response gave no probability for its own answer', () => {
    expect(noticeFor({ status: 'written', field: 'up', target: 'B', logged: true }))
      .toBe('Jev wrote up:: [[B]] (?%, 0 tokens).');
  });

  it('tells the two unconfident cases apart and shows the first three candidates', () => {
    const candidates = ['up', 'down', 'origin', 'similar'];
    expect(noticeFor({ status: 'unconfident', reason: 'direction', target: 'B', answer: 'up', candidates }))
      .toBe('Jev is not sure about [[B]]: the field and the direction disagree. Candidates: up, down, origin. Nothing was written.');
    expect(noticeFor({ status: 'unconfident', reason: 'unknown-field', target: 'B', answer: '謎', candidates }))
      .toBe('Jev answered "謎" for [[B]], which is not a field of your ontology. Nothing was written.');
  });

  it('adds no Notice of its own when the request did not reach Jev', () => {
    // `client.ts` already showed one; a second would only repeat it.
    expect(noticeFor({ status: 'failed' })).toBeNull();
  });

  it('has a message for every other outcome', () => {
    expect(noticeFor({ status: 'no-index' })).toContain('index');
    expect(noticeFor({ status: 'excluded' })).toContain('left out of the graph');
    expect(noticeFor({ status: 'no-untyped-link' })).toContain('cursor');
    expect(noticeFor({ status: 'unchanged', field: 'up', target: 'B' }))
      .toBe('Nothing was written for up:: [[B]]: the line is already there, or inline writing could not find the link in the body.');
  });
});
