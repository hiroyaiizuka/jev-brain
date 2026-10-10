# Build and Quality Gates

## Sub-features

- Metadata validation (manifest, package.json, versions.json consistency)
- ESLint with Obsidian plugin rules and TypeScript rules
- TypeScript type-checking (strict disabled, but zero errors with current settings)
- Unit tests (Vitest)
- Production bundle (esbuild CJS for Obsidian)
- Distribution package (dist/jevbrain/ with SHA256 verification)

## How to get to it (user POV)

Developers run quality checks before committing or opening PRs:

```bash
npm run check
```

This is the same command used in CI (`.github/workflows/check.yml`).

**What it runs (in order):**
1. `npm run validate` — Checks manifest.json, package.json, package-lock.json, versions.json consistency
2. `npm run lint` — ESLint with `--max-warnings 0`
3. `npm test` — Vitest unit tests
4. `npm run package` — Builds production bundle, creates distribution package, validates artifacts

**Exit code 0 = all gates pass.** Nonzero = failure (check stderr for details).

## Driving it with harness

**From any environment (including Linux VM):**

```bash
cd /workspace
npm run check
```

**Expected outcomes:**
- Exit code: 0
- Stdout: Test results, lint summary, build info
- Artifacts created: `dist/jevbrain/main.js`, `dist/jevbrain/manifest.json`, `dist/jevbrain/styles.css`, `dist/build-info.json`

**Verification:**
1. Capture exit code
2. Capture stdout/stderr
3. Verify dist/ artifacts exist and `dist/build-info.json` contains SHA256 checksums
4. Run a second time to confirm idempotency

**Evidence to capture:**
- Terminal output (full)
- Exit code
- `dist/build-info.json` contents
- Execution time

## Gotchas

- **Runtime dependencies:** Node.js version from `.nvmrc` (22.22.3). Wrong version may cause esbuild or test failures.
- **First run:** `npm ci` must complete successfully first (installs dependencies).
- **Lint baseline:** `eslint.config.mjs` has a baseline block suppressing upstream code warnings. New files or changed files should not add to this baseline.
- **Type-checking:** `strict: false` in tsconfig. Changing to strict mode will fail until codebase is fully strict-compliant (H1 goal, not yet done).
- **Test fixtures:** Unit tests use `tests/fixtures/` (Asimov notes, 3D fixtures). Tests do NOT touch production vaults.
- **CI parity:** This command must match `.github/workflows/check.yml` exactly. Divergence = CI surprises.
- **No GUI required:** All gates run in headless environments (Linux VM, CI). No Obsidian instance needed.
