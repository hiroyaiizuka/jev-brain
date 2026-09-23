import { describe, expect, it } from 'vitest';
import en from 'src/lang/locale/en';
import ja from 'src/lang/locale/ja';
import { directionLabel, fill } from 'src/lang/jev';

/** LEV-175: the queue and the suggester speak through `src/lang`, and ja covers their strings. */

describe('fill', () => {
  it('fills every placeholder by name', () => {
    expect(fill('{calls} · {tokens}', { calls: '2', tokens: '1,200' })).toBe('2 · 1,200');
  });

  it('keeps a `$` in the value as it is', () => {
    expect(fill('Jev: added {written}', { written: 'up:: [[$& notes]]' })).toBe('Jev: added up:: [[$& notes]]');
  });

  it('leaves a placeholder it has no value for', () => {
    expect(fill('{field} and {other}', { field: 'up' })).toBe('up and {other}');
  });
});

describe('directionLabel', () => {
  it('writes the direction in the plugin language (en in the tests)', () => {
    expect(directionLabel('leftFriend')).toBe('left friend');
    expect(directionLabel('parent')).toBe('parent');
  });
});

describe('ja locale for Jev', () => {
  /**
   * The strings LEV-175 put on screen in Japanese. Listed rather than matched by prefix, so a key another
   * ticket adds to en (falling back to English until someone translates it) does not fail this test.
   */
  const TRANSLATED: (keyof typeof en)[] = [
    'JEV_QUEUE_TITLE', 'JEV_QUEUE_OPEN', 'JEV_QUEUE_NO_CENTRE', 'JEV_QUEUE_NO_CENTRE_SHORT', 'JEV_QUEUE_EMPTY',
    'JEV_QUEUE_COUNT', 'JEV_QUEUE_ASKING', 'JEV_QUEUE_FAILED', 'JEV_QUEUE_RETRY', 'JEV_QUEUE_DEFERRED',
    'JEV_QUEUE_BACK', 'JEV_QUEUE_LATER', 'JEV_QUEUE_DIRECTION', 'JEV_QUEUE_UNCERTAIN', 'JEV_QUEUE_CONFIRM',
    'JEV_QUEUE_CONFIRM_NONE', 'JEV_QUEUE_NO_CHANGE', 'JEV_QUEUE_LINK_GONE', 'JEV_QUEUE_UNDO',
    'JEV_QUEUE_UNDO_MISSING', 'JEV_QUEUE_WRITE_FAILED', 'JEV_QUEUE_UNDO_FAILED', 'JEV_QUEUE_USAGE',
    'JEV_QUEUE_TOGGLE',
    'JEV_DIRECTION_PARENT', 'JEV_DIRECTION_CHILD', 'JEV_DIRECTION_LEFT_FRIEND', 'JEV_DIRECTION_RIGHT_FRIEND',
    'JEV_DIRECTION_PREVIOUS', 'JEV_DIRECTION_NEXT',
    'JEV_SUGGEST_ASKING', 'JEV_SUGGEST_UNCONFIDENT', 'JEV_SUGGEST_WRITE_FAILED', 'JEV_SUGGEST_ALREADY_TYPED',
    'JEV_SUGGEST_LINK_GONE', 'JEV_SUGGEST_ADDED', 'JEV_SUGGEST_ADDED_UNLOGGED',
  ];

  it('translates every string of the queue, the tools-panel button, the directions and the suggester', () => {
    expect(TRANSLATED.filter((key) => !(key in ja))).toEqual([]);
  });

  it('keeps every placeholder of the English string', () => {
    const placeholders = (text: string): string[] => (text.match(/\{\w+\}/gu) ?? []).sort();
    for (const key of Object.keys(ja) as (keyof typeof en)[]) {
      expect(placeholders((ja as Partial<typeof en>)[key] ?? ''), key).toEqual(placeholders(en[key]));
    }
  });

  it('has no key that English lacks', () => {
    expect(Object.keys(ja).filter((key) => !(key in en))).toEqual([]);
  });
});
