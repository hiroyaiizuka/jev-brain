import type { Hierarchy } from "../Types";
import { DEFAULT_HIERARCHY_DEFINITION } from "../constants/constants";

/**
 * Ontology regions in the order duplicates are resolved. A field written in
 * several regions stays in the earliest one and is dropped from the later
 * ones, so Up (abstract) wins over Parents and Down (concrete) over Children
 * (docs/ontology-axis-design.md §1). `exclusions` is handled separately: it is
 * filtered against every region but never lower-cased.
 */
export const HIERARCHY_REGIONS = [
  "hidden",
  "abstract",
  "concrete",
  "parents",
  "children",
  "leftFriends",
  "rightFriends",
  "previous",
  "next",
] as const;

export type HierarchyRegion = (typeof HIERARCHY_REGIONS)[number];

/** The two regions that give a link a level in 3D: Up (+1) and Down (−1). */
export type HierarchyAxis = "abstract" | "concrete";

/** Field names of each region as Dataview keys (see {@link toHierarchyKey}). */
export type HierarchyLowerCase = Record<HierarchyRegion, string[]>;

export type NormalizedHierarchy = {
  /** Settings to keep: missing regions filled with defaults, duplicates removed, sorted case-insensitively. */
  hierarchy: Hierarchy;
  /** The same lists as Dataview keys, in the same order. */
  hierarchyLowerCase: HierarchyLowerCase;
};

/** Dataview's key form of a field name: lower case, spaces replaced by hyphens. */
export const toHierarchyKey = (field: string): string => field.toLowerCase().replaceAll(" ", "-");

/**
 * Upstream's sort order for ontology lists, kept verbatim (it never returns 0)
 * so the stored order of existing settings does not change. The settings tab
 * and the ontology modal sort with the same rule.
 */
export const compareFieldsIgnoringCase = (a: string, b: string): number =>
  a.toLowerCase() < b.toLowerCase() ? -1 : 1;

const emptyRegions = (): HierarchyLowerCase =>
  Object.fromEntries(HIERARCHY_REGIONS.map((region) => [region, [] as string[]])) as HierarchyLowerCase;

export const createEmptyHierarchyLowerCase = emptyRegions;

/**
 * What a region falls back to when data.json does not carry a list for it.
 * `hidden` keeps upstream's `[""]` placeholder (the settings tab shows it as an
 * empty text area) and `leftFriends` migrates the pre-0.2 `friends` list.
 * Up/Down default to the empty lists in `DEFAULT_HIERARCHY_DEFINITION`, so
 * existing settings behave as before.
 */
const defaultFor = (region: HierarchyRegion, source: Partial<Hierarchy>): string[] => {
  if (region === "hidden") return [""];
  if (region === "leftFriends" && Array.isArray(source.friends)) return source.friends;
  return DEFAULT_HIERARCHY_DEFINITION[region];
};

/** Upstream replaced any falsy value with the default; a non-array (a hand-edited data.json) gets the same treatment. */
const listOrDefault = (value: unknown, fallback: () => string[]): string[] =>
  Array.isArray(value) ? (value as string[]) : fallback();

/**
 * Normalises the ontology loaded from data.json. Pure: the input is not
 * mutated and the result only depends on the argument.
 *
 * - Missing or malformed regions get their default (see {@link defaultFor}).
 * - Regions are processed in {@link HIERARCHY_REGIONS} order; a field already
 *   claimed by an earlier region is dropped (compared as Dataview keys).
 * - Each region is sorted with {@link compareFieldsIgnoringCase}, as upstream did.
 * - Only the regions and `exclusions` are returned: the legacy `friends` list
 *   is consumed by the migration and unknown keys are not carried over.
 */
export const buildHierarchyLowerCase = (hierarchy: Partial<Hierarchy> | null | undefined): NormalizedHierarchy => {
  const source: Partial<Hierarchy> = hierarchy ?? {};
  const taken = new Set<string>();
  const regions = emptyRegions();
  const hierarchyLowerCase = emptyRegions();
  for (const region of HIERARCHY_REGIONS) {
    const fields = listOrDefault(source[region], () => defaultFor(region, source))
      .filter((field) => !taken.has(toHierarchyKey(field)))
      .sort(compareFieldsIgnoringCase);
    const keys = fields.map(toHierarchyKey);
    keys.forEach((key) => taken.add(key));
    regions[region] = fields;
    hierarchyLowerCase[region] = keys;
  }

  const exclusions = listOrDefault(source.exclusions, () => DEFAULT_HIERARCHY_DEFINITION.exclusions)
    .filter((field) => !taken.has(toHierarchyKey(field)))
    .sort(compareFieldsIgnoringCase);

  return {
    hierarchy: { ...regions, exclusions },
    hierarchyLowerCase,
  };
};

/**
 * Which axis a relation belongs to, or null for Parents/Children, friends,
 * inferred links (no definition) and everything else.
 *
 * `typeDefinition` is what Page/Link carry: one field, or several joined with
 * ", " when a note reaches the same neighbour through more than one field.
 * Fields may be written as in the note or as Dataview keys. Up wins over Down
 * when both are present; empty entries are ignored.
 */
export const axisOf = (
  typeDefinition: string | null | undefined,
  hierarchyLowerCase: Pick<HierarchyLowerCase, HierarchyAxis>,
): HierarchyAxis | null => {
  if (!typeDefinition) return null;
  const keys = typeDefinition
    .split(",")
    .map((field) => toHierarchyKey(field.trim()))
    .filter((key) => key !== "");
  if (keys.some((key) => hierarchyLowerCase.abstract.includes(key))) return "abstract";
  if (keys.some((key) => hierarchyLowerCase.concrete.includes(key))) return "concrete";
  return null;
};
