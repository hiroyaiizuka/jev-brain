/**
 * The criteria the plugin sends by default (docs/jev-link-typer-design.md §2-4, LEV-164): Q1 offers
 * only the fields the vault already uses often enough, and each of Q2's six directions carries one
 * sentence of what it means. This is JEV-0's `narrow,directions` condition
 * (artifacts/jev-accuracy/record-v2.md), handed to `buildQuestions` as {@link CriteriaOptions}.
 */
import type { Page } from "../graph/Page";
import type { Pages } from "../graph/Pages";
import type { JevSettings, Relation } from "../Types";
import { toHierarchyKey } from "../utils/hierarchy";
import directionNotes from "./direction-notes.json";
import type { CriteriaOptions, Direction } from "./judge";

/**
 * One sentence per direction, appended to Q2's label. `scripts/jev-accuracy-judge.mjs` reads the
 * same JSON, so what JEV-0 measured is what the plugin sends.
 */
export const DIRECTION_NOTES: Readonly<Record<Direction, string>> = Object.freeze(directionNotes);

/** Field uses keyed by {@link toHierarchyKey}: case and surrounding spaces do not split a count. */
export type FieldUsage = ReadonlyMap<string, number>;

/** The definitions a relation carries, one list per kind. A hidden link has none, so it is never counted. */
const DEFINITION_KEYS = [
  "parentTypeDefinition",
  "childTypeDefinition",
  "leftFriendTypeDefinition",
  "rightFriendTypeDefinition",
  "previousFriendTypeDefinition",
  "nextFriendTypeDefinition",
] as const satisfies readonly (keyof Relation)[];

/** What {@link countFieldUsage} reads of the index: every page with its path, as `Pages.forEach` hands them. */
export type PageIndex = { forEach(callback: (page: Page, path: string) => void): void };

const SEPARATOR = "\u0000";

// 索引は再構築のたびに新しい Pages になる（excalibrain-main.ts の createIndex）ので、Pages を鍵にすれば
// 世代ごとに 1 度だけ数える。古い世代は WeakMap から消える。
const usageCache = new WeakMap<Pages, FieldUsage>();

/**
 * How many links of the index use each field. `up:: [[B]]` in A sits on both pages (A's parent and
 * B's child, each with the definition `up`), so a use is one field on one pair of pages, counted once
 * whichever side it is read from. Inferred links carry no definition and are not uses.
 */
export const countFieldUsage = (pages: PageIndex): FieldUsage => {
  const seen = new Set<string>();
  const usage = new Map<string, number>();
  pages.forEach((page, path) => {
    page.neighbours.forEach((relation, neighbourPath) => {
      const pair = path < neighbourPath ? path + SEPARATOR + neighbourPath : neighbourPath + SEPARATOR + path;
      for (const key of DEFINITION_KEYS) {
        for (const definition of relation[key]?.split(", ") ?? []) {
          const field = toHierarchyKey(definition.trim());
          const use = pair + SEPARATOR + field;
          if (field === "" || seen.has(use)) continue;
          seen.add(use);
          usage.set(field, (usage.get(field) ?? 0) + 1);
        }
      }
    });
  });
  return usage;
};

/** {@link countFieldUsage} of the current index, counted once per rebuild; empty before the index exists. */
export const fieldUsage = (plugin: { pages?: Pages }): FieldUsage => {
  const pages = plugin.pages;
  if (!pages) return new Map();
  let usage = usageCache.get(pages);
  if (!usage) {
    usage = countFieldUsage(pages);
    usageCache.set(pages, usage);
  }
  return usage;
};

/**
 * The default criteria: the fields used at least `candidateMinUses` times, and the direction notes.
 * `candidateMinUses` of 0 offers every field. A threshold nothing reaches — a new vault, an index not
 * built yet — narrows to nothing, and `buildQuestions` then offers the whole ontology.
 */
export const criteriaOptions = (
  settings: Pick<JevSettings, "candidateMinUses">,
  usage: FieldUsage,
): CriteriaOptions => {
  const minUses = settings.candidateMinUses;
  const options: CriteriaOptions = { directionNotes: DIRECTION_NOTES };
  if (minUses > 0) {
    options.fields = [...usage].filter(([, count]) => count >= minUses).map(([field]) => field);
  }
  return options;
};

/** {@link criteriaOptions} of the plugin's settings and index: what the three entrances pass to `buildQuestions`. */
export const pluginCriteria = (plugin: { settings: { jev: JevSettings }; pages?: Pages }): CriteriaOptions =>
  criteriaOptions(plugin.settings.jev, fieldUsage(plugin));
