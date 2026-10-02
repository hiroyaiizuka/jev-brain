# 3D Visualization (Pseudo-3D Mode)

## Sub-features

- 3D toggle button in tools panel (desktop only)
- Pseudo-3D oblique projection (Up nodes above floor, Down nodes below, Others on floor)
- Floor grid with compass (N/S/E/W)
- Vertical axis layout (Up/Down nodes in columns above/below center)
- Level-based coloring (nodes colored by abstraction level)
- Thin, translucent links (box-to-box, no gates or neighbor counts in 3D)
- Depth-based draw order (far nodes drawn first, near nodes last)
- Toggle back to 2D restores exact original layout
- 3D settings (northShearX, northRise, heightShearX, level colors)

**Core concept:** 3D mode is a "inspection mode" to see abstraction hierarchy. Up nodes rise above center, Down nodes sink below, Others stay on floor. Not a full 3D manipulable graph—just an oblique projection with fixed viewpoint.

## How to get to it (user POV)

1. Open ExcaliBrain graph (see `graph-visualization.md`)
2. Configure Up/Down ontology (see `ontology-management.md`): Add fields to Up and Down regions in settings
3. Open a note with Up/Down relationships (e.g., `test-vault/Fixtures/習慣はトリガー固定で続く.md`)
4. Tools panel (bottom of graph) → Click 3D toggle button (icon: `lucide-box`)
5. Graph transforms:
   - Up nodes (e.g., `up:: [[行動デザイン]]`) move above center
   - Down nodes (e.g., `down:: [[朝のルーティン手順]]`) move below center
   - Level 0 nodes (Parents, Children, Friends) stay on floor
   - Floor grid appears with compass labels
6. Click 3D toggle again → Returns to exact 2D layout

**Expected visual differences (E15 from harness.md):**
- **2D mode:** All nodes on same plane, Up/Down in same North/South regions as Parents/Children
- **3D mode:**
  - Up nodes: Above floor, vertically aligned (same north coordinate = horizontal line on screen)
  - Down nodes: Below floor, vertically aligned
  - Floor: Parallelogram grid with center node, Friends, inferred links
  - Compass: N/S/E/W labels at floor edges
  - Links: Thin (1px), 50% opacity, no arrowhead decorations
  - Node colors: Level-based (level 0 = default, +1/+2 = lighter, -1/-2 = darker)

## Driving it with harness

**Requires Obsidian GUI (Mac/Linux/Windows) + Desktop version.** Mobile is explicitly unsupported.

**Manual verification steps:**
1. `npm run harness:prepare`
2. Open test-vault in Obsidian desktop
3. Add Up/Down fields in settings:
   ```
   Up (abstract): up
   Down (concrete): down, example
   ```
4. Open `Fixtures/習慣はトリガー固定で続く.md`
5. Run command: "ExcaliBrain"
6. Capture screenshot: **2D mode (before)**
7. Click 3D toggle in tools panel
8. Capture screenshot: **3D mode**
9. Measure node positions (y-coordinates) via CDP or visual inspection:
   - Up nodes: Higher y than center
   - Down nodes: Lower y than center
   - Center + Friends: Same y (on floor)
10. Click 3D toggle again
11. Capture screenshot: **2D mode (after)**
12. Compare before/after 2D screenshots—must be pixel-perfect identical

**CDP-based position verification (advanced):**
```javascript
const scene = app.plugins.plugins.jevbrain.scene;
const nodes = [...scene.nodesMap.values()];
const positions = nodes.map(n => ({
  title: n.title,
  level: n.level,
  center: n.getCenter()
}));
return { view3D: scene.view3D, positions };
```

**Evidence to capture:**
- Screenshot: 2D before toggle
- Screenshot: 3D mode (clearly showing Up above, Down below, floor grid)
- Screenshot: 2D after toggle (must match "before")
- Node positions JSON (if using CDP)
- Obsidian console: Verify no errors (especially "floor", "projection", "render" errors)
- Measurement: Vertical spacing between levels (should be consistent)

**VM workaround:**
Linux VM without Obsidian GUI cannot verify rendering. Document as "DEFERRED—requires Mac Obsidian GUI". Can still verify:
- 3D toggle button code exists (grep for `TOGGLE_3D_VIEW`, `lucide-box`)
- Unit tests pass (`tests/graph/projection.test.ts`)
- Settings schema includes `view3D` keys

## Gotchas

- **Desktop only:** `ea.DEVICE?.isDesktop` guard. 3D toggle button does NOT appear on mobile. If testing mobile, expect no 3D button (not a bug).
- **Startup always 2D:** Plugin always starts in 2D mode. 3D state is NOT persisted across sessions. This is intentional (3D is inspection mode, not default).
- **Settings DO persist:** Numeric 3D settings (northShearX, levelColors, etc.) ARE saved. Toggle state is not.
- **Requires Up/Down:** If ontology has no Up/Down fields, 3D mode still works but all nodes stay on floor (no height variation). Not visually interesting but not a bug.
- **Floor gaps:** Floor grid may extend outside viewport (especially if many nodes). This is expected—floor represents conceptual "ground plane", not strictly viewport-fitted.
- **Link styling:** In 3D, links are always thin (1px) and semi-transparent (50%), overriding ontology link styles. This is intentional for clarity.
- **No shadows/pillars (LEV-128):** Early design had shadows and pillars. These were removed. If you see shadows, you're testing wrong commit.
- **Level colors:** Default level colors are in `constants.DEFAULT_LEVEL_COLORS`. Can be customized in settings → "3D view" section.
- **Zoom behavior:** `zoomToFit` in 3D excludes floor/compass, only fits nodes. May zoom tighter than 2D if floor is large.
- **Performance:** 3D projection is O(n) for nodes, but rendering is re-done on every toggle. Large vaults (>200 nodes) may see ~200-300ms delay.
- **Re-render, not re-index:** Toggle does NOT rebuild Dataview index. Only re-projects existing layout. Fast toggle is intentional.
- **CDP breakpoints:** If debugging 3D code via CDP, breakpoints in `render3D()` can cause Excalidraw canvas to desync. Let rendering finish before pausing.
- **Fixed viewpoint:** You cannot rotate or pan 3D view. Oblique projection parameters are fixed (or settable via settings, but no interactive rotation).
- **Obsidian theme interaction:** 3D floor grid uses theme text color (60% opacity). Dark themes show lighter grid, light themes show darker grid. This is expected.
