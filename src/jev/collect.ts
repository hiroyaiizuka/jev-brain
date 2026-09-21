import type { App, LinkCache, TFile } from "obsidian";
import type { Page } from "src/graph/Page";
import { RelationType, type Relation } from "src/Types";

/**
 * One `[[X]]` of a note's body that no ontology field reaches yet: the input of the
 * suggester, of the queue and of the bulk run (docs/jev-link-typer-design.md §2-1).
 */
export type UntypedLink = {
  /** The target as `Pages` keys it: the resolved file's path, or the link text when the file does not exist. */
  target: string;
  /** The alias when the link has one, the link text otherwise. */
  displayText: string;
  /** Where the `[[` starts, 0-based, as `metadataCache` reports it. */
  line: number;
  ch: number;
  /** The line the link sits on, trimmed. */
  context: string;
};

/** The same occurrence for a link the note already types, with the fields it is typed with. */
export type TypedLink = UntypedLink & { fields: string[] };

/** `[text](https://…)`, `mailto:` and the like. `metadataCache` lists them next to the wiki links. */
const EXTERNAL_LINK = /^(?:[a-z][a-z\d+\-.]*:\/\/|mailto:)/iu;

/**
 * The link's target without its `#heading` / `#^block`, percent-decoded when the link is
 * written in markdown (Obsidian escapes spaces there, Dataview decodes them back).
 * `getPathOrSelf` (src/utils/dataview.ts) reads a field's link the same way, so a target
 * is keyed alike whether it comes from the body or from a field.
 */
const linkpathOf = (link: LinkCache): string => {
  const linkpath = link.link.split("#")[0];
  if (link.original.startsWith("[[")) return linkpath;
  try {
    return decodeURIComponent(linkpath);
  } catch {
    return linkpath;
  }
};

/**
 * The `*TypeDefinition` of every slot in which the relation is defined by a field.
 * Empty for a relation that only comes from the link itself (`RelationType.INFERRED`),
 * which is what makes the link untyped.
 */
const definedSlots = (relation: Relation | undefined): (string | undefined)[] => {
  if (!relation) return [];
  const slots: (string | undefined)[] = [];
  if (relation.isParent && relation.parentType === RelationType.DEFINED) slots.push(relation.parentTypeDefinition);
  if (relation.isChild && relation.childType === RelationType.DEFINED) slots.push(relation.childTypeDefinition);
  if (relation.isLeftFriend && relation.leftFriendType === RelationType.DEFINED) slots.push(relation.leftFriendTypeDefinition);
  if (relation.isRightFriend && relation.rightFriendType === RelationType.DEFINED) slots.push(relation.rightFriendTypeDefinition);
  if (relation.isNextFriend && relation.nextFriendType === RelationType.DEFINED) slots.push(relation.nextFriendTypeDefinition);
  if (relation.isPreviousFriend && relation.previousFriendType === RelationType.DEFINED) slots.push(relation.previousFriendTypeDefinition);
  return slots;
};

/** A slot carries one field or several joined with ", " (`Page.addParent`); the same field counts once. */
const fieldsOf = (slots: (string | undefined)[]): string[] => {
  const fields = new Set<string>();
  for (const slot of slots) {
    (slot ?? "")
      .split(",")
      .map((field) => field.trim())
      .filter((field) => field !== "")
      .forEach((field) => fields.add(field));
  }
  return Array.from(fields);
};

type Occurrence = { link: UntypedLink; relation: Relation | undefined };

/**
 * The note's wiki links paired with the relation the graph already holds for their target.
 * Embeds are left out because `metadataCache` keeps them in `embeds`, not in `links`.
 * Dropped here: URLs, the note itself, `excludeFilepaths`, and every occurrence of a
 * target after the first one.
 */
const occurrencesOf = (app: App, page: Page, file: TFile, content: string): Occurrence[] => {
  const links = app.metadataCache.getFileCache(file)?.links;
  if (!links) return [];

  // The Dataview index is lazy, so every link would look untyped until the graph is drawn
  // once. Page.getNeighbours() primes it the same way; the neighbours' own fields matter
  // because they define the relation from the other side.
  page.addDVFieldLinksToPage();
  page.neighbours.forEach((neighbour) => neighbour.target.addDVFieldLinksToPage());

  const lines = content.split("\n");
  const seen = new Set<string>();
  const occurrences: Occurrence[] = [];
  for (const link of links) {
    if (EXTERNAL_LINK.test(link.link)) continue;
    const linkpath = linkpathOf(link);
    if (linkpath === "") continue;
    const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path)?.path ?? linkpath;
    if (target === file.path || seen.has(target)) continue;
    if (page.plugin.settings.excludeFilepaths.some((path) => target.startsWith(path))) continue;
    seen.add(target);
    occurrences.push({
      link: {
        target,
        displayText: link.displayText ?? linkpath,
        line: link.position.start.line,
        ch: link.position.start.col,
        context: (lines[link.position.start.line] ?? "").trim(),
      },
      relation: page.neighbours.get(target),
    });
  }
  return occurrences;
};

/**
 * The links of `file` that no field types yet. A target reached through a hidden field is
 * left out as well: the note already says what to do with it (design §2-1).
 * `content` is the note's text; only each link's `context` is read from it.
 */
export const collectUntypedLinks = (app: App, page: Page, file: TFile, content: string): UntypedLink[] =>
  occurrencesOf(app, page, file, content)
    .filter(({ relation }) => !relation?.isHidden && definedSlots(relation).length === 0)
    .map(({ link }) => link);

/** The links of `file` that a field already types, for the review of existing types (design §5). */
export const collectTypedLinks = (app: App, page: Page, file: TFile, content: string): TypedLink[] =>
  occurrencesOf(app, page, file, content)
    .filter(({ relation }) => !relation?.isHidden && definedSlots(relation).length > 0)
    .map(({ link, relation }) => ({ ...link, fields: fieldsOf(definedSlots(relation)) }));
