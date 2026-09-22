import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Link context and neighbour excerpt of the Jev state (docs/jev-link-typer-design.md §2-2). */
export const CONTEXT_CHARS = 500;
export const EXCERPT_CHARS = 300;
export const DEFAULT_OUT = join('artifacts', 'jev-accuracy', 'truth.json');
export const RECORD_NAME = 'record.md';

/**
 * Mirrors DEFAULT_HIERARCHY_DEFINITION in src/constants/constants.ts. This script runs outside the
 * plugin, as plain Node with no bundler, so it cannot import the TypeScript source: keep both in step.
 */
export const DEFAULT_HIERARCHY = {
  exclusions: ['excalidraw-font', 'excalidraw-font-color', 'excalidraw-css', 'excalidraw-plugin',
    'excalidraw-link-brackets', 'excalidraw-link-prefix', 'excalidraw-border-color', 'excalidraw-default-mode',
    'excalidraw-export-dark', 'excalidraw-export-transparent', 'excalidraw-export-svgpadding', 'excalidraw-export-pngscale',
    'excalidraw-url-prefix', 'excalidraw-linkbutton-opacity', 'excalidraw-onload-script', 'kanban-plugin'],
  abstract: [],
  concrete: [],
  parents: ['Parent', 'Parents', 'up', 'u', 'North', 'origin', 'inception', 'source', 'parent domain'],
  children: ['Children', 'Child', 'down', 'd', 'South', 'leads to', 'contributes to', 'nurtures'],
  leftFriends: ['Friends', 'Friend', 'Jump', 'Jumps', 'j', 'similar', 'supports', 'alternatives', 'advantages', 'pros'],
  rightFriends: ['opposes', 'disadvantages', 'missing', 'cons'],
  previous: ['Previous', 'Prev', 'West', 'w', 'Before'],
  next: ['Next', 'n', 'East', 'e', 'After'],
  hidden: ['hidden'],
};

/** Regions in the order duplicates are resolved, as src/utils/hierarchy.ts has them. */
export const HIERARCHY_REGIONS = [
  'hidden', 'abstract', 'concrete', 'parents', 'children', 'leftFriends', 'rightFriends', 'previous', 'next',
];

/** The direction a region gives a link: Up counts as a parent and Down as a child (src/graph/Page.ts). */
const REGION_DIRECTIONS = {
  hidden: null,
  abstract: 'parent',
  concrete: 'child',
  parents: 'parent',
  children: 'child',
  leftFriends: 'left-friend',
  rightFriends: 'right-friend',
  previous: 'previous',
  next: 'next',
};

export const DIRECTIONS = ['parent', 'child', 'left-friend', 'right-friend', 'previous', 'next'];

const REGION_LABELS = {
  hidden: 'hidden',
  abstract: 'Up',
  concrete: 'Down',
  parents: 'Parents',
  children: 'Children',
  leftFriends: '左友',
  rightFriends: '右友',
  previous: '前',
  next: '次',
};

const DIRECTION_LABELS = {
  parent: '親',
  child: '子',
  'left-friend': '左友',
  'right-friend': '右友',
  previous: '前',
  next: '次',
};

/**
 * judge's defaults. `endpoint`, `model` and `price` repeat DEFAULT_JEV_SETTINGS and design §7; the
 * sample is a seeded shuffle so a second run asks about the same links and reuses the saved answers.
 */
export const JUDGE_DEFAULTS = {
  limit: 500,
  concurrency: 5,
  seed: 1,
  /** `off` leaves the field marker (`up:: `) in the window, which tells Jev the answer: a control run only. */
  mask: 'on',
  /** How Q1's candidates and their descriptions are built (see {@link CRITERIA_MODES}). */
  criteria: 'default',
  /** `--dry-run`: build every request and price it, send nothing. */
  dryRun: false,
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  /** USD per million input tokens, and yen per USD (design §7). */
  price: 0.042,
  rate: 150,
};

/**
 * The three levers the JEV-0 re-measurement can pull on the criteria (LEV-186, design §10), in the
 * order they are applied. They are separate because they cost wildly different amounts: `examples`
 * is 11,498 input tokens a judgement and `directions` is 110, so a run that thickens both at once
 * cannot say which of them earned the change.
 */
export const CRITERIA_LEVERS = ['narrow', 'examples', 'directions'];

/**
 * The conditions of the ticket, as names for lever sets. `default` is what LEV-163 asked and what
 * the plugin sends; `verbose` is 「説明文を厚くする」 (examples and direction sentences together) and
 * `both` adds the narrowing. Any other combination is written out: `--criteria narrow,directions`.
 */
export const CRITERIA_ALIASES = {
  default: [],
  narrow: ['narrow'],
  verbose: ['examples', 'directions'],
  both: ['narrow', 'examples', 'directions'],
};

export const CRITERIA_MODES = Object.keys(CRITERIA_ALIASES);

/**
 * The levers a `--criteria` value asks for, in {@link CRITERIA_LEVERS} order, or null when it names
 * neither an alias nor a list of levers. `scripts/jev-accuracy-judge.mjs` builds them; the parsing
 * lives here so a typo fails before the vault is read.
 */
export function parseCriteria(value) {
  // A copy: the result becomes `plan.levers` and is serialised into the summary file, and the
  // exported alias table must not be reachable, writable state from there.
  if (Object.prototype.hasOwnProperty.call(CRITERIA_ALIASES, value)) return [...CRITERIA_ALIASES[value]];
  const asked = String(value ?? '').split(',').map((lever) => lever.trim()).filter((lever) => lever !== '');
  if (asked.length === 0 || asked.some((lever) => !CRITERIA_LEVERS.includes(lever))) return null;
  return CRITERIA_LEVERS.filter((lever) => asked.includes(lever));
}

const USAGE = [
  'Usage:',
  `  node scripts/jev-accuracy.mjs extract --vault <path> [--out ${DEFAULT_OUT}] [--hierarchy <data.json>]`,
  `  node scripts/jev-accuracy.mjs judge [--truth ${DEFAULT_OUT}] [--limit 500] [--concurrency 5]`,
  '      [--hierarchy <data.json>] [--responses <jsonl>] [--record <md>] [--summary <json>] [--seed 1]',
  `      [--mask on|off] [--criteria ${CRITERIA_MODES.join('|')} | ${CRITERIA_LEVERS.join(',')}] [--dry-run]`,
  '      [--endpoint <url>] [--model <name>] [--price <usd/Mtok>] [--rate <yen/usd>]',
  '  node scripts/jev-accuracy.mjs compare --summaries <json>[,<json>...] --out <md> [--notes <md>]',
  '  judge needs JEV_API_KEY unless every answer is already in the responses file; --dry-run never asks.',
  '  compare only reads the summary files judge wrote.',
].join('\n');

/**
 * The field name without the markdown Dataview strips from a key: `**Previous**:: [[X]]` and
 * `*source*:: [[X]]` define Previous and source. Template-made notes write the bold form a lot.
 */
export function cleanFieldName(field) {
  let name = field.trim();
  for (;;) {
    const marker = ['***', '**', '__', '*', '_', '`'].find(
      (candidate) => name.length > candidate.length * 2 && name.startsWith(candidate) && name.endsWith(candidate),
    );
    if (!marker) return name.trim();
    name = name.slice(marker.length, -marker.length).trim();
  }
}

/** Dataview's key form of a field name, as src/utils/hierarchy.ts writes it. */
export const toFieldKey = (field) => field.toLowerCase().replaceAll(' ', '-');

const asKeys = (fields) => fields
  .filter((field) => typeof field === 'string')
  .map((field) => toFieldKey(field.trim()))
  .filter((key) => key !== '');

/**
 * The ontology as field keys, mirroring buildHierarchyLowerCase: a missing or malformed region falls
 * back to the default, `friends` migrates to leftFriends, a field claimed by an earlier region is
 * dropped from the later ones, and exclusions keep only what no region took.
 */
export function normalizeHierarchy(hierarchy) {
  const source = hierarchy && typeof hierarchy === 'object' && !Array.isArray(hierarchy) ? hierarchy : {};
  const taken = new Set();
  const regions = {};
  for (const region of HIERARCHY_REGIONS) {
    const fallback = region === 'leftFriends' && Array.isArray(source.friends) ? source.friends : DEFAULT_HIERARCHY[region];
    const keys = asKeys(Array.isArray(source[region]) ? source[region] : fallback).filter((key) => !taken.has(key));
    keys.forEach((key) => taken.add(key));
    regions[region] = keys;
  }
  const exclusions = asKeys(Array.isArray(source.exclusions) ? source.exclusions : DEFAULT_HIERARCHY.exclusions)
    .filter((key) => !taken.has(key));
  return { regions, exclusions: new Set(exclusions) };
}

/**
 * The ontology of the vault under test: its own settings when it has them, upstream's defaults
 * otherwise. `hierarchyPath` points at another plugin's `data.json` — the upstream ExcaliBrain
 * folder for a vault that has no jevbrain yet. `definition` is the stored lists as written, which
 * judge hands to `buildQuestions` so the criteria carry the author's own field names.
 */
export function readHierarchy(vaultPath, hierarchyPath) {
  const path = hierarchyPath ? resolve(hierarchyPath) : join(vaultPath, '.obsidian', 'plugins', 'jevbrain', 'data.json');
  const defaults = { hierarchy: normalizeHierarchy(null), definition: null, source: 'defaults', path };
  if (!existsSync(path)) {
    if (hierarchyPath) throw new Error(`No settings file at ${path}`);
    return defaults;
  }
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  const stored = settings && typeof settings === 'object' ? settings.hierarchy : null;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;
  return { hierarchy: normalizeHierarchy(stored), definition: stored, source: 'data.json', path };
}

/** The region a field belongs to, or null for a field outside the ontology (an excluded one included). */
export function regionOf(fieldKey, hierarchy) {
  if (hierarchy.exclusions.has(fieldKey)) return null;
  return HIERARCHY_REGIONS.find((region) => hierarchy.regions[region].includes(fieldKey)) ?? null;
}

export const directionOf = (region) => (region ? REGION_DIRECTIONS[region] : null);

const WIKI_LINK = /(!?)\[\[([^[\]]+?)\]\]/g;
const FRONTMATTER_KEY = /^([^\s#-][^:]*):[ \t]*(.*)$/;
const FRONTMATTER_ITEM = /^[ \t]*-[ \t]*(.*)$/;
const FRONTMATTER_END = /^(?:---|\.\.\.)[ \t]*$/;
const HEADING = /^#{1,6}[ \t]+(.*?)[ \t]*$/;
const FENCE = /^[ \t]{0,3}(?:```|~~~)/;
const LINE_FIELD = /^[ \t>]*(?:[-*+][ \t]+)?([^[\]()\n:]+?)[ \t]*::[ \t]*/;
const INLINE_FIELD = /([([])[ \t]*([^[\]()\n:]+?)[ \t]*::[ \t]*/g;

function toLines(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    let end = text.indexOf('\n', start);
    const last = end === -1;
    if (last) end = text.length;
    let value = text.slice(start, end);
    if (value.endsWith('\r')) value = value.slice(0, -1);
    lines.push({ value, start });
    if (last) return lines;
    start = end + 1;
  }
}

/** Wiki links of one string, with their offset relative to `base`. Embeds are not links (design §2-1). */
function linksIn(value, base) {
  const links = [];
  for (const match of value.matchAll(WIKI_LINK)) {
    if (match[1] === '!') continue;
    const target = match[2].split('|')[0].split('#')[0].trim();
    if (target === '') continue;
    links.push({ target, text: match[0], offset: base + match.index, length: match[0].length });
  }
  return links;
}

/** Where an inline field ends: the closer matching its opener, with `[[...]]` spans stepped over. */
function inlineValueEnd(line, from, closer) {
  for (let index = from; index < line.length; index += 1) {
    if (line.startsWith('[[', index)) {
      const close = line.indexOf(']]', index + 2);
      if (close === -1) return line.length;
      index = close + 1;
      continue;
    }
    if (line[index] === closer) return index;
  }
  return line.length;
}

/** The fields of one body line: a `field:: value` line of its own, or `(field:: value)` inside it. */
function fieldsInLine(line) {
  const lineField = line.match(LINE_FIELD);
  if (lineField) {
    return [{ field: lineField[1], value: line.slice(lineField[0].length), start: lineField[0].length, inline: false }];
  }
  const fields = [];
  let consumed = 0;
  for (const match of line.matchAll(INLINE_FIELD)) {
    if (match.index < consumed) continue;
    const start = match.index + match[0].length;
    const end = inlineValueEnd(line, start, match[1] === '(' ? ')' : ']');
    fields.push({ field: match[2], value: line.slice(start, end), start, inline: true });
    consumed = end;
  }
  return fields;
}

/** The `---` block at the top of a note: the line that closes it (−1 when there is none) and its text. */
function frontmatterBlock(lines) {
  if (lines.length === 0 || lines[0].value.trim() !== '---') return { end: -1, text: '' };
  const end = lines.findIndex((line, index) => index > 0 && FRONTMATTER_END.test(line.value));
  if (end <= 0) return { end: -1, text: '' };
  return { end, text: lines.slice(1, end).map((line) => line.value).join('\n') };
}

/** The typed links of the frontmatter block: `field: [[X]]` and the list items under `field:`. */
function frontmatterFields(lines, end) {
  const fields = [];
  let key = null;
  for (let index = 1; index < end; index += 1) {
    const { value, start } = lines[index];
    const keyMatch = value.match(FRONTMATTER_KEY);
    const itemMatch = keyMatch ? null : value.match(FRONTMATTER_ITEM);
    if (keyMatch) key = keyMatch[1].trim();
    else if (!itemMatch) continue;
    if (key === null) continue;
    const rest = keyMatch ? keyMatch[2] : itemMatch[1];
    for (const link of linksIn(rest, value.length - rest.length)) {
      fields.push({ field: key, source: 'frontmatter', line: index + 1, ...link, offset: start + link.offset });
    }
  }
  return fields;
}

/**
 * One note as Dataview reads it: its frontmatter, the typed links it defines (frontmatter keys,
 * `(field:: [[X]])` inside a line and the `field:: [[X]]` lines the plugin writes under `## Relations`)
 * and how many wiki links it has in total. Fenced code is neither a field nor a link.
 */
export function parseNote(text) {
  const lines = toLines(text);
  const { end, text: frontmatter } = frontmatterBlock(lines);
  const fields = [];
  let links = 0;
  let bodyStart = 0;

  if (end > 0) {
    bodyStart = end + 1;
    fields.push(...frontmatterFields(lines, end));
    for (let index = 1; index < end; index += 1) links += linksIn(lines[index].value, 0).length;
  }

  let fenced = false;
  let inRelations = false;
  for (let index = bodyStart; index < lines.length; index += 1) {
    const { value, start } = lines[index];
    if (FENCE.test(value)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    links += linksIn(value, 0).length;
    const heading = value.match(HEADING);
    if (heading) {
      inRelations = heading[1].toLowerCase() === 'relations';
      continue;
    }
    for (const field of fieldsInLine(value)) {
      const source = field.inline ? 'inline' : (inRelations ? 'relations' : 'line');
      for (const link of linksIn(field.value, field.start)) {
        fields.push({ field: field.field, source, line: index + 1, ...link, offset: start + link.offset });
      }
    }
  }

  return { frontmatter, fields, links };
}

/** The frontmatter and opening characters of a neighbour note (design §2-2). */
export function noteSummary(text, excerptChars) {
  const lines = toLines(text);
  const { end, text: frontmatter } = frontmatterBlock(lines);
  const body = end > 0 ? text.slice(lines[end].start + lines[end].value.length) : text;
  return { frontmatter, excerpt: body.trim().slice(0, excerptChars) };
}

/** Markdown of the vault, relative to it and with `/` separators. Dot folders (`.obsidian`) are skipped. */
export function listNotes(vaultPath) {
  const notes = [];
  const walk = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name > right.name ? 1 : -1));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) notes.push(relative(vaultPath, path).split(sep).join('/'));
    }
  };
  walk(vaultPath);
  return notes;
}

/** How Obsidian resolves `[[X]]`: by path first, then by file name, both ignoring case. */
function linkIndex(notes) {
  const index = new Map();
  for (const note of notes) {
    const withoutExtension = note.slice(0, -'.md'.length);
    const name = withoutExtension.split('/').pop();
    for (const key of [withoutExtension.toLowerCase(), name.toLowerCase()]) {
      if (!index.has(key)) index.set(key, note);
    }
  }
  return index;
}

const BOM = 0xfeff;

/** A note as Dataview sees it: UTF-8 text without the byte order mark, so offsets match the characters. */
function readNote(vaultPath, note) {
  const text = readFileSync(join(vaultPath, note), 'utf8');
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/**
 * Every typed link of the vault as one truth record, with the counts that say which fields and
 * directions the notes actually use.
 */
export function extractTruth(vaultPath, { contextChars = CONTEXT_CHARS, excerptChars = EXCERPT_CHARS, hierarchyPath = null } = {}) {
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    throw new Error(`Not a vault directory: ${vaultPath}`);
  }
  const { hierarchy, definition, source: hierarchySource, path: hierarchyFile } = readHierarchy(vaultPath, hierarchyPath);
  const notes = listNotes(vaultPath);
  const index = linkIndex(notes);
  const entries = [];
  let links = 0;

  for (const note of notes) {
    const text = readNote(vaultPath, note);
    const parsed = parseNote(text);
    links += parsed.links;
    for (const field of parsed.fields) {
      const name = cleanFieldName(field.field);
      const fieldKey = toFieldKey(name);
      const region = regionOf(fieldKey, hierarchy);
      const targetPath = index.get(field.target.toLowerCase()) ?? null;
      const target = targetPath === null ? null : noteSummary(readNote(vaultPath, targetPath), excerptChars);
      entries.push({
        id: `${entries.length + 1}`.padStart(5, '0'),
        note,
        line: field.line,
        source: field.source,
        field: name,
        /** The key as written, `**Previous**` and all: judge hides exactly this much from the state. */
        marker: field.field,
        fieldKey,
        region,
        direction: directionOf(region),
        target: field.target,
        linkText: field.text,
        targetPath,
        noteFrontmatter: parsed.frontmatter,
        targetFrontmatter: target ? target.frontmatter : null,
        targetExcerpt: target ? target.excerpt : null,
        contextBefore: text.slice(Math.max(0, field.offset - contextChars), field.offset),
        contextAfter: text.slice(field.offset + field.length, field.offset + field.length + contextChars),
      });
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    vault: resolve(vaultPath),
    notes: notes.length,
    hierarchySource,
    hierarchyFile: hierarchySource === 'data.json' ? hierarchyFile : null,
    // The lists as data.json writes them. judge asks Jev with these very field names, so a truth file
    // and its judgement can never be scored against two different ontologies.
    hierarchyDefinition: definition,
    contextChars,
    excerptChars,
    summary: summarize(entries, links),
    entries,
  };
}

export function summarize(entries, links) {
  const fields = new Map();
  for (const entry of entries) {
    const row = fields.get(entry.fieldKey)
      ?? { field: entry.fieldKey, region: entry.region, direction: entry.direction, count: 0 };
    row.count += 1;
    fields.set(entry.fieldKey, row);
  }
  const byField = [...fields.values()].sort((left, right) => right.count - left.count || (left.field > right.field ? 1 : -1));
  const byDirection = [...DIRECTIONS, null]
    .map((direction) => ({ direction, count: entries.filter((entry) => entry.direction === direction).length }))
    .filter((row) => row.count > 0);
  return {
    entries: entries.length,
    links: { total: links, typed: entries.length, ratio: links === 0 ? 0 : entries.length / links },
    byField,
    byDirection,
  };
}

const percentage = (ratio) => `${(ratio * 100).toFixed(1)}%`;

/** The extract half of `artifacts/jev-accuracy/record.md`, printed to stdout as well. */
export function renderRecord(truth, { judged = false } = {}) {
  const { summary } = truth;
  return [
    '# JEV-0 精度テスト: 正解の抽出（LEV-162）',
    '',
    '| 項目 | 値 |',
    '| --- | --- |',
    `| 実行 | ${truth.generatedAt} |`,
    `| Vault | \`${truth.vault}\`（ノート ${truth.notes} 件） |`,
    `| 設定 | ${truth.hierarchyFile ? `\`${truth.hierarchyFile}\`` : '上流の既定値（data.json なし）'} |`,
    `| 正解 | ${summary.entries} 件（前後 ${truth.contextChars} 字、相手の冒頭 ${truth.excerptChars} 字） |`,
    `| リンク総数 | ${summary.links.total} 件（型付き ${percentage(summary.links.ratio)}） |`,
    '',
    '## フィールド別',
    '',
    '| フィールド | 領域 | 方向 | 件数 |',
    '| --- | --- | --- | --- |',
    ...summary.byField.map((row) => `| ${row.field} | ${row.region ? REGION_LABELS[row.region] : '—'} `
      + `| ${row.direction ? DIRECTION_LABELS[row.direction] : '—'} | ${row.count} |`),
    '',
    '## 方向別',
    '',
    '| 方向 | 件数 |',
    '| --- | --- |',
    ...summary.byDirection.map((row) => `| ${row.direction ? DIRECTION_LABELS[row.direction] : '—（領域の外）'} | ${row.count} |`),
    '',
    'Vault の内容（前後の文・相手の冒頭）は `truth.json` にだけ入る。`artifacts/` は gitignore で、コミットしない。',
    judged ? '' : 'Jev への判定と一致率は judge（LEV-163）で足す。\n',
  ].join('\n');
}

export function projectRoot() {
  return realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
}

/** Vault content may only be written under `artifacts/`（AGENTS.md、設計 §10）. */
export function resolveOutputPath(root, out) {
  // Relative to the project root, not to where the shell happens to stand.
  const target = resolve(root, out);
  const path = relative(join(root, 'artifacts'), target);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`--out must stay inside artifacts/: ${out}`);
  }
  return target;
}

export function writeOutputs(outPath, truth, record) {
  const directory = dirname(outPath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(truth, null, 2)}\n`, { mode: 0o600 });
  const recordPath = join(directory, RECORD_NAME);
  writeFileSync(recordPath, record, { mode: 0o600 });
  return recordPath;
}

const EXTRACT_FLAGS = { '--vault': 'vault', '--out': 'out', '--hierarchy': 'hierarchy' };
const JUDGE_FLAGS = {
  '--truth': 'truth', '--hierarchy': 'hierarchy', '--responses': 'responses', '--record': 'record', '--limit': 'limit',
  '--concurrency': 'concurrency', '--seed': 'seed', '--mask': 'mask', '--endpoint': 'endpoint',
  '--model': 'model', '--price': 'price', '--rate': 'rate', '--criteria': 'criteria', '--summary': 'summary',
  '--dry-run': 'dryRun',
};
const COMPARE_FLAGS = { '--summaries': 'summaries', '--out': 'out', '--notes': 'notes' };

const NUMERIC = new Set(['limit', 'concurrency', 'seed', 'price', 'rate']);
/** Flags that stand alone: they take the next argument as a flag, not as a value. */
const BOOLEAN = new Set(['dryRun']);

const asNumber = (flag, value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} takes a number: ${value}.\n${USAGE}`);
  return parsed;
};

const SUBCOMMANDS = { extract: EXTRACT_FLAGS, judge: JUDGE_FLAGS, compare: COMPARE_FLAGS };

const defaultsFor = (subcommand) => {
  if (subcommand === 'extract') return { vault: null, out: DEFAULT_OUT, hierarchy: null };
  if (subcommand === 'compare') return { summaries: null, out: join('artifacts', 'jev-accuracy', 'record-v2.md'), notes: null };
  return { truth: DEFAULT_OUT, hierarchy: null, responses: null, record: null, summary: null, ...JUDGE_DEFAULTS };
};

export function parseArguments(argv) {
  const [subcommand, ...rest] = argv;
  const flags = Object.prototype.hasOwnProperty.call(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : null;
  if (flags === null) {
    throw new Error(`Expected the subcommand ${Object.keys(SUBCOMMANDS).join(', ')}.\n${USAGE}`);
  }
  const options = { subcommand, ...defaultsFor(subcommand) };
  for (let index = 0; index < rest.length;) {
    const flag = rest[index];
    const name = Object.prototype.hasOwnProperty.call(flags, flag) ? flags[flag] : null;
    if (name === null) throw new Error(`Unknown argument: ${flag}.\n${USAGE}`);
    if (BOOLEAN.has(name)) {
      options[name] = true;
      index += 1;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}.\n${USAGE}`);
    options[name] = NUMERIC.has(name) ? asNumber(flag, value) : value;
    index += 2;
  }
  if (subcommand === 'extract' && options.vault === null) {
    throw new Error(`extract needs --vault <path>.\n${USAGE}`);
  }
  if (subcommand === 'compare' && options.summaries === null) {
    throw new Error(`compare needs --summaries <json>[,<json>...].\n${USAGE}`);
  }
  if (subcommand === 'judge' && options.mask !== 'on' && options.mask !== 'off') {
    throw new Error(`--mask takes on or off: ${options.mask}.\n${USAGE}`);
  }
  if (subcommand === 'judge' && parseCriteria(options.criteria) === null) {
    throw new Error(`--criteria takes ${CRITERIA_MODES.join(', ')} or a list of `
      + `${CRITERIA_LEVERS.join(', ')}: ${options.criteria}.\n${USAGE}`);
  }
  return options;
}

function runExtract(root, options) {
  const outPath = resolveOutputPath(root, options.out);
  const truth = extractTruth(options.vault, { hierarchyPath: options.hierarchy });
  const record = renderRecord(truth);
  const recordPath = writeOutputs(outPath, truth, record);
  console.info(record);
  console.info(`truth: ${outPath}`);
  console.info(`record: ${recordPath}`);
}

async function main(argv) {
  try {
    const options = parseArguments(argv);
    const root = projectRoot();
    // Loaded only when it is asked for: judge bundles src/jev/ with esbuild, extract needs nothing.
    // The import has to happen after this module finishes evaluating — judge imports it back, and a
    // top-level await here would leave the two waiting for each other.
    if (options.subcommand === 'judge') await (await import('./jev-accuracy-judge.mjs')).runJudge(root, options);
    else if (options.subcommand === 'compare') (await import('./jev-accuracy-judge.mjs')).runCompare(root, options);
    else runExtract(root, options);
  } catch (error) {
    console.error(`jev-accuracy failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedAsScript) void main(process.argv.slice(2));
