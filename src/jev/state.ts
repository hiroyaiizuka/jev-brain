/**
 * The `state` half of one judgement (docs/jev-link-typer-design.md §2-2): what
 * the note and the link's target look like around the link, as a JSON string.
 * Pure — the Obsidian side (vault, metadataCache) reads the note and hands the
 * text and frontmatter in.
 */

export type StateFrontmatter = Record<string, unknown> | null | undefined;

export type StateNote = {
  frontmatter: StateFrontmatter;
  /** Body of the note the link sits in; only the window around the link is sent. */
  text: string;
};

export type StateLink = {
  /** The linked note's name as written in `[[X]]`, without alias or heading. */
  target: string;
  /** Character offset of the link inside {@link StateNote.text}. */
  offset: number;
};

/** The target note, or null for a link whose file does not exist (only its name is known). */
export type StateTargetNote = {
  frontmatter?: StateFrontmatter;
  text?: string;
} | null;

export type BuildStateInput = {
  note: StateNote;
  link: StateLink;
  targetNote: StateTargetNote;
  /** The field the link already carries, when this is a review (§2-2, §5). */
  currentField?: string;
  /** Characters kept on each side of the link (setting `contextChars`, default 500). */
  contextChars: number;
};

/** How much of the target note is sent: its opening, fixed by §2-2. */
export const TARGET_EXCERPT_CHARS = 300;

/** The window around the link. Cutting mid-sentence is fine (§2-2). */
const windowAround = (text: string, offset: number, chars: number): string =>
  text.slice(Math.max(0, offset - chars), Math.max(0, offset + chars));

/**
 * Builds the state of one link. Never carries the whole body, another note or a
 * vault path (§2-2): only the window around the link, the two frontmatters and
 * the target's opening.
 */
export const buildState = (input: BuildStateInput): string => {
  const { note, link, targetNote, currentField, contextChars } = input;
  const state: Record<string, unknown> = {
    note: {
      frontmatter: note.frontmatter ?? null,
      context: windowAround(note.text, link.offset, contextChars),
    },
    target: targetNote
      ? {
          name: link.target,
          frontmatter: targetNote.frontmatter ?? null,
          excerpt: (targetNote.text ?? "").slice(0, TARGET_EXCERPT_CHARS),
        }
      : { name: link.target },
  };
  if (currentField) state.currentField = currentField;
  return JSON.stringify(state);
};
