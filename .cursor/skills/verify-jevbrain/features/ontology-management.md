# Ontology Management (Up/Down Regions)

## Sub-features

- Add Dataview fields to Up (abstract) region via "Add to Ontology" modal
- Add Dataview fields to Down (concrete) region via "Add to Ontology" modal
- Configure Up/Down regions in settings UI
- Ontology field suggester (auto-complete when typing field names)
- Removal of fields from regions (via settings)

**Core concept:** JevBrain extends ExcaliBrain's ontology with two new regions:
- **Up (abstract):** Higher-level concepts, generalizations (e.g., `up::`, `topic::`, `category::`)
- **Down (concrete):** Lower-level details, examples (e.g., `down::`, `example::`, `instance::`)

Fields in Up/Down regions appear in graph visualization with distinct styling (default: green links, weight 4.5).

## How to get to it (user POV)

### Method 1: Context menu (E05)
1. Open a note in Obsidian editor
2. Write a Dataview field (e.g., `Author:: [[Isaac Asimov]]`)
3. Right-click on the field line (specifically on "Author::")
4. Context menu shows: "Add 'Author' to ExcaliBrain Ontology"
5. Click → Modal opens with buttons: Hidden, Up, Down, Parents, Children, Left, Right, Previous, Next
6. Click "Up" or "Down"
7. Modal closes, Notice appears confirming addition
8. Field is now in Up/Down region, graph visualization updates on next render

### Method 2: Settings UI (E13)
1. Open Obsidian settings (gear icon)
2. Navigate to "JevBrain" settings (or "ExcaliBrain"—display name not yet changed)
3. Scroll to "Ontology" section
4. Find text areas: "Up (abstract)" and "Down (concrete)"
5. Type field names, comma-separated (e.g., `up, topic, category`)
6. Click "Save" (or just close settings—Obsidian auto-saves)
7. Reload plugin for changes to take effect

### Method 3: Field suggester
1. In note editor, start typing a field: `up::`
2. Auto-complete suggester shows known ontology fields
3. Select field name from list
4. Field is inserted with correct spelling

## Driving it with harness

**Side-effect verification (VM-friendly):**

Ontology changes persist in `test-vault/.obsidian/plugins/jevbrain/data.json` under `hierarchy.abstract` and `hierarchy.concrete` arrays.

**Test workflow:**
1. Start with clean test-vault: `npm run harness:prepare`
2. Manually add fields to Up region (via Obsidian GUI or by editing data.json directly for VM testing)
3. Verify change:
   ```bash
   cat test-vault/.obsidian/plugins/jevbrain/data.json | jq .hierarchy.abstract
   ```
   Expected: Array contains the added field (e.g., `["up"]`)

4. Add fields to Down region
5. Verify:
   ```bash
   cat test-vault/.obsidian/plugins/jevbrain/data.json | jq .hierarchy.concrete
   ```
   Expected: Array contains added fields (e.g., `["down", "example"]`)

**For VM without Obsidian GUI:**
Directly edit `test-vault/.obsidian/plugins/jevbrain/data.json`:
```json
{
  "hierarchy": {
    "abstract": ["up"],
    "concrete": ["down", "example"]
  }
}
```
Then run preflight to confirm structure is valid:
```bash
npm run harness:preflight
cat test-vault/.obsidian/plugins/jevbrain/data.json | jq .hierarchy
```

**Evidence to capture:**
- `data.json` before and after changes (diff)
- Exit code of preflight after changes
- Screenshot of settings UI showing Up/Down fields (if GUI available)
- Screenshot of "Add to Ontology" modal (if GUI available)

## Gotchas

- **Field name normalization:** Internally, field names are lowercased and spaces become hyphens (`toHierarchyKey()`). "My Field" → "my-field".
- **Exclusivity:** Fields in Up cannot be in Down, and vice versa. Hierarchy resolution order: hidden → Up → Down → Parents → Children → Left → Right → Previous → Next → exclusions. Later regions drop conflicts.
- **Requires Dataview plugin:** Ontology fields are Dataview inline fields (`field:: value`) or YAML frontmatter. Dataview must be installed and enabled.
- **Settings UI labels:** Still say "ExcaliBrain" (upstream display name not changed for compatibility). Plugin ID is `jevbrain`.
- **Context menu item (E05):** Editor context menu registration tested in code, but manual right-click verification requires GUI. VM verification limited to settings-based approach.
- **Graph update timing:** After adding fields to ontology, graph does NOT auto-update. Must close and reopen graph view (or reload plugin) to see new styling.
- **Default values:** Up and Down default to empty arrays `[]`. Existing vaults without Up/Down definitions use old behavior (no Up/Down regions).
- **Settings schema migration:** Old settings without `abstract`/`concrete` keys are transparently upgraded with defaults on plugin load (`withJevDefaults()`).
