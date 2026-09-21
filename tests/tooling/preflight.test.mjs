import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  allowedCommunityPlugins,
  harnessPaths,
  markerContents,
  pluginFiles,
  pluginId,
  runPreflight,
} from '../../scripts/preflight.mjs';

const scriptsSource = fileURLToPath(new URL('../../scripts', import.meta.url));
const fixturesSource = fileURLToPath(new URL('../fixtures', import.meta.url));
const dataview = 'dataview';
const excalidraw = 'obsidian-excalidraw-plugin';
const everything = [pluginId, dataview, excalidraw];
let root;
let paths;

function writeJson(filename, value) {
  mkdirSync(join(filename, '..'), { recursive: true });
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

/** Root plugin files and the packaged copy `readHarnessBuild` compares them with. */
function addBuild() {
  writeFileSync(join(root, 'main.js'), 'module.exports = {};\n');
  writeFileSync(join(root, 'styles.css'), '.excalibrain-warning { color: var(--text-normal); }\n');
  writeJson(join(root, 'manifest.json'), { id: pluginId, name: 'ExcaliBrain', version: '0.2.18', minAppVersion: '1.8.7' });
  mkdirSync(paths.distribution, { recursive: true });
  for (const filename of pluginFiles) {
    writeFileSync(join(paths.distribution, filename), readFileSync(join(root, filename)));
  }
}

/** A vault as `harness:prepare` leaves it, with the given community plugins enabled. */
function addVault(enabled) {
  mkdirSync(paths.installed, { recursive: true });
  writeFileSync(paths.marker, markerContents);
  for (const filename of pluginFiles) {
    writeFileSync(join(paths.installed, filename), readFileSync(join(paths.distribution, filename)));
  }
  writeJson(paths.communityPlugins, enabled);
}

function readEnabled() {
  return JSON.parse(readFileSync(paths.communityPlugins, 'utf8'));
}

/** Copy the harness scripts under the temporary root so their own root check passes from there. */
function addScripts(...filenames) {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const filename of filenames) {
    cpSync(join(scriptsSource, filename), join(root, 'scripts', filename));
  }
}

function runScript(filename) {
  return spawnSync(process.execPath, [join('scripts', filename)], { cwd: root, encoding: 'utf8' });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'jev-brain-preflight-test-')));
  paths = harnessPaths(root);
  addBuild();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('preflight community plugin check', () => {
  it('lists the plugin and its two prerequisites as the only plugins a generated vault may enable', () => {
    expect(allowedCommunityPlugins).toEqual(everything);
  });

  it('passes a vault that enables the plugin, Dataview and Excalidraw', () => {
    addVault(everything);
    const result = runPreflight(paths);
    expect(result).toMatchObject({ id: pluginId, version: '0.2.18', enabledPlugins: everything });
    expect(Object.keys(result.sha256)).toEqual(pluginFiles);
  });

  it('rejects a vault where a prerequisite is still missing and names it', () => {
    addVault([pluginId, excalidraw]);
    expect(() => runPreflight(paths)).toThrow(/community-plugins\.json: dataview must be enabled/u);
  });

  it('rejects a vault where the plugin itself is not enabled', () => {
    addVault([dataview, excalidraw]);
    expect(() => runPreflight(paths)).toThrow(/community-plugins\.json: excalibrain must be enabled/u);
  });

  it('rejects any other enabled plugin and names it', () => {
    addVault([...everything, 'templater-obsidian']);
    expect(() => runPreflight(paths)).toThrow(/community-plugins\.json: .*templater-obsidian/u);
  });

  it.each([{ excalibrain: true }, ['excalibrain', 1], 'excalibrain'])('rejects a community-plugins.json that is not a list of plugin IDs %j', (contents) => {
    addVault(contents);
    expect(() => runPreflight(paths)).toThrow('community-plugins.json: expected an array of plugin IDs.');
  });

  it('refuses installed bytes that differ from the packaged build', () => {
    addVault(everything);
    writeFileSync(join(paths.installed, 'main.js'), 'stale\n');
    expect(() => runPreflight(paths)).toThrow('main.js: installed bytes differ; run npm run harness:prepare.');
  });

  it('refuses a vault without the generated marker, so a personal vault is never touched', () => {
    addVault(everything);
    rmSync(paths.marker);
    expect(() => runPreflight(paths)).toThrow();
  });
});

describe('preflight CLI', () => {
  beforeEach(() => {
    addScripts('preflight.mjs');
  });

  it('passes the fully prepared vault and reports the enabled plugins', () => {
    addVault(everything);
    const result = runScript('preflight.mjs');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Preflight passed: ${pluginId} 0.2.18.`);
    expect(result.stdout).toContain(`Enabled community plugins: ${everything.join(', ')}.`);
  });

  it('exits nonzero when an unknown plugin is enabled, even though the hashes match', () => {
    addVault([...everything, 'hover-editor']);
    const result = runScript('preflight.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Preflight failed: community-plugins.json:');
    expect(result.stderr).toContain('hover-editor');
  });
});

describe('prepare-test-vault CLI', () => {
  beforeEach(() => {
    addScripts('preflight.mjs', 'prepare-test-vault.mjs');
    cpSync(fixturesSource, paths.fixtureSource, { recursive: true });
  });

  it('enables only the plugin in a new vault and tells the user to install the prerequisites', () => {
    const result = runScript('prepare-test-vault.mjs');
    expect(result.status, result.stderr).toBe(0);
    expect(readEnabled()).toEqual([pluginId]);
    expect(result.stdout).toContain(`Enabled community plugins: ${pluginId}.`);
    expect(result.stdout).toContain(`Install and enable ${dataview} and ${excalidraw} in test-vault by hand`);
    expect(readFileSync(paths.marker, 'utf8')).toBe(markerContents);
  });

  it('installs the packaged files and the Markdown fixtures', () => {
    const result = runScript('prepare-test-vault.mjs');
    expect(result.status, result.stderr).toBe(0);
    for (const filename of pluginFiles) {
      expect(readFileSync(join(paths.installed, filename))).toEqual(readFileSync(join(paths.distribution, filename)));
    }
    expect(readFileSync(join(paths.fixtureTarget, 'Foundation.md'), 'utf8')).toContain('[[Isaac Asimov]]');
  });

  it('keeps the subfolders of tests/fixtures, so the big fixture lands in Fixtures/big', () => {
    const result = runScript('prepare-test-vault.mjs');
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(join(paths.fixtureTarget, 'big')).sort())
      .toEqual(readdirSync(join(fixturesSource, 'big')).sort());
    expect(readFileSync(join(paths.fixtureTarget, 'big', '大きな脳.md'), 'utf8')).toContain('leads to:: [[要約]]');
  });

  it('keeps Dataview and Excalidraw enabled when re-run', () => {
    addVault(everything);
    const result = runScript('prepare-test-vault.mjs');
    expect(result.status, result.stderr).toBe(0);
    expect(readEnabled()).toEqual(everything);
    expect(result.stdout).not.toContain('Install and enable');
  });

  it('drops any other plugin on re-run and re-enables the plugin', () => {
    addVault([dataview, 'templater-obsidian']);
    const result = runScript('prepare-test-vault.mjs');
    expect(result.status, result.stderr).toBe(0);
    expect(readEnabled()).toEqual([pluginId, dataview]);
  });

  it('refuses a generated vault whose community-plugins.json is not a list of plugin IDs', () => {
    addVault({ excalibrain: true });
    const result = runScript('prepare-test-vault.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('community-plugins.json: expected an array of plugin IDs.');
    expect(readEnabled()).toEqual({ excalibrain: true });
  });

  it('refuses a test-vault that this harness did not generate', () => {
    mkdirSync(paths.vault, { recursive: true });
    writeFileSync(join(paths.vault, 'My note.md'), '# personal\n');
    const result = runScript('prepare-test-vault.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Harness preparation failed:');
    expect(readFileSync(join(paths.vault, 'My note.md'), 'utf8')).toBe('# personal\n');
  });
});
