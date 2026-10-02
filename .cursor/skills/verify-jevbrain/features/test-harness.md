# Test Harness (Prepare and Preflight)

## Sub-features

- **harness:prepare** — Builds plugin, creates/resets test-vault/, copies fixtures, configures enabled plugins
- **harness:preflight** — Validates test-vault/ integrity (SHA256 checksums, enabled plugins, fixtures)

These scripts set up the isolated test environment for manual Obsidian verification.

## How to get to it (user POV)

**First-time setup:**
```bash
npm run harness:prepare
```
Then open `test-vault/` in Obsidian, disable restricted mode, install Dataview + Excalidraw.

**After code changes:**
```bash
npm run check
cp dist/jevbrain/main.js dist/jevbrain/manifest.json dist/jevbrain/styles.css test-vault/.obsidian/plugins/jevbrain/
npm run harness:preflight
```
Then reload JevBrain plugin in Obsidian.

**Preflight check (anytime):**
```bash
npm run harness:preflight
```

## Driving it with harness

**Run prepare (VM-friendly):**
```bash
cd /workspace
npm run harness:prepare
```

**Expected outcomes:**
- Exit code: 0
- `test-vault/` directory created/updated
- `test-vault/.obsidian/plugins/jevbrain/` contains main.js, manifest.json, styles.css
- `test-vault/Fixtures/` contains test notes (Asimov notes, 3D fixtures from `tests/fixtures/`)
- `test-vault/.obsidian/community-plugins.json` lists `["jevbrain", "dataview", "obsidian-excalidraw-plugin"]` (if Dataview/Excalidraw were previously enabled)

**Run preflight (VM-friendly):**
```bash
cd /workspace
npm run harness:preflight
```

**Expected outcomes:**
- Exit code: 0
- Stdout: SHA256 checksums, enabled plugins list
- Verifies:
  - Repository files unchanged since last build
  - dist/ artifacts match source
  - test-vault/ plugins match dist/
  - Enabled plugins are exactly jevbrain, dataview, obsidian-excalidraw-plugin (no more, no less)
  - Fixtures present

**Evidence to capture:**
```bash
# List enabled plugins
cat test-vault/.obsidian/community-plugins.json | jq .

# List test fixtures
find test-vault/Fixtures -name "*.md" -type f | sort

# Check plugin files exist
ls -lh test-vault/.obsidian/plugins/jevbrain/

# Capture preflight output
npm run harness:preflight 2>&1 | tee evidence/preflight-output.txt
```

**Verification steps:**
1. Run `harness:prepare`
2. Capture exit code (expect 0)
3. Check `test-vault/.obsidian/community-plugins.json` contains exactly 3 plugins (or 1 if Dataview/Excalidraw not yet installed)
4. Count fixtures: `find test-vault/Fixtures -name "*.md" | wc -l` (expect 17+ .md files: Asimov notes + 3D test notes)
5. Run `harness:preflight`
6. Capture exit code (expect 0)
7. Save all outputs to evidence directory

## Gotchas

- **First run requires Obsidian setup:** `harness:prepare` installs JevBrain, but Dataview and Excalidraw must be manually installed from Obsidian's community plugins. Subsequent runs preserve these.
- **Re-run prepare = reset test vault:** Fixtures and plugin configs are reset. Any manual changes to test notes are lost.
- **Preflight checks installed state, not running state:** Preflight verifies files on disk. It does NOT check if Obsidian has actually loaded the plugin.
- **Plugin ID changed (LEV-147):** Old test-vault/ from before 2026-09-21 had `plugins/excalibrain/`. Delete old test-vault/ and re-run prepare if you see `plugins/excalibrain/`.
- **Fixtures location:** Fixtures are at `test-vault/Fixtures/` (capital F), not `test-vault/fixtures/`. Case-sensitive filesystems will fail if capitalization is wrong.
- **No production vault access:** Harness only operates on `test-vault/` under project directory. It will never touch your personal Obsidian vaults.
- **Re-running prepare is safe:** Idempotent. Safe to run multiple times. Dataview/Excalidraw configs are preserved if already enabled.
