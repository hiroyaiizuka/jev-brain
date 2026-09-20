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

/** Upstream comparator, kept verbatim so the stored order of existing settings does not change. */
const byLowerCase = (a: string, b: string): number => (a.toLowerCase() < b.toLowerCase() ? -1 : 1);

export const createEmptyHierarchyLowerCase = (): HierarchyLowerCase => ({
  hidden: [],
  abstract: [],
  concrete: [],
  parents: [],
  children: [],
  leftFriends: [],
  rightFriends: [],
  previous: [],
  next: [],
});

/**
 * Normalises the ontology loaded from data.json. Pure: the input is not
 * mutated and the result only depends on the argument.
 *
 * - Missing regions get their default. Up/Down start empty so existing
 *   settings behave as before; `hidden` keeps upstream's `[""]` placeholder;
 *   `leftFriends` migrates the pre-0.2 `friends` list.
 * - Regions are processed in {@link HIERARCHY_REGIONS} order; a field already
 *   claimed by an earlier region is dropped (compared as Dataview keys).
 * - Each region is sorted case-insensitively, as upstream did.
 */
export const buildHierarchyLowerCase = (hierarchy: Partial<Hierarchy> | null | undefined): NormalizedHierarchy => {
  const source: Partial<Hierarchy> = hierarchy ?? {};
  const input: Record<HierarchyRegion, string[]> = {
    hidden: source.hidden ?? [""],
    abstract: source.abstract ?? [],
    concrete: source.concrete ?? [],
    parents: source.parents ?? DEFAULT_HIERARCHY_DEFINITION.parents,
    children: source.children ?? DEFAULT_HIERARCHY_DEFINITION.children,
    leftFriends: source.leftFriends ?? source.friends ?? DEFAULT_HIERARCHY_DEFINITION.leftFriends,
    rightFriends: source.rightFriends ?? DEFAULT_HIERARCHY_DEFINITION.rightFriends,
    previous: source.previous ?? DEFAULT_HIERARCHY_DEFINITION.previous,
    next: source.next ?? DEFAULT_HIERARCHY_DEFINITION.next,
  };

  const taken = new Set<string>();
  const regions = createEmptyHierarchyLowerCase();
  const hierarchyLowerCase = createEmptyHierarchyLowerCase();
  for (const region of HIERARCHY_REGIONS) {
    const fields = input[region].filter((field) => !taken.has(toHierarchyKey(field))).sort(byLowerCase);
    const keys = fields.map(toHierarchyKey);
    keys.forEach((key) => taken.add(key));
    regions[region] = fields;
    hierarchyLowerCase[region] = keys;
  }

  const exclusions = (source.exclusions ?? DEFAULT_HIERARCHY_DEFINITION.exclusions)
    .filter((field) => !taken.has(toHierarchyKey(field)))
    .sort(byLowerCase);

  return {
    hierarchy: { ...source, ...regions, exclusions },
    hierarchyLowerCase,
  };
};

/**
 * Which axis a relation's field belongs to, or null for Parents/Children,
 * friends, inferred links and everything else. Accepts the field as written
 * or as a Dataview key.
 */
export const axisOf = (
  field: string,
  hierarchyLowerCase: Pick<HierarchyLowerCase, HierarchyAxis>,
): HierarchyAxis | null => {
  const key = toHierarchyKey(field);
  if (hierarchyLowerCase.abstract.includes(key)) return "abstract";
  if (hierarchyLowerCase.concrete.includes(key)) return "concrete";
  return null;
};
