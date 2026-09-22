import type { App, LinkCache, TFile } from "obsidian";
import type { Page } from "src/graph/Page";
import { RelationType, type Relation } from "src/Types";
import { getDVFieldLinksForPage } from "src/utils/dataview";
import { HIERARCHY_REGIONS } from "src/utils/hierarchy";

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
  /**
   * Where the link starts and how long it is written, counted over the whole note as
   * `metadataCache` counts it — `[[X|alias]]` whole, `![[X]]` without the `!`. The judgement's
   * state needs the span (`buildState`), and rederiving it from `line`/`ch` cannot be done
   * safely: a line holds more than one link, and a `[text](note.md)` has no `]]` to find.
   */
  offset: number;
  length: number;
  /** The line the link sits on, as written: `ch` indexes into it. */
  context: string;
};

/** The same occurrence for a link this note types, with the fields of this note that type it. */
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
 * Whether a field defines the relation, in either note. A relation that only comes from the
 * link itself (`RelationType.INFERRED`) does not, which is what leaves the link untyped.
 */
const isDefined = (relation: Relation | undefined): boolean =>
  relation !== undefined &&
  ((relation.isParent && relation.parentType === RelationType.DEFINED) ||
    (relation.isChild && relation.childType === RelationType.DEFINED) ||
    (relation.isLeftFriend && relation.leftFriendType === RelationType.DEFINED) ||
    (relation.isRightFriend && relation.rightFriendType === RelationType.DEFINED) ||
    (relation.isNextFriend && relation.nextFriendType === RelationType.DEFINED) ||
    (relation.isPreviousFriend && relation.previousFriendType === RelationType.DEFINED));

/** Every ontology region but `hidden`: the fields that can type a link. */
const TYPED_REGIONS = HIERARCHY_REGIONS.filter((region) => region !== "hidden");

/**
 * The fields of the note itself, by target. The relation's own `*TypeDefinition` cannot be
 * used for this: the other note's fields define the relation just as well (`C.md` writing
 * `origin:: [[A]]` defines A's relation to C), and only a field written here can be reviewed
 * and rewritten here. The keys are Dataview's, as everywhere else in the ontology.
 */
const ownFieldsOf = (page: Page): Map<string, string[]> => {
  const byTarget = new Map<string, string[]>();
  if (!page.dvPage) return byTarget;
  const ontology = TYPED_REGIONS.flatMap((region) => page.plugin.hierarchyLowerCase[region]);
  for (const { link, field } of getDVFieldLinksForPage(page.plugin, page.dvPage, ontology)) {
    const fields = byTarget.get(link) ?? [];
    if (!fields.includes(field)) fields.push(field);
    byTarget.set(link, fields);
  }
  return byTarget;
};

type Occurrence = { link: UntypedLink; relation: Relation | undefined };

/**
 * The note's wiki links paired with the relation the graph already holds for their target.
 * Embeds are left out because `metadataCache` keeps them in `embeds`, not in `links`.
 * Dropped here: URLs, the note itself, the brain drawing, `excludeFilepaths`, and every
 * occurrence of a target after the first one.
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
    // Every relation setter of Page refuses the note itself and the brain drawing, so a field
    // on either of them would never become a relation and the link would be offered forever.
    if (target === file.path || target === page.plugin.settings.excalibrainFilepath) continue;
    if (seen.has(target)) continue;
    if (page.plugin.settings.excludeFilepaths.some((path) => target.startsWith(path))) continue;
    seen.add(target);
    occurrences.push({
      link: {
        target,
        displayText: link.displayText || linkpath,
        line: link.position.start.line,
        ch: link.position.start.col,
        offset: link.position.start.offset,
        length: link.position.end.offset - link.position.start.offset,
        context: lines[link.position.start.line] ?? "",
      },
      relation: page.neighbours.get(target),
    });
  }
  return occurrences;
};

/**
 * The links of `file` that no field types yet, in either note: the pair is already typed when
 * the other note names this one, so there is nothing left to ask. A target reached through a
 * hidden field is left out as well — the note already says what to do with it (design §2-1).
 * `content` is the note's text and only each link's `context` is read from it, so it has to be
 * the version `metadataCache` parsed (`vault.cachedRead(file)`, or the editor's buffer).
 */
export const collectUntypedLinks = (app: App, page: Page, file: TFile, content: string): UntypedLink[] =>
  occurrencesOf(app, page, file, content)
    .filter(({ relation }) => !relation?.isHidden && !isDefined(relation))
    .map(({ link }) => link);

/**
 * The links of `file` that a field of this note types, with that field, for the review of
 * existing types (design §5). A link only the other note types is in neither list: this note
 * has no line to rewrite for it.
 */
export const collectTypedLinks = (app: App, page: Page, file: TFile, content: string): TypedLink[] => {
  const occurrences = occurrencesOf(app, page, file, content);
  const ownFields = ownFieldsOf(page);
  return occurrences
    .filter(({ relation }) => !relation?.isHidden)
    .map(({ link }) => ({ ...link, fields: ownFields.get(link.target) ?? [] }))
    .filter(({ fields }) => fields.length > 0);
};
