/**
 * The two questions of one judgement and the reading of Jev's answer
 * (docs/jev-link-typer-design.md §2-3). Pure: the call itself lives in
 * `client.ts`, which hands the recorded shape of the response in.
 */
import type { Hierarchy } from "../Types";
import { HIERARCHY_REGIONS, toHierarchyKey, type HierarchyRegion } from "../utils/hierarchy";

/** The six answers of Q2 「このリンクの方向」. */
export type Direction = "parent" | "child" | "leftFriend" | "rightFriend" | "previous" | "next";

const DIRECTION_LABELS: Record<Direction, string> = {
  parent: "親",
  child: "子",
  leftFriend: "左友",
  rightFriend: "右友",
  previous: "前",
  next: "次",
};

/** Regions a link can be typed with: every region but `hidden`, which is never offered. */
export type FieldRegion = Exclude<HierarchyRegion, "hidden">;

const FIELD_REGIONS: FieldRegion[] = HIERARCHY_REGIONS.filter(
  (region): region is FieldRegion => region !== "hidden",
);

const REGION_LABELS: Record<FieldRegion, string> = {
  abstract: "Up（抽象）",
  concrete: "Down（具体）",
  parents: "Parents",
  children: "Children",
  leftFriends: "左友",
  rightFriends: "右友",
  previous: "前",
  next: "次",
};

/**
 * Region → direction, the one place a field's direction is decided. Up shares
 * the north with Parents and Down the south with Children
 * (docs/ontology-axis-design.md §1), so they answer Q2 the same way.
 */
export const REGION_TO_DIRECTION: Record<FieldRegion, Direction> = {
  abstract: "parent",
  concrete: "child",
  parents: "parent",
  children: "child",
  leftFriends: "leftFriend",
  rightFriends: "rightFriend",
  previous: "previous",
  next: "next",
};

/** Names the two questions are sent and answered under. */
export const FIELD_QUESTION = "field";
export const DIRECTION_QUESTION = "direction";

/** A Jev Choice question: candidate label → description (§7, 255 candidates at most). */
export type Choice = {
  criteria: Record<string, string>;
};

export type Questions = {
  [FIELD_QUESTION]: Choice;
  [DIRECTION_QUESTION]: Choice;
};

/** The part of Jev's response this module reads; `client.ts` owns the whole envelope. */
export type ChoiceAnswer = {
  choice: string;
  probabilities: Record<string, number>;
};

export type JevResponse = {
  questions: Record<string, ChoiceAnswer>;
};

/** One field to offer, with its probability when the judgement is confident. */
export type Candidate = {
  field: string;
  probability?: number;
};

export type Judgement = {
  /** Q1's answer. */
  field: string;
  /** Q1's probabilities, whatever the confidence; hiding them is the caller's call (§2-3). */
  probabilities: Record<string, number>;
  /** Q2's answer. */
  direction: string;
  directionProbability: number;
  /** Q1's answer sits in a region whose direction is Q2's answer. */
  confident: boolean;
  /** What to offer: by probability when confident, else the settings' order. */
  ordered: Candidate[];
};

type FieldEntry = { field: string; region: FieldRegion };

/**
 * Every field of the ontology in the settings' order, each with its region. A
 * field written in two regions keeps the earlier one, as `buildHierarchyLowerCase`
 * resolves it.
 */
const fieldEntries = (hierarchy: Hierarchy): FieldEntry[] => {
  const seen = new Set<string>();
  const entries: FieldEntry[] = [];
  for (const region of FIELD_REGIONS) {
    for (const field of hierarchy[region] ?? []) {
      const key = toHierarchyKey(field);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      entries.push({ field, region });
    }
  }
  return entries;
};

/**
 * Q1 「このリンクに付けるフィールド」 over the whole ontology and Q2
 * 「このリンクの方向」 over the six directions. A description is the region and
 * the direction; the author's own wording is appended here once the settings
 * carry it.
 */
export const buildQuestions = (hierarchy: Hierarchy): Questions => {
  const fieldCriteria: Record<string, string> = {};
  for (const { field, region } of fieldEntries(hierarchy)) {
    fieldCriteria[field] = `${REGION_LABELS[region]}・方向: ${DIRECTION_LABELS[REGION_TO_DIRECTION[region]]}`;
  }
  const directionCriteria: Record<string, string> = {};
  for (const direction of Object.keys(DIRECTION_LABELS) as Direction[]) {
    directionCriteria[direction] = DIRECTION_LABELS[direction];
  }
  return {
    [FIELD_QUESTION]: { criteria: fieldCriteria },
    [DIRECTION_QUESTION]: { criteria: directionCriteria },
  };
};

/** The direction the settings give a field, or null for a field outside the ontology. */
export const directionOfField = (field: string, hierarchy: Hierarchy): Direction | null => {
  const key = toHierarchyKey(field ?? "");
  const entry = fieldEntries(hierarchy).find((candidate) => toHierarchyKey(candidate.field) === key);
  return entry ? REGION_TO_DIRECTION[entry.region] : null;
};

/** Moves the link's current field to the front, keeping the probability it already had (§2-2). */
const currentFieldFirst = (ordered: Candidate[], currentField: string): Candidate[] => {
  const key = toHierarchyKey(currentField);
  const current = ordered.find((candidate) => toHierarchyKey(candidate.field) === key);
  return [
    current ?? { field: currentField },
    ...ordered.filter((candidate) => toHierarchyKey(candidate.field) !== key),
  ];
};

/**
 * Reads one response: Q1's answer, Q2's answer and the consistency check of
 * §2-3. Confident means Q1's field has the direction Q2 answered; otherwise the
 * candidates come back in the settings' order without probabilities, so nothing
 * suggests a first pick.
 */
export const judge = (response: JevResponse, hierarchy: Hierarchy, currentField?: string): Judgement => {
  const questions = response.questions ?? {};
  const fieldAnswer = questions[FIELD_QUESTION];
  const directionAnswer = questions[DIRECTION_QUESTION];
  const field = fieldAnswer?.choice ?? "";
  const probabilities = fieldAnswer?.probabilities ?? {};
  const direction = directionAnswer?.choice ?? "";
  const directionProbability = directionAnswer?.probabilities?.[direction] ?? 0;

  const expected = directionOfField(field, hierarchy);
  const confident = expected !== null && expected === direction;

  const order = fieldEntries(hierarchy).map((entry) => entry.field);
  const ranks = new Map(order.map((field, index) => [toHierarchyKey(field), index]));
  const rank = (candidate: string): number => ranks.get(toHierarchyKey(candidate)) ?? order.length;
  const ordered: Candidate[] = confident
    ? Object.entries(probabilities)
        .sort(([leftField, left], [rightField, right]) =>
          right - left || rank(leftField) - rank(rightField))
        .map(([candidate, probability]) => ({ field: candidate, probability }))
    : order.map((candidate) => ({ field: candidate }));

  return {
    field,
    probabilities,
    direction,
    directionProbability,
    confident,
    ordered: currentField ? currentFieldFirst(ordered, currentField) : ordered,
  };
};
