---
name: verify-jevbrain
description: Verify JevBrain (Obsidian plugin with graph visualization, 3D abstraction axis, and Jev-assisted link typing) by running its harness scripts and checking side-effects in the test vault.
---

# Verify JevBrain

Verification skill for JevBrain, an Obsidian desktop plugin that visualizes notes as an editable graph with ontology-based relationships, pseudo-3D abstraction levels, and AI-assisted link typing.

**When to use:** After implementing JevBrain features—graph rendering, Up/Down ontology regions, 3D toggle, Jev link typing, or settings changes—verify the change works by running the harness and capturing concrete evidence.

## Launch

JevBrain is an Obsidian desktop plugin (plugin ID: `jevbrain`) with dependencies:
- Dataview plugin (for field-based relationships)
- Excalidraw plugin (for graph canvas, `MINEXCALIDRAWVERSION` or higher)

**Prerequisites:**
- Node.js from `.nvmrc` (22.22.3)
- `npm ci` to install dependencies

**Build and prepare test vault:**
```bash
npm run harness:prepare
```

This script:
1. Runs `npm run check` (validate, lint, test, package)
2. Creates/updates `test-vault/` with plugin distribution files
3. Copies test fixtures to `test-vault/Fixtures/`
4. Configures enabled plugins (only jevbrain, dataview, obsidian-excalidraw-plugin)

**Manual Obsidian setup (first time only):**
On macOS/Linux with Obsidian desktop:
1. Open `test-vault/` as a vault in Obsidian
2. Disable restricted mode for community plugins
3. Install and enable Dataview and Excalidraw from community plugins
4. JevBrain is pre-installed by harness:prepare

After the first setup, `npm run harness:prepare` resets fixtures but keeps Dataview/Excalidraw configurations.

**Updating after code changes:**
```bash
npm run check
cp dist/jevbrain/main.js dist/jevbrain/manifest.json dist/jevbrain/styles.css test-vault/.obsidian/plugins/jevbrain/
npm run harness:preflight
```

Then reload JevBrain plugin in Obsidian (not the whole app).

**Important constraints:**
- Primary verification surface is Obsidian desktop with GUI (macOS/Linux/Windows)
- Linux cloud VMs typically lack Obsidian GUI—verify what you can via harness scripts and vault side-effects
- Do not modify production vaults; only `test-vault/` under this project
- Jev features require API key (not available in VM): document those as "Mac GUI required"

## Doctor

Run preflight checks before testing:

```bash
npm run harness:preflight
```

**Expected checks:**
- Repository, dist/, and test-vault/ file integrity (SHA256 checksums match)
- Plugin manifest version matches package.json
- Exactly 3 enabled plugins: jevbrain, dataview, obsidian-excalidraw-plugin
- Fixtures present in test-vault/Fixtures/

Exit code 0 = ready to test. Nonzero = configuration mismatch; re-run `harness:prepare`.

**What preflight does NOT check:**
- Whether the plugin is actually loaded (Obsidian must be running)
- Whether the distributed code matches your latest changes (use the update workflow above)
- Runtime behavior (that's what Drive does)

## Drive

JevBrain's features span multiple layers:
- **Scripted verification** (no GUI): `npm run check`, harness scripts, unit tests
- **Vault side-effects**: Files added/modified in test-vault/ by plugin operations
- **Obsidian GUI**: Graph rendering, command palette, settings, Jev suggesters

**Feature categories and how to drive them:**

### 1. Build, lint, type-check (VM-friendly)
```bash
npm run check
```
Captures: Exit code, stdout/stderr

### 2. Test fixtures and vault setup (VM-friendly)
```bash
npm run harness:prepare
npm run harness:preflight
```
Captures: Exit code, enabled plugins list, fixture presence

### 3. Ontology modifications via command (VM-friendly side-effect)
Real Obsidian user path: Right-click on `Author::` field → "Add 'Author' to ExcaliBrain Ontology" → Modal opens → Select region (Up/Down/Parents/etc.) → Confirm
Side-effect verification: Check `test-vault/.obsidian/plugins/jevbrain/data.json` for updated `hierarchy.abstract` or `hierarchy.concrete` arrays.

### 4. Graph rendering (Mac GUI required)
Real user path: Command palette → "ExcaliBrain" → Graph opens showing center node with relationships
Verification: Visual inspection (screenshot) or CDP probe on macOS Obsidian with debugging enabled

### 5. 3D toggle (Mac GUI required)
Real user path: Tools panel → 3D toggle button → Graph switches to pseudo-3D projection (Up nodes above, Down nodes below floor, Others on floor)
Verification: Screenshot before/after, measure node y-coordinates via CDP, confirm 2D restoration on toggle-off

### 6. Jev link typing (Mac GUI + API key required)
Real user path: In note editor, type `[[Link]]` → `]]` triggers suggester → Pick field → Line written to note
Side-effect: Check `jev-log.json` for logged operations, verify line added in note file
Note: Requires Jev API key in settings (not available in VM)

**For features requiring Mac GUI:** Document the full user path from command palette / settings panel / right-click context menu, using stable identifiers from the codebase (command IDs, setting keys). State clearly what was verified and what was deferred.

## Evidence

Capture proof that features work:

**Required for each verification run:**
- Execution conditions: Git commit SHA, Node version, platform
- Test date and time
- Feature tested
- Method (scripted / side-effect / GUI screenshot)
- Result (PASS / FAIL / DEFERRED)
- Evidence files (logs, screenshots, diff of vault files)

**Evidence directory:** `.cursor/skills/verify-jevbrain/evidence/`

This skill's evidence lives **inside the skill directory** to keep verification artifacts with the skill definition. Cleanup does NOT delete evidence.

**Evidence file naming convention:**
```
evidence/
  YYYY-MM-DD-<feature-name>/
    conditions.txt        # commit, node version, date
    result.txt            # PASS/FAIL + summary
    before-screenshot.png # if GUI
    after-screenshot.png
    vault-diff.txt        # if side-effect
    terminal-log.txt      # if scripted
```

## Cleanup

After capturing evidence:
1. Reset test-vault/ to clean state: `npm run harness:prepare` (re-copies fixtures, resets plugin configs)
2. Do NOT delete `.cursor/skills/verify-jevbrain/evidence/`—evidence survives cleanup

**What cleanup does:**
- Resets test-vault/ to known good state
- Removes any notes created during testing
- Resets plugin settings to defaults

**What cleanup does NOT do:**
- Delete evidence directory
- Remove installed dependencies
- Uninstall Obsidian plugins

## Helpers

### Check enabled plugins (without Obsidian)
```bash
cat test-vault/.obsidian/community-plugins.json | jq .
```
Expected: `["jevbrain", "dataview", "obsidian-excalidraw-plugin"]` (order may vary)

### Inspect plugin settings
```bash
cat test-vault/.obsidian/plugins/jevbrain/data.json | jq .hierarchy
```
Shows current ontology configuration (abstract, concrete, parents, children, etc.)

### List test fixtures
```bash
find test-vault/Fixtures -name "*.md" | sort
```

### Check Jev log (if Jev features tested)
```bash
cat test-vault/.obsidian/plugins/jevbrain/jev-log.json | jq '.[-5:]'
```
Shows last 5 Jev operations

### Probe Obsidian via CDP (macOS with debugging enabled)
Requires Obsidian launched with remote debugging (port 9231).
See `artifacts/e2e/cdp.mjs` in repository for probe examples.

**Example probe workflow:**
1. Launch Obsidian with `--remote-debugging-port=9231`
2. Open test-vault in Obsidian
3. Run probe: `node artifacts/e2e/cdp.mjs eval <probe.js> <out.json>`
4. Inspect output JSON

Note: CDP probes are for regression testing after changes; this skill focuses on setting up the verification harness.
