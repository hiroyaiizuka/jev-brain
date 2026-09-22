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

/**
 * A Jev Choice question: what is asked and the candidate labels with their
 * descriptions (§7, 255 candidates at most). `client.ts` wraps it in whatever
 * envelope the endpoint takes.
 */
export type Choice = {
  question: string;
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

/**
 * One field to offer, with the probability Q1 gave it. A typed link's current field is the only
 * candidate that can come without one: it is offered because it is already written, not because
 * Jev ranked it.
 */
export type Candidate = {
  field: string;
  probability?: number;
};

/** How many candidates a judgement offers (§2-3, 本人の決定 2026-09-22「上位 5 件」). */
export const MAX_CANDIDATES = 5;

/**
 * The lowest probability a candidate can have and still be offered: below it `Math.round(p * 100)`
 * is 0 and the line would read "0%" (§2-3「四捨五入で 0% になる候補は出さない」).
 */
export const MIN_CANDIDATE_PROBABILITY = 0.005;

/** What a judgement offers, when the caller wants something other than §2-3's defaults. */
export type JudgeOptions = {
  /** A typed link's field, put first so the offer reads as a change of type (§4-1). */
  currentField?: string;
  /** At most this many candidates. Default {@link MAX_CANDIDATES}. */
  maxCandidates?: number;
  /** Candidates under this probability are left out. Default {@link MIN_CANDIDATE_PROBABILITY}. */
  minProbability?: number;
};

export type Judgement = {
  /**
   * Q1's answer: the 第一候補 the thresholds of §2-4 are read against. `ordered[0]` is
   * not the same thing — a typed link puts its current field there.
   */
  field: string;
  /** Q1's probabilities as they came back, for the thresholds and the log; they only mean something when `confident`. */
  probabilities: Record<string, number>;
  /** Q2's answer, or null when it is none of the six directions. */
  direction: Direction | null;
  directionProbability: number;
  /** Q1's answer sits in a region whose direction is Q2's answer. */
  confident: boolean;
  /**
   * What to offer, and the only list a UI should show: the fields of the ontology by
   * probability, {@link MAX_CANDIDATES} at most and none that would read "0%" (§2-3). Confident
   * or not, the list is the same one — only the default pick goes away when it is not (§2-3, so
   * nothing suggests a pick). A typed link's current field comes first.
   */
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
    [FIELD_QUESTION]: { question: "このリンクに付けるフィールド", criteria: fieldCriteria },
    [DIRECTION_QUESTION]: { question: "このリンクの方向", criteria: directionCriteria },
  };
};

/** The direction the settings give a field, or null for a field outside the ontology. */
export const directionOfField = (field: string, hierarchy: Hierarchy): Direction | null => {
  const key = toHierarchyKey(field ?? "");
  const entry = fieldEntries(hierarchy).find((candidate) => toHierarchyKey(candidate.field) === key);
  return entry ? REGION_TO_DIRECTION[entry.region] : null;
};

/** Q2's answer as one of the six directions, or null when it is none of them; case and spaces are forgiven, as they are for a field name. */
const toDirection = (answer: string): Direction | null => {
  const normalised = (answer ?? "").trim().toLowerCase();
  return (Object.keys(DIRECTION_LABELS) as Direction[]).find(
    (direction) => direction.toLowerCase() === normalised,
  ) ?? null;
};

/** The probability of one label, matched the way a field name is; a missing or non-numeric value reads as none. */
const probabilityOf = (probabilities: Record<string, number>, label: string): number | undefined => {
  const key = toHierarchyKey(label ?? "");
  if (!probabilities || key === "") return undefined;
  const found = Object.entries(probabilities).find(([candidate]) => toHierarchyKey(candidate) === key);
  return found && Number.isFinite(found[1]) ? found[1] : undefined;
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
 * §2-3. Confident means Q1's field has the direction Q2 answered; when it is not, the same
 * candidates come back and only the default pick goes away, which the UI says in words.
 */
export const judge = (
  response: JevResponse,
  hierarchy: Hierarchy,
  { currentField, maxCandidates = MAX_CANDIDATES, minProbability = MIN_CANDIDATE_PROBABILITY }: JudgeOptions = {},
): Judgement => {
  const questions = response.questions ?? {};
  const fieldAnswer = questions[FIELD_QUESTION];
  const directionAnswer = questions[DIRECTION_QUESTION];
  const field = fieldAnswer?.choice ?? "";
  const probabilities = fieldAnswer?.probabilities ?? {};
  const direction = toDirection(directionAnswer?.choice);
  const directionProbability = probabilityOf(directionAnswer?.probabilities, directionAnswer?.choice) ?? 0;

  const entries = fieldEntries(hierarchy);
  const expected = entries.find((entry) => toHierarchyKey(entry.field) === toHierarchyKey(field));
  const confident = expected ? REGION_TO_DIRECTION[expected.region] === direction : false;

  // Candidates always come from the ontology: a label the response invented never becomes a line to
  // write. A field the response said nothing about has no probability to rank or to show, so it is
  // left out along with the ones that would read "0%" (§2-3). A stable sort keeps the settings'
  // order for equal probabilities.
  const ranked: { field: string; probability: number }[] = [];
  for (const entry of entries) {
    const probability = probabilityOf(probabilities, entry.field);
    if (probability !== undefined && probability >= minProbability) ranked.push({ field: entry.field, probability });
  }
  ranked.sort((left, right) => right.probability - left.probability);
  const ordered = currentField ? currentFieldFirst(ranked, currentField) : ranked;

  return {
    field,
    probabilities,
    direction,
    directionProbability,
    confident,
    // The current field takes one of the places, so a re-type reads as short as a first type.
    ordered: ordered.slice(0, Math.max(0, maxCandidates)),
  };
};
