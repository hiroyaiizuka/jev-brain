import { NodeStyle, LinkStyle, Hierarchy, View3DSettings } from "../Types";

export const APPNAME = "ExcaliBrain";
export const PLUGIN_NAME = "excalibrain"
export const MINEXCALIDRAWVERSION = "2.27.3"
export const PREDEFINED_LINK_STYLES = ["base","inferred","file-tree","tag-tree"];
export const SUGGEST_LIMIT = 30;

export const DEFAULT_LINK_STYLE:LinkStyle = {
  strokeColor: "#696969FF",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  startArrowHead: "none",
  endArrowHead: "none",
  showLabel: false,
  fontSize: 10,
  fontFamily: 3,
  textColor: "#ffffffff"
}

/**
 * Link style of the Up (abstract) / Down (concrete) regions
 * (docs/ontology-axis-design.md §1). Layered over base/inferred and under the
 * per-field style, so it only sets what should differ from the base style.
 */
export const DEFAULT_AXIS_LINK_STYLE:LinkStyle = {
  strokeColor: "#22ec23cc",
  strokeWidth: 4.5,
}

/**
 * 3D view (docs/3d-design.md §6-1, §6-6). `loadSettings()` merges these into a saved `view3D` object.
 * The factors are the layout the author dragged out on 2026-09-21 (LEV-128), in multiples of nodeHeight (77px):
 * Up 241, Down 282 (274 + the 5px the author asked for in LEV-137), vertical gap 293, bands 300,
 * floor 546 north / 443 south / 115 margin. The height shear 0.64 is from the same session.
 */
export const DEFAULT_VIEW_3D_SETTINGS: Readonly<View3DSettings> = {
  northShearX: 0.4,
  northRise: 0.3,
  heightShearX: 0.64,
  upHeightFactor: 3.1,
  downHeightFactor: 3.67,
  verticalGapFactor: 3.8,
  bandDistanceFactor: 3.9,
  floorNorthFactor: 7.1,
  floorSouthFactor: 5.75,
  floorMarginFactor: 1.5,
};

/**
 * Node background per level in the 3D view (docs/3d-design.md §6-3), floor (L1) first: the four steps of the
 * feedback mock (docs/images/3d-feedback-mock-2026-09-21.png), light to dark. `settings.levelColors`.
 */
export const DEFAULT_LEVEL_COLORS: readonly string[] = ["#eeedfdff", "#cecbf3ff", "#aea9e7ff", "#7e77d7ff"];

export const DEFAULT_NODE_STYLE:NodeStyle = {
  prefix: "",
  backgroundColor: "#00000066",
  fillStyle: "solid",
  textColor: "#ffffffff",
  borderColor: "#00000000",
  fontSize: 20,
  fontFamily: 3,
  maxLabelLength: 30,
  roughness: 0,
  strokeShaprness: "round",
  strokeWidth: 1,
  strokeStyle: "solid",
  padding: 10,
  gateRadius: 5,
  gateOffset: 15,
  gateStrokeColor: "#ffffffff",
  gateBackgroundColor: "#ffffffff",
  gateFillStyle: "solid"
}

export const DEFAULT_HIERARCHY_DEFINITION: Hierarchy = {
  exclusions: ["excalidraw-font","excalidraw-font-color","excalidraw-css","excalidraw-plugin",
    "excalidraw-link-brackets","excalidraw-link-prefix","excalidraw-border-color","excalidraw-default-mode",
    "excalidraw-export-dark","excalidraw-export-transparent","excalidraw-export-svgpadding","excalidraw-export-pngscale",
    "excalidraw-url-prefix", "excalidraw-linkbutton-opacity", "excalidraw-onload-script", "kanban-plugin"],
  // Up / Down start empty: existing users move fields here themselves (docs/ontology-axis-design.md §3).
  abstract: [],
  concrete: [],
  parents: ["Parent", "Parents", "up", "u", "North", "origin", "inception", "source", "parent domain"],
  children: ["Children", "Child", "down", "d", "South", "leads to", "contributes to", "nurtures"],
  leftFriends: ["Friends", "Friend", "Jump", "Jumps", "j", "similar", "supports", "alternatives", "advantages", "pros"],
  rightFriends: ["opposes", "disadvantages", "missing", "cons"],
  previous: ["Previous", "Prev", "West", "w", "Before"],
  next: ["Next", "n", "East", "e", "After"],
  hidden: ["hidden"],
}
