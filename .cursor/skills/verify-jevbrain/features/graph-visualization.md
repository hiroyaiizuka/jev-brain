# Graph Visualization (2D Mode)

## Sub-features

- Open ExcaliBrain graph view (command palette)
- Center node with relationship visualization (parents, children, friends, siblings)
- Ontology-based styling (Up/Down regions with custom colors)
- Click to navigate (change center node)
- Hover to preview linked notes
- Filter controls (folders, tags, inferred links)
- Pin nodes to prevent layout changes
- History (back/forward navigation)
- Auto-zoom to fit nodes

## How to get to it (user POV)

1. Open Obsidian with test-vault
2. Open command palette (Cmd+P on macOS, Ctrl+P on Linux/Windows)
3. Type "ExcaliBrain" (command ID: `excalibrain-open`)
4. Press Enter
5. Graph view opens in a new pane, showing current note as center node

**Alternative:** Right-click on a note in file explorer → "Open in ExcaliBrain"

**Graph layout:**
- **North (top):** Parents (bi-directional links from ontology: `parent::`, etc.) + Up region (abstract)
- **South (bottom):** Children (bi-directional links: `child::`, `leads to::`, etc.) + Down region (concrete)
- **West (left):** Left friends (`similar::`, etc.)
- **East (right):** Right friends (`next::`, etc.)
- **Inferred links:** Untyped backlinks, shared tags, shared folders (dashed lines)

**Example test case (E01 from harness.md):**
1. Open `test-vault/Fixtures/Foundation.md` as center
2. Expected nodes:
   - North: Reading List (inferred parent)
   - West: Isaac Asimov, Science Fiction, Robot Series (mutual links = friends)
   - East: Foundation and Empire (`next::`)
   - South: Psychohistory (ghost node—note doesn't exist yet)

## Driving it with harness

**Requires Obsidian GUI (Mac/Linux/Windows).** VM without GUI cannot verify.

**Manual verification steps:**
1. `npm run harness:prepare`
2. Open test-vault in Obsidian
3. Ensure JevBrain, Dataview, Excalidraw are enabled
4. Open `Fixtures/Foundation.md`
5. Run command: "ExcaliBrain"
6. Capture screenshot of graph
7. Verify node positions match expected layout (North/South/East/West)
8. Click on "Isaac Asimov" node → center changes to that note
9. Capture second screenshot
10. Compare layouts against E01 expectations from `docs/harness.md`

**Evidence to capture:**
- Screenshot: Initial graph (Foundation as center)
- Screenshot: After clicking another node
- List of visible nodes (can extract via CDP if debugging enabled)
- Terminal: No errors in Obsidian developer console (View → Developer → Console)

**CDP-based verification (advanced):**
If Obsidian launched with `--remote-debugging-port=9231`:
```bash
node artifacts/e2e/cdp.mjs eval probe-graph.js out.json
node artifacts/e2e/cdp.mjs shot screenshot.png
```

See `artifacts/e2e/*.js` for probe examples. Probes can:
- Query `app.plugins.plugins.jevbrain.scene.nodesMap` for node count
- Check `scene.centerNode.title` for center node name
- Verify no console errors

**VM workaround (limited):**
On Linux VM without GUI, cannot verify rendering. Document test as "DEFERRED—requires Mac Obsidian GUI". Can still verify:
- Plugin loads without crashing (check Obsidian startup logs)
- No TypeScript errors at runtime (via CDP console probe)
- Fixtures are present (preflight check)

## Gotchas

- **Excalidraw dependency:** Graph is rendered on Excalidraw canvas. If Excalidraw plugin is disabled, JevBrain shows error Notice and refuses to load.
- **Dataview indexing:** On vault open, if Dataview is still indexing, JevBrain shows "Waiting for Dataview to finish indexing..." Notice. Wait for indexing to complete before testing.
- **First render slow:** Initial graph render may take 1-2 seconds for small vaults, longer for large vaults. Not a bug.
- **Leaf lifecycle:** JevBrain creates a dedicated workspace leaf. If leaf is closed, must re-run "ExcaliBrain" command. Leaf does not auto-restore on Obsidian restart.
- **Node labels:** Max label length truncated (see `maxLabelLength` in settings). Long note titles are abbreviated with "...".
- **Ghost nodes:** Unresolved links (`[[Note That Doesn't Exist]]`) appear as ghost nodes (italicized, clickable to create note). This is expected behavior.
- **Inferred links toggle:** Toolbar button to show/hide inferred links (dashed lines). Default: shown. Test both states.
- **Folder/tag nodes toggle:** Toolbar buttons to show/hide folder and tag nodes. Default: hidden. Test toggling on/off.
- **Layout stability:** Graph layout is deterministic for same vault state, but node positions may shift if vault changes (new links added, notes renamed). Use frozen fixtures for regression testing.
- **3D mode vs 2D:** This feature covers 2D mode only. 3D toggle is separate feature (see `3d-visualization.md`).
- **Command display name:** Command shows as "ExcaliBrain" (not "JevBrain") for upstream compatibility. Command ID is `excalibrain-open`.
