import { describe, expect, it } from 'vitest';
import type { Hierarchy } from 'src/Types';
import {
  DIRECTION_QUESTION,
  FIELD_QUESTION,
  buildQuestions,
  directionOfField,
  judge,
  type JevResponse,
} from 'src/jev/judge';

const hierarchy: Hierarchy = {
  hidden: ['secret'],
  abstract: ['part of', 'up'],
  concrete: ['down', 'example'],
  parents: ['origin'],
  children: ['child'],
  leftFriends: ['jump'],
  rightFriends: ['similar'],
  previous: ['previous'],
  next: ['next'],
  exclusions: ['tags'],
};

const emptyHierarchy: Hierarchy = {
  hidden: [], abstract: [], concrete: [], parents: [], children: [],
  leftFriends: [], rightFriends: [], previous: [], next: [], exclusions: [],
};

/** The settings' order: Up, Down, Parents, Children, left, right, previous, next. */
const settingsOrder = ['part of', 'up', 'down', 'example', 'origin', 'child', 'jump', 'similar', 'previous', 'next'];

const response = (
  field: string,
  direction: string,
  probabilities: Record<string, number> = { [field]: 0.9 },
  directionProbabilities: Record<string, number> = { [direction]: 0.95 },
): JevResponse => ({
  questions: {
    [FIELD_QUESTION]: { choice: field, probabilities },
    [DIRECTION_QUESTION]: { choice: direction, probabilities: directionProbabilities },
  },
});

describe('buildQuestions', () => {
  it('offers every field of the ontology but the hidden and excluded ones', () => {
    const questions = buildQuestions(hierarchy);

    expect(Object.keys(questions[FIELD_QUESTION].criteria)).toEqual(settingsOrder);
  });

  it('describes a candidate with its region and its direction', () => {
    const { criteria } = buildQuestions(hierarchy)[FIELD_QUESTION];

    expect(criteria['up']).toBe('Up（抽象）・方向: 親');
    expect(criteria['example']).toBe('Down（具体）・方向: 子');
    expect(criteria['origin']).toBe('Parents・方向: 親');
    expect(criteria['child']).toBe('Children・方向: 子');
    expect(criteria['jump']).toBe('左友・方向: 左友');
    expect(criteria['similar']).toBe('右友・方向: 右友');
    expect(criteria['previous']).toBe('前・方向: 前');
    expect(criteria['next']).toBe('次・方向: 次');
  });

  it('carries what each question asks', () => {
    const questions = buildQuestions(hierarchy);

    expect(questions[FIELD_QUESTION].question).toBe('このリンクに付けるフィールド');
    expect(questions[DIRECTION_QUESTION].question).toBe('このリンクの方向');
  });

  it('asks for one of the six directions', () => {
    expect(buildQuestions(hierarchy)[DIRECTION_QUESTION].criteria).toEqual({
      parent: '親', child: '子', leftFriend: '左友', rightFriend: '右友', previous: '前', next: '次',
    });
  });

  it('keeps the six directions when the ontology is empty', () => {
    const questions = buildQuestions(emptyHierarchy);

    expect(questions[FIELD_QUESTION].criteria).toEqual({});
    expect(Object.keys(questions[DIRECTION_QUESTION].criteria)).toHaveLength(6);
  });
});

// LEV-186: 精度テストが criteria を組み替えるためのオプション。既定の挙動は上の describe が固定している。
describe('buildQuestions の criteria オプション', () => {
  it('changes nothing when no option is given, which is what the plugin sends', () => {
    expect(buildQuestions(hierarchy, {})).toEqual(buildQuestions(hierarchy));
  });

  it('offers only the fields asked for, in the settings\' order', () => {
    const { criteria } = buildQuestions(hierarchy, { fields: ['next', 'UP', 'part-of'] })[FIELD_QUESTION];

    // Asked out of order and in another spelling; the settings' order and the written name win.
    expect(Object.keys(criteria)).toEqual(['part of', 'up', 'next']);
    expect(criteria['up']).toBe('Up（抽象）・方向: 親');
  });

  it('ignores a field the ontology does not have, and falls back to all of them when none is left', () => {
    expect(Object.keys(buildQuestions(hierarchy, { fields: ['up', 'プロジェクト'] })[FIELD_QUESTION].criteria))
      .toEqual(['up']);
    // A Choice question with no candidate has no answer, so an empty selection offers everything.
    expect(Object.keys(buildQuestions(hierarchy, { fields: ['プロジェクト'] })[FIELD_QUESTION].criteria))
      .toEqual(settingsOrder);
    expect(Object.keys(buildQuestions(hierarchy, { fields: [] })[FIELD_QUESTION].criteria)).toEqual(settingsOrder);
  });

  it('appends a note to the fields it is given and leaves the others as they were', () => {
    const { criteria } = buildQuestions(hierarchy, {
      fieldNotes: { 'PART OF': '例: 「章は本の part of」', jump: '  ', unknown: '出ない' },
    })[FIELD_QUESTION];

    expect(criteria['part of']).toBe('Up（抽象）・方向: 親。例: 「章は本の part of」');
    expect(criteria['jump']).toBe('左友・方向: 左友');
    expect(criteria['up']).toBe('Up（抽象）・方向: 親');
    expect(criteria).not.toHaveProperty('unknown');
  });

  it('appends a sentence to the directions it is given', () => {
    const { criteria } = buildQuestions(hierarchy, {
      directionNotes: { leftFriend: '同じ段の似た話題', previous: '' },
    })[DIRECTION_QUESTION];

    expect(criteria.leftFriend).toBe('左友。同じ段の似た話題');
    expect(criteria.previous).toBe('前');
    expect(criteria.parent).toBe('親');
  });

  it('takes the narrowing and the notes together', () => {
    const questions = buildQuestions(hierarchy, {
      fields: ['up', 'next'],
      fieldNotes: { next: '例: 「次の章」' },
      directionNotes: { next: '時系列で後' },
    });

    expect(questions[FIELD_QUESTION].criteria).toEqual({
      up: 'Up（抽象）・方向: 親',
      next: '次・方向: 次。例: 「次の章」',
    });
    expect(questions[DIRECTION_QUESTION].criteria.next).toBe('次。時系列で後');
  });
});

describe('directionOfField', () => {
  it('gives Up the direction of Parents and Down the direction of Children', () => {
    expect(directionOfField('up', hierarchy)).toBe('parent');
    expect(directionOfField('part of', hierarchy)).toBe('parent');
    expect(directionOfField('down', hierarchy)).toBe('child');
    expect(directionOfField('example', hierarchy)).toBe('child');
  });

  it('reads a field written as a Dataview key', () => {
    expect(directionOfField('Part Of', hierarchy)).toBe('parent');
    expect(directionOfField('part-of', hierarchy)).toBe('parent');
  });

  it('has no direction for a field outside the ontology', () => {
    expect(directionOfField('secret', hierarchy)).toBeNull();
    expect(directionOfField('tags', hierarchy)).toBeNull();
    expect(directionOfField('', hierarchy)).toBeNull();
  });
});

describe('judge', () => {
  it('is confident when the field and the direction agree, and ranks by probability', () => {
    const result = judge(
      response('origin', 'parent', { origin: 0.7, up: 0.2, child: 0.1 }),
      hierarchy,
    );

    expect(result.confident).toBe(true);
    expect(result.field).toBe('origin');
    expect(result.direction).toBe('parent');
    expect(result.directionProbability).toBe(0.95);
    expect(result.ordered).toEqual([
      { field: 'origin', probability: 0.7 },
      { field: 'up', probability: 0.2 },
      { field: 'child', probability: 0.1 },
    ]);
  });

  it('leaves out the fields the answer said nothing about (LEV-187)', () => {
    const result = judge(response('origin', 'parent', { origin: 0.7, up: 0.2, child: 0.1 }), hierarchy);

    expect(result.ordered.map((candidate) => candidate.field)).toEqual(['origin', 'up', 'child']);
    expect(result.ordered.every((candidate) => candidate.probability !== undefined)).toBe(true);
  });

  it('does not offer a label the ontology does not carry', () => {
    const result = judge(response('origin', 'parent', { origin: 0.6, Origins: 0.4 }), hierarchy);

    expect(result.ordered).toEqual([{ field: 'origin', probability: 0.6 }]);
  });

  it('ignores a probability that is not a number', () => {
    const result = judge(response('origin', 'parent', { origin: Number.NaN, up: 0.2 }), hierarchy);

    expect(result.ordered).toEqual([{ field: 'up', probability: 0.2 }]);
  });

  it('breaks a tie with the settings’ order', () => {
    const result = judge(response('child', 'child', { child: 0.4, up: 0.4, 'part of': 0.2 }), hierarchy);

    expect(result.ordered.slice(0, 3).map((candidate) => candidate.field)).toEqual(['up', 'child', 'part of']);
  });

  it('reads a direction whose case or spacing differs', () => {
    const result = judge(response('jump', ' LeftFriend '), hierarchy);

    expect(result.direction).toBe('leftFriend');
    expect(result.confident).toBe(true);
  });

  it('has no direction when the answer is none of the six', () => {
    const result = judge(response('origin', 'sideways'), hierarchy);

    expect(result.direction).toBeNull();
    expect(result.confident).toBe(false);
  });

  it('is confident for an Up field answered as a parent and a Down field as a child', () => {
    expect(judge(response('up', 'parent'), hierarchy).confident).toBe(true);
    expect(judge(response('example', 'child'), hierarchy).confident).toBe(true);
    expect(judge(response('up', 'child'), hierarchy).confident).toBe(false);
    expect(judge(response('down', 'parent'), hierarchy).confident).toBe(false);
  });

  it('keeps the same order and the same probabilities when they disagree (LEV-187)', () => {
    const result = judge(response('origin', 'leftFriend', { origin: 0.9, jump: 0.1 }), hierarchy);

    expect(result.confident).toBe(false);
    expect(result.probabilities).toEqual({ origin: 0.9, jump: 0.1 });
    // 自信なしでも並びは確率順のまま。無くなるのは既定の選択だけで、それは呼び出し側が決める。
    expect(result.ordered).toEqual([{ field: 'origin', probability: 0.9 }, { field: 'jump', probability: 0.1 }]);
  });

  it('is not confident about a field the ontology does not carry', () => {
    expect(judge(response('secret', 'parent'), hierarchy).confident).toBe(false);
    expect(judge(response('unknown', 'parent'), hierarchy).confident).toBe(false);
  });

  it('puts the current field first, keeping its probability and Q1’s answer apart', () => {
    const result = judge(
      response('origin', 'parent', { origin: 0.7, up: 0.2, child: 0.1 }),
      hierarchy,
      { currentField: 'up' },
    );

    expect(result.ordered).toEqual([
      { field: 'up', probability: 0.2 },
      { field: 'origin', probability: 0.7 },
      { field: 'child', probability: 0.1 },
    ]);
    expect(result.field).toBe('origin');
  });

  it('puts the current field back in the ontology’s spelling', () => {
    const result = judge(response('origin', 'parent'), hierarchy, { currentField: 'Part Of' });

    // 候補は本人が押せば Vault に入る綴りなので、呼び出し側の書き方をそのまま出さない。
    expect(result.ordered[0]).toEqual({ field: 'part of' });
  });

  it('puts the current field first when it is not confident too', () => {
    const result = judge(response('origin', 'child'), hierarchy, { currentField: 'similar' });
    const fields = result.ordered.map((candidate) => candidate.field);

    // 応答が確率を返さなかった現在のフィールドは、確率なしのまま先頭に置く（付け替えの入口）。
    expect(result.ordered).toEqual([{ field: 'similar' }, { field: 'origin', probability: 0.9 }]);
    expect(fields.filter((field) => field === 'similar')).toHaveLength(1);
  });

  it('gives the current field one of the five places', () => {
    const result = judge(
      response('origin', 'parent', { origin: 0.5, up: 0.2, child: 0.1, jump: 0.09, similar: 0.08, next: 0.03 }),
      hierarchy,
      { currentField: 'previous' },
    );

    expect(result.ordered.map((candidate) => candidate.field))
      .toEqual(['previous', 'origin', 'up', 'child', 'jump']);
  });

  it('offers nothing but the current field when the ontology is empty', () => {
    const result = judge(response('origin', 'parent'), emptyHierarchy);

    expect(result.confident).toBe(false);
    expect(result.ordered).toEqual([]);
    expect(judge(response('origin', 'parent'), emptyHierarchy, { currentField: 'origin' }).ordered)
      .toEqual([{ field: 'origin' }]);
  });
});

/** 本人の決定（2026-09-22）: 確率順の上位 5 件まで、四捨五入で 0% になる候補は出さない。 */
describe('judge の候補の数（LEV-187）', () => {
  /** Eight candidates with a probability, so the cut has something to cut. */
  const eight = { origin: 0.3, up: 0.2, child: 0.15, jump: 0.12, similar: 0.1, next: 0.07, down: 0.04, example: 0.02 };

  it('offers the five most likely of eight candidates', () => {
    const result = judge(response('origin', 'parent', eight), hierarchy);

    expect(result.ordered).toEqual([
      { field: 'origin', probability: 0.3 },
      { field: 'up', probability: 0.2 },
      { field: 'child', probability: 0.15 },
      { field: 'jump', probability: 0.12 },
      { field: 'similar', probability: 0.1 },
    ]);
  });

  it('cuts to the same five when Jev is not confident', () => {
    const result = judge(response('origin', 'leftFriend', eight), hierarchy);

    expect(result.confident).toBe(false);
    expect(result.ordered.map((candidate) => candidate.field)).toEqual(['origin', 'up', 'child', 'jump', 'similar']);
  });

  it('leaves out a candidate that would read 0%, and keeps the one that rounds to 1%', () => {
    const result = judge(response('origin', 'parent', { origin: 0.9, up: 0.09, child: 0.005, jump: 0.004 }), hierarchy);

    expect(result.ordered.map((candidate) => candidate.field)).toEqual(['origin', 'up', 'child']);
  });

  it('offers all of them when there are fewer than five', () => {
    const result = judge(response('origin', 'parent', { origin: 0.6, up: 0.3, child: 0.1 }), hierarchy);

    expect(result.ordered).toHaveLength(3);
  });

  it('lets the caller ask for another number and another floor', () => {
    const result = judge(response('origin', 'parent', eight), hierarchy, { maxCandidates: 2, minProbability: 0.2 });

    expect(result.ordered).toEqual([{ field: 'origin', probability: 0.3 }, { field: 'up', probability: 0.2 }]);
    expect(judge(response('origin', 'parent', eight), hierarchy, { maxCandidates: 0 }).ordered).toEqual([]);
  });

  it('reads the thresholds off the whole answer, not off the five it offers', () => {
    const result = judge(response('origin', 'parent', eight), hierarchy);

    expect(result.probabilities).toEqual(eight);
  });
});

/** 絞り込みが「Jev が選んだのはどれか」を変えないこと（LEV-187 のレビュー指摘）。 */
describe('judge の chosen', () => {
  it('resolves Q1’s answer to the ontology’s spelling, with its probability', () => {
    const result = judge(response('Part Of', 'parent', { 'part of': 0.7, up: 0.3 }), hierarchy);

    expect(result.chosen).toEqual({ field: 'part of', probability: 0.7 });
    expect(result.field).toBe('Part Of');
  });

  it('keeps the answer even when the top five left it out', () => {
    const result = judge(
      response('next', 'next', { origin: 0.3, up: 0.2, child: 0.15, jump: 0.12, similar: 0.1, next: 0.004 }),
      hierarchy,
    );

    // 出す候補からは 0.4% として落ちるが、答えとしては残る。確率もそのまま。
    expect(result.ordered.map((candidate) => candidate.field)).not.toContain('next');
    expect(result.chosen).toEqual({ field: 'next', probability: 0.004 });
    expect(result.confident).toBe(true);
  });

  it('keeps the answer even when the response gave it no probability', () => {
    const result = judge(response('child', 'child', { up: 0.6, origin: 0.4 }), hierarchy);

    expect(result.chosen).toEqual({ field: 'child', probability: undefined });
    expect(result.confident).toBe(true);
  });

  it('is null for an answer the ontology does not carry', () => {
    expect(judge(response('invented', 'parent'), hierarchy).chosen).toBeNull();
    expect(judge(response('secret', 'parent'), hierarchy).chosen).toBeNull();
    expect(judge(response('origin', 'parent'), emptyHierarchy).chosen).toBeNull();
  });
});
