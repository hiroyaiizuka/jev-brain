import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  allowedCommunityPlugins,
  assertGeneratedVault,
  assertSafePath,
  getHarnessPaths,
  markerContents,
  pluginId,
  readCommunityPlugins,
  readHarnessBuild,
  readSafeFile,
} from './preflight.mjs';

function ensureDirectory(paths, directory) {
  assertSafePath(paths.root, directory, 'directory', { optional: true });
  mkdirSync(directory, { recursive: true });
  assertSafePath(paths.root, directory, 'directory');
}

function writeGeneratedFile(paths, filename, contents) {
  assertGeneratedVault(paths);
  assertSafePath(paths.root, dirname(filename), 'directory');
  assertSafePath(paths.root, filename, 'file', { optional: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let pending = false;
  try {
    writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    pending = true;
    assertSafePath(paths.root, filename, 'file', { optional: true });
    renameSync(temporary, filename);
    pending = false;
  } finally {
    if (pending) unlinkSync(temporary);
  }
}

/**
 * Every Markdown fixture under `tests/fixtures`, as `[path relative to it, contents]`. Subfolders
 * are read recursively and keep their shape in the vault (`tests/fixtures/big` → `Fixtures/big`),
 * so a large fixture stays separate from the small ones. Anything that is not a regular `.md` file
 * is skipped, symlinks included (`readSafeFile` refuses the ones named `.md`).
 */
function readFixtures(paths, directory) {
  assertSafePath(paths.root, directory, 'directory');
  const entries = readdirSync(directory, { withFileTypes: true });
  entries.sort((left, right) => (left.name > right.name ? 1 : -1));
  return entries.flatMap((entry) => {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) return readFixtures(paths, source);
    if (!entry.isFile() || !entry.name.endsWith('.md')) return [];
    return [[relative(paths.fixtureSource, source), readSafeFile(paths.root, source)]];
  });
}

try {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node scripts/prepare-test-vault.mjs (no arguments).');
  }
  const paths = getHarnessPaths();
  const build = readHarnessBuild(paths);
  const fixtures = readFixtures(paths, paths.fixtureSource);
  if (fixtures.length === 0) {
    throw new Error('No Markdown fixtures found in tests/fixtures.');
  }

  const vaultExists = assertSafePath(paths.root, paths.vault, 'directory', { optional: true });
  if (vaultExists) assertGeneratedVault(paths);
  // Always the plugin; Dataview and Excalidraw survive a re-run because the plugin cannot start
  // without them and this script never installs other plugins. Anything else is reset.
  const previouslyEnabled = vaultExists ? readCommunityPlugins(paths, { optional: true }) : [];
  const enabledPlugins = allowedCommunityPlugins.filter((id) => id === pluginId || previouslyEnabled.includes(id));

  const fixtureOutputs = fixtures.map(([filename, contents]) => [join(paths.fixtureTarget, filename), contents]);
  const outputs = [
    ...Array.from(build.files, ([filename, contents]) => [join(paths.installed, filename), contents]),
    ...fixtureOutputs,
    [paths.communityPlugins, `${JSON.stringify(enabledPlugins, null, 2)}\n`],
  ];
  // Check all existing destination parents and files before changing any content.
  for (const [filename] of outputs) {
    assertSafePath(paths.root, filename, 'file', { optional: true });
  }

  if (!vaultExists) {
    mkdirSync(paths.vault);
    assertSafePath(paths.root, paths.vault, 'directory');
    writeFileSync(paths.marker, markerContents, { flag: 'wx', mode: 0o600 });
  }
  assertGeneratedVault(paths);
  ensureDirectory(paths, paths.installed);
  ensureDirectory(paths, paths.fixtureTarget);
  for (const [filename] of fixtureOutputs) {
    ensureDirectory(paths, dirname(filename));
  }
  for (const [filename, contents] of outputs) {
    writeGeneratedFile(paths, filename, contents);
  }
  console.info(`Prepared ${relative(paths.root, paths.vault)} with ${build.manifest.id} ${build.manifest.version}.`);
  console.info(`Copied ${fixtures.length} fixtures into test-vault/Fixtures.`);
  console.info(`Enabled community plugins: ${enabledPlugins.join(', ')}.`);
  const missing = allowedCommunityPlugins.filter((id) => !enabledPlugins.includes(id));
  if (missing.length > 0) {
    console.info(`Install and enable ${missing.join(' and ')} in test-vault by hand, then run npm run harness:preflight.`);
  }
  console.info('Obsidian was not started. Open test-vault as a separate vault for manual checks.');
} catch (error) {
  console.error(`Harness preparation failed: ${error.message}`);
  process.exitCode = 1;
}
