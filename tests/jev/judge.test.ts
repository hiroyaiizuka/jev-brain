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

  it('breaks a tie with the settings’ order', () => {
    const result = judge(response('child', 'child', { child: 0.4, up: 0.4, 'part of': 0.2 }), hierarchy);

    expect(result.ordered.map((candidate) => candidate.field)).toEqual(['up', 'child', 'part of']);
  });

  it('is confident for an Up field answered as a parent and a Down field as a child', () => {
    expect(judge(response('up', 'parent'), hierarchy).confident).toBe(true);
    expect(judge(response('example', 'child'), hierarchy).confident).toBe(true);
    expect(judge(response('up', 'child'), hierarchy).confident).toBe(false);
    expect(judge(response('down', 'parent'), hierarchy).confident).toBe(false);
  });

  it('falls back to the settings’ order without probabilities when they disagree', () => {
    const result = judge(response('origin', 'leftFriend', { origin: 0.9, jump: 0.1 }), hierarchy);

    expect(result.confident).toBe(false);
    expect(result.probabilities).toEqual({ origin: 0.9, jump: 0.1 });
    expect(result.ordered.map((candidate) => candidate.field)).toEqual(settingsOrder);
    expect(result.ordered.every((candidate) => candidate.probability === undefined)).toBe(true);
  });

  it('is not confident about a field the ontology does not carry', () => {
    expect(judge(response('secret', 'parent'), hierarchy).confident).toBe(false);
    expect(judge(response('unknown', 'parent'), hierarchy).confident).toBe(false);
  });

  it('puts the current field first, keeping its probability', () => {
    const result = judge(
      response('origin', 'parent', { origin: 0.7, up: 0.2, child: 0.1 }),
      hierarchy,
      'up',
    );

    expect(result.ordered).toEqual([
      { field: 'up', probability: 0.2 },
      { field: 'origin', probability: 0.7 },
      { field: 'child', probability: 0.1 },
    ]);
  });

  it('puts the current field first when it is not confident too', () => {
    const result = judge(response('origin', 'child'), hierarchy, 'similar');
    const fields = result.ordered.map((candidate) => candidate.field);

    expect(fields[0]).toBe('similar');
    expect(fields.filter((field) => field === 'similar')).toHaveLength(1);
    expect(fields).toHaveLength(settingsOrder.length);
  });

  it('offers nothing but the current field when the ontology is empty', () => {
    const result = judge(response('origin', 'parent'), emptyHierarchy);

    expect(result.confident).toBe(false);
    expect(result.ordered).toEqual([]);
    expect(judge(response('origin', 'parent'), emptyHierarchy, 'origin').ordered).toEqual([{ field: 'origin' }]);
  });
});
