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
 * The lowest probability a candidate can have and still be offered: below it {@link percentOf}
 * is 0 and the line would read "0%" (§2-3「四捨五入で 0% になる候補は出さない」).
 */
export const MIN_CANDIDATE_PROBABILITY = 0.005;

/**
 * A probability as the whole percent every entrance writes. The threshold above is this rounding,
 * so the three screens share it rather than each rounding their own way and printing "0%" again.
 */
export const percentOf = (probability: number): number => Math.round(probability * 100);

/** What a judgement offers, when the caller wants something other than §2-3's defaults. */
export type JudgeOptions = {
  /** A typed link's field, put first so the offer reads as a change of type (§4-1). */
  currentField?: string;
  /** At most this many candidates, the current field included. Default {@link MAX_CANDIDATES}. */
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
   * Q1's answer as the ontology spells it, or null when the answer is not a field of the
   * ontology. This — not `ordered[0]`, and not a scan of `ordered` — is what Jev picked: the
   * default pick and the field a write puts in the note come from here, so that narrowing
   * `ordered` for the screen can never change what gets written.
   */
  chosen: Candidate | null;
  /**
   * What to offer, and the only list a UI should show: the fields of the ontology by
   * probability, {@link MAX_CANDIDATES} at most and none that would read "0%" (§2-3). Confident
   * or not, the list is the same one — only the default pick goes away when it is not (§2-3, so
   * nothing suggests a pick). A typed link's current field comes first, and the cap counts it.
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
 * second copy of the questions. Left out, the questions are exactly what §2-3
 * describes; the plugin passes `criteria.ts`'s default (narrowed fields and the
 * direction notes, §2-4, LEV-164).
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

/**
 * A criteria note dictionary keyed the way a field name is matched, built once so the
 * lookup inside the loop stays O(1): with the examples lever the questions are rebuilt
 * for every note judged, and a scan per candidate would be O(fields²) each time.
 * An earlier spelling wins, as the ontology's own duplicate resolution does.
 */
const notesByKey = (notes: Readonly<Record<string, string>>): Map<string, string> => {
  const byKey = new Map<string, string>();
  for (const [candidate, note] of Object.entries(notes)) {
    const key = toHierarchyKey(candidate);
    if (!byKey.has(key)) byKey.set(key, note.trim());
  }
  return byKey;
};

const withNote = (description: string, note: string): string => (note === "" ? description : `${description}。${note}`);

/**
 * Q1 「このリンクに付けるフィールド」 over the whole ontology and Q2
 * 「このリンクの方向」 over the six directions. A description is the region and
 * the direction; the author's own wording is appended here once the settings
 * carry it. `options` shapes the criteria (see {@link CriteriaOptions}) and
 * changes nothing when it is left out.
 */
export const buildQuestions = (hierarchy: Hierarchy, options: CriteriaOptions = {}): Questions => {
  const entries = fieldEntries(hierarchy);
  const wanted = options.fields ? new Set(options.fields.map(toHierarchyKey)) : null;
  const narrowed = wanted ? entries.filter((entry) => wanted.has(toHierarchyKey(entry.field))) : entries;
  const offered = narrowed.length > 0 ? narrowed : entries;
  const fieldNotes = notesByKey(options.fieldNotes ?? {});
  const directionNotes = options.directionNotes ?? {};

  const fieldCriteria: Record<string, string> = {};
  for (const { field, region } of offered) {
    const description = `${REGION_LABELS[region]}・方向: ${DIRECTION_LABELS[REGION_TO_DIRECTION[region]]}`;
    fieldCriteria[field] = withNote(description, fieldNotes.get(toHierarchyKey(field)) ?? "");
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

/**
 * Moves the link's current field to the front, keeping the probability it already had (§2-2).
 * A current field the ranking left out is added back in the ontology's spelling, because the
 * candidate a UI shows is the string a confirmation writes — never the caller's own wording.
 */
const currentFieldFirst = (ordered: Candidate[], currentField: string, entries: FieldEntry[]): Candidate[] => {
  const key = toHierarchyKey(currentField);
  const current = ordered.find((candidate) => toHierarchyKey(candidate.field) === key);
  const spelling = entries.find((entry) => toHierarchyKey(entry.field) === key)?.field ?? currentField;
  return [
    current ?? { field: spelling },
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
  // Q1 の答えをオントロジーの中で 1 度だけ解決する。綴りも方向の突き合わせもここから引くので、
  // 出す候補をいくら絞っても「Jev が選んだのはどれか」は変わらない。
  const answer = entries.find((entry) => toHierarchyKey(entry.field) === toHierarchyKey(field));
  const confident = answer ? REGION_TO_DIRECTION[answer.region] === direction : false;
  const chosen: Candidate | null = answer
    ? { field: answer.field, probability: probabilityOf(probabilities, answer.field) }
    : null;

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
  const ordered = currentField ? currentFieldFirst(ranked, currentField, entries) : ranked;

  return {
    field,
    probabilities,
    direction,
    directionProbability,
    confident,
    chosen,
    // The current field takes one of the places, so a re-type reads as short as a first type.
    ordered: ordered.slice(0, Math.max(0, maxCandidates)),
  };
};
