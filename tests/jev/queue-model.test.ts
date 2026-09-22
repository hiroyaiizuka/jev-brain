import { beforeEach, describe, expect, it } from 'vitest';
import type { UntypedLink } from 'src/jev/collect';
import type { Judgement } from 'src/jev/judge';
import { JevQueueModel, estimateCostJpy, type JevQueueCard } from 'src/jev/queue-model';

const NOTE = 'notes/中心.md';

const link = (target: string, offset = 4): UntypedLink => ({
  target,
  displayText: target.replace(/\.md$/u, ''),
  line: 0,
  ch: 4,
  offset,
  length: target.length + 4,
  context: `see [[${target}]] here`,
});

const judgement = (field: string, confident = true): Judgement => ({
  field,
  probabilities: { [field]: 0.92 },
  direction: 'parent',
  directionProbability: 0.95,
  confident,
  // Q1 の答えをオントロジーの綴りで解決したもの（`judge` が候補を絞る前に決める）。
  chosen: { field, probability: 0.92 },
  // 自信ありでも自信なしでも `judge` が返す候補は同じ（確率順の上位 5 件、LEV-187）。
  // 変わるのはカードの既定の選択だけ。
  ordered: [{ field, probability: 0.92 }, { field: 'origin', probability: 0.05 }],
});

const card = (model: JevQueueModel, target: string): JevQueueCard => {
  const found = model.card(target);
  if (!found) throw new Error(`no card for ${target}`);
  return found;
};

let model: JevQueueModel;

beforeEach(() => {
  model = new JevQueueModel();
});

describe('setNote', () => {
  it('turns the collected links into cards that are waiting for Jev', () => {
    model.setNote(NOTE, [link('a.md'), link('b.md', 30)]);

    expect(model.list.map((c) => [c.offset, c.length])).toEqual([[4, 8], [30, 8]]);
    expect(model.notePath).toBe(NOTE);
    expect(model.list.map((c) => [c.target, c.status])).toEqual([['a.md', 'pending'], ['b.md', 'pending']]);
    expect(model.pending().map((c) => c.target)).toEqual(['a.md', 'b.md']);
  });

  it('empties the queue when no note is in the centre', () => {
    model.setNote(NOTE, [link('a.md')]);

    model.setNote(null, [link('a.md')]);

    expect(model.list).toEqual([]);
    expect(model.notePath).toBeNull();
  });

  it('starts the count of this note at zero', () => {
    model.setNote(NOTE, [link('a.md')]);
    model.recordCall(2_000);

    model.setNote('notes/別.md', [link('a.md')]);

    expect(model.usage).toEqual({ calls: 0, inputTokens: 0, costJpy: 0 });
  });
});

describe('open → done → 取り消し', () => {
  beforeEach(() => {
    model.setNote(NOTE, [link('a.md')]);
  });

  it('opens the card on a confident judgement with the first candidate selected', () => {
    expect(model.judged('a.md', judgement('up'))).toBe(true);

    expect(card(model, 'a.md').status).toBe('open');
    expect(card(model, 'a.md').selected).toBe('up');
  });

  it('preselects the answer of Q1, not whatever sorted to the front of the candidates', () => {
    // `ordered` は出す用に絞ってあるので、その先頭は Q1 の答えとは限らない（LEV-187 で
    // 「現在のフィールド」が先頭に来る付け替えも同じ）。カードが書くのは答えのほう。
    model.judged('a.md', {
      ...judgement('up'),
      chosen: { field: 'up', probability: 0.3 },
      ordered: [{ field: 'origin', probability: 0.4 }, { field: 'up', probability: 0.3 }],
    });

    expect(card(model, 'a.md').selected).toBe('up');
  });

  it('takes the ontologys spelling from judge, not the answer as Jev wrote it', () => {
    model.judged('a.md', {
      ...judgement('Part Of'),
      chosen: { field: 'part of', probability: 0.8 },
      ordered: [{ field: 'part of', probability: 0.8 }, { field: 'up', probability: 0.1 }],
    });

    expect(card(model, 'a.md').selected).toBe('part of');
  });

  it('preselects nothing when the answer is outside the ontology', () => {
    // `judge` が解決できなかった答え。別のフィールドを選んだ状態にすると、本人が確定を
    // 押すだけで Jev が答えていない型が入る。
    model.judged('a.md', {
      ...judgement('invented'),
      chosen: null,
      ordered: [{ field: 'up', probability: 0.5 }, { field: 'origin', probability: 0.2 }],
    });

    expect(card(model, 'a.md').selected).toBeNull();
  });

  it('preselects the answer even when the top five left it out (LEV-187)', () => {
    // 出す候補は 5 件で切られるが、既定にするのは `chosen`。絞り込みが書く内容を変えない。
    model.judged('a.md', {
      ...judgement('steps'),
      chosen: { field: 'steps', probability: 0.004 },
      ordered: [{ field: 'up', probability: 0.5 }, { field: 'origin', probability: 0.2 }],
    });

    expect(card(model, 'a.md').selected).toBe('steps');
  });

  it('preselects nothing when the field and the direction disagree', () => {
    model.judged('a.md', judgement('up', false));

    expect(card(model, 'a.md').status).toBe('open');
    expect(card(model, 'a.md').selected).toBeNull();
  });

  it('keeps the candidates and their probabilities when it is not confident (LEV-187)', () => {
    model.judged('a.md', judgement('up', false));

    // 出す候補は自信ありのときと同じ並び。カードは `ordered` をそのまま描く。
    expect(card(model, 'a.md').judgement?.ordered)
      .toEqual([{ field: 'up', probability: 0.92 }, { field: 'origin', probability: 0.05 }]);
  });

  it('writes down what was confirmed', () => {
    model.judged('a.md', judgement('up'));

    expect(model.confirm('a.md', { field: 'up', text: 'up:: [[a]]', logId: 'log-1' })).toBe(true);

    expect(card(model, 'a.md').status).toBe('done');
    expect(card(model, 'a.md').write).toEqual({ field: 'up', text: 'up:: [[a]]', logId: 'log-1' });
  });

  it('comes back to open after the undo, keeping the candidates', () => {
    model.judged('a.md', judgement('up'));
    model.confirm('a.md', { field: 'up', text: 'up:: [[a]]', logId: 'log-1' });

    expect(model.undone('a.md')).toBe(true);

    expect(card(model, 'a.md').status).toBe('open');
    expect(card(model, 'a.md').write).toBeNull();
    expect(card(model, 'a.md').judgement?.field).toBe('up');
    expect(card(model, 'a.md').selected).toBe('up');
  });

  it('refuses to confirm a card that has no answer yet, or to undo one that was not written', () => {
    expect(model.confirm('a.md', { field: 'up', text: 'up:: [[a]]', logId: 'log-1' })).toBe(false);
    expect(model.undone('a.md')).toBe(false);

    expect(card(model, 'a.md').status).toBe('pending');
  });

  it('lets another candidate be picked while the card is open, but not after it is written', () => {
    model.judged('a.md', judgement('up'));

    expect(model.select('a.md', 'origin')).toBe(true);
    expect(card(model, 'a.md').selected).toBe('origin');

    model.confirm('a.md', { field: 'origin', text: 'origin:: [[a]]', logId: 'log-1' });
    expect(model.select('a.md', 'up')).toBe(false);
    expect(card(model, 'a.md').selected).toBe('origin');
  });
});

describe('open → later → 戻す', () => {
  beforeEach(() => {
    model.setNote(NOTE, [link('a.md'), link('b.md')]);
  });

  it('puts an answered card aside and brings it back open', () => {
    model.judged('a.md', judgement('up'));

    expect(model.defer('a.md')).toBe(true);
    expect(card(model, 'a.md').status).toBe('later');

    expect(model.restore('a.md')).toBe(true);
    expect(card(model, 'a.md').status).toBe('open');
    expect(card(model, 'a.md').selected).toBe('up');
  });

  it('brings a card that was never asked back to waiting, so the caller asks again', () => {
    model.defer('a.md');

    model.restore('a.md');

    expect(card(model, 'a.md').status).toBe('pending');
    expect(model.pending().map((c) => c.target)).toEqual(['a.md', 'b.md']);
  });

  it('does not ask Jev about a card left for later', () => {
    model.defer('b.md');

    expect(model.pending().map((c) => c.target)).toEqual(['a.md']);
  });

  it('keeps the answer of a card deferred while the request was in flight', () => {
    model.defer('a.md');

    expect(model.judged('a.md', judgement('up'))).toBe(true);

    expect(card(model, 'a.md').status).toBe('later');
    expect(card(model, 'a.md').judgement?.field).toBe('up');
  });

  it('refuses to defer a card that is already written', () => {
    model.judged('a.md', judgement('up'));
    model.confirm('a.md', { field: 'up', text: 'up:: [[a]]', logId: 'log-1' });

    expect(model.defer('a.md')).toBe(false);
    expect(card(model, 'a.md').status).toBe('done');
  });

  it('remembers later for the rest of the session, per note and target', () => {
    model.defer('a.md');

    model.setNote('notes/別.md', [link('a.md'), link('b.md')]);
    expect(model.list.map((c) => c.status)).toEqual(['pending', 'pending']);

    model.setNote(NOTE, [link('a.md'), link('b.md')]);
    expect(model.list.map((c) => [c.target, c.status])).toEqual([['a.md', 'later'], ['b.md', 'pending']]);
  });

  it('forgets later once the card is brought back', () => {
    model.defer('a.md');
    model.restore('a.md');

    model.setNote(NOTE, [link('a.md')]);

    expect(card(model, 'a.md').status).toBe('pending');
  });
});

describe('失敗した呼び出し', () => {
  beforeEach(() => {
    model.setNote(NOTE, [link('a.md')]);
  });

  it('marks the card and offers it to the queue again on a retry', () => {
    expect(model.failed('a.md')).toBe(true);
    expect(card(model, 'a.md').status).toBe('failed');
    expect(model.pending()).toEqual([]);

    expect(model.retry('a.md')).toBe(true);
    expect(model.pending().map((c) => c.target)).toEqual(['a.md']);
  });

  it('can be left for later as well', () => {
    model.failed('a.md');

    expect(model.defer('a.md')).toBe(true);
    expect(card(model, 'a.md').status).toBe('later');
  });

  it('is not marked failed once the answer is in', () => {
    model.judged('a.md', judgement('up'));

    expect(model.failed('a.md')).toBe(false);
    expect(card(model, 'a.md').status).toBe('open');
  });
});

describe('usage', () => {
  it('counts the calls and the tokens of this note and estimates the cost', () => {
    model.setNote(NOTE, [link('a.md'), link('b.md')]);

    model.recordCall(2_000);
    model.recordCall(3_000);

    expect(model.usage.calls).toBe(2);
    expect(model.usage.inputTokens).toBe(5_000);
    expect(model.usage.costJpy).toBeCloseTo(estimateCostJpy(5_000), 10);
  });

  it('prices 1M input tokens at the 0.042 USD and 150 JPY/USD of the design', () => {
    expect(estimateCostJpy(1_000_000)).toBeCloseTo(6.3, 10);
  });
});
