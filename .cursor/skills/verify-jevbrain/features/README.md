# JevBrain Feature Map

This directory maps JevBrain's user-facing features to their verification paths.

**Plugin identity:**
- ID: `jevbrain`
- Fork of: ExcaliBrain 0.2.18
- Additions: Up/Down ontology regions, pseudo-3D visualization, Jev-assisted link typing

**Feature categories:**
1. **Build and quality gates** (VM-friendly)
2. **Test harness** (VM-friendly)
3. **Ontology management** (Side-effect verifiable)
4. **Graph visualization** (Mac GUI required)
5. **3D visualization** (Mac GUI required)

**Verification strategy:**
- **VM-friendly features:** Run on Linux cloud VM, capture exit codes and file side-effects
- **GUI-required features:** Document user path from codebase, defer to macOS manual testing
- **Side-effect verifiable:** Run commands, inspect vault file changes

Each feature file follows this structure:
- `## Sub-features` — User-visible capabilities within this feature
- `## How to get to it (user POV)` — Real user workflow with UI labels
- `## Driving it with harness` — Automated verification approach
- `## Gotchas` — Known limitations, platform constraints, dependencies
