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

try {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node scripts/prepare-test-vault.mjs (no arguments).');
  }
  const paths = getHarnessPaths();
  const build = readHarnessBuild(paths);
  assertSafePath(paths.root, paths.fixtureSource, 'directory');
  const fixtures = readdirSync(paths.fixtureSource)
    .filter((filename) => filename.endsWith('.md'))
    .sort()
    .map((filename) => [filename, readSafeFile(paths.root, join(paths.fixtureSource, filename))]);
  if (fixtures.length === 0) {
    throw new Error('No Markdown fixtures found in tests/fixtures.');
  }

  const vaultExists = assertSafePath(paths.root, paths.vault, 'directory', { optional: true });
  if (vaultExists) assertGeneratedVault(paths);
  // Always the plugin; Dataview and Excalidraw survive a re-run because the plugin cannot start
  // without them and this script never installs other plugins. Anything else is reset.
  const previouslyEnabled = vaultExists ? readCommunityPlugins(paths, { optional: true }) : [];
  const enabledPlugins = allowedCommunityPlugins.filter((id) => id === pluginId || previouslyEnabled.includes(id));

  const outputs = [
    ...Array.from(build.files, ([filename, contents]) => [join(paths.installed, filename), contents]),
    ...fixtures.map(([filename, contents]) => [join(paths.fixtureTarget, filename), contents]),
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
