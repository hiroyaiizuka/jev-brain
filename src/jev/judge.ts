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

/** One field to offer, with its probability when the judgement is confident. */
export type Candidate = {
  field: string;
  probability?: number;
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
   * What to offer, and the only list a UI should show: every field of the ontology, by
   * probability when confident and in the settings' order without probabilities when not
   * (§2-3, so nothing suggests a pick). A typed link's current field comes first.
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
 * Ways the JEV-0 re-measurement (LEV-186) may shape the criteria, so the two
 * conditions of design §10「criteria の説明文を厚くして再測」 can be asked without a
 * second copy of the questions. Left out — which is what the plugin does — the
 * questions are exactly what §2-3 describes.
 */
export type CriteriaOptions = {
  /**
   * Offer only these fields in Q1, matched the way a field name is. The settings'
   * order is kept and a name the ontology does not have is ignored; a selection
   * that leaves nothing falls back to the whole ontology, since a Choice question
   * with no candidate has no answer.
   */
  fields?: readonly string[];
  /** A sentence appended to one field's description, keyed by field name. */
  fieldNotes?: Readonly<Record<string, string>>;
  /** A sentence appended to one direction's description. */
  directionNotes?: Readonly<Partial<Record<Direction, string>>>;
};

/** One entry of a criteria note dictionary, matched the way a field name is. */
const noteFor = (notes: Readonly<Record<string, string>>, label: string): string => {
  const key = toHierarchyKey(label);
  const found = Object.entries(notes).find(([candidate]) => toHierarchyKey(candidate) === key);
  return found?.[1]?.trim() ?? "";
};

const withNote = (description: string, note: string): string => (note === "" ? description : `${description}。${note}`);

/**
 * Q1 「このリンクに付けるフィールド」 over the whole ontology and Q2
 * 「このリンクの方向」 over the six directions. A description is the region and
 * the direction; the author's own wording is appended here once the settings
 * carry it. `options` is the measurement's lever (see {@link CriteriaOptions})
 * and changes nothing when it is left out.
 */
export const buildQuestions = (hierarchy: Hierarchy, options: CriteriaOptions = {}): Questions => {
  const entries = fieldEntries(hierarchy);
  const wanted = options.fields ? new Set(options.fields.map(toHierarchyKey)) : null;
  const narrowed = wanted ? entries.filter((entry) => wanted.has(toHierarchyKey(entry.field))) : entries;
  const offered = narrowed.length > 0 ? narrowed : entries;
  const fieldNotes = options.fieldNotes ?? {};
  const directionNotes = options.directionNotes ?? {};

  const fieldCriteria: Record<string, string> = {};
  for (const { field, region } of offered) {
    const description = `${REGION_LABELS[region]}・方向: ${DIRECTION_LABELS[REGION_TO_DIRECTION[region]]}`;
    fieldCriteria[field] = withNote(description, noteFor(fieldNotes, field));
  }
  const directionCriteria: Record<string, string> = {};
  for (const direction of Object.keys(DIRECTION_LABELS) as Direction[]) {
    directionCriteria[direction] = withNote(DIRECTION_LABELS[direction], directionNotes[direction]?.trim() ?? "");
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
  const direction = toDirection(directionAnswer?.choice);
  const directionProbability = probabilityOf(directionAnswer?.probabilities, directionAnswer?.choice) ?? 0;

  const entries = fieldEntries(hierarchy);
  const expected = entries.find((entry) => toHierarchyKey(entry.field) === toHierarchyKey(field));
  const confident = expected ? REGION_TO_DIRECTION[expected.region] === direction : false;

  // Candidates always come from the ontology: a field the response leaves out stays offerable and a
  // label the response invented never becomes a line to write. A stable sort keeps the settings'
  // order for equal probabilities and for the fields the response said nothing about.
  const ordered: Candidate[] = confident
    ? entries
        .map((entry) => ({ field: entry.field, probability: probabilityOf(probabilities, entry.field) }))
        .sort((left, right) => (right.probability ?? -1) - (left.probability ?? -1))
    : entries.map((entry) => ({ field: entry.field }));

  return {
    field,
    probabilities,
    direction,
    directionProbability,
    confident,
    ordered: currentField ? currentFieldFirst(ordered, currentField) : ordered,
  };
};
