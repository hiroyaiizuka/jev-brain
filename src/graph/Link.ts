import { ExcalidrawAutomate, applyEAStyle } from "src/utils/ExcalidrawAutomateCompatibility";
import ExcaliBrain from "src/excalibrain-main";
import { ExcaliBrainSettings } from "src/Settings";
import { LinkStyle, RelationType, Role } from "src/Types";
import { axisOf } from "src/utils/hierarchy";
import { Node } from "./Node";

/** 3D (docs/3d-design.md §6-3): links are drawn thin and faint so the pillars and shadows read first. */
const LINK_3D = {
  strokeWidth: 1,
  opacity: 50,
} as const;

export class Link {
  style: LinkStyle;
  public isInferred: boolean = false;

  constructor(
    public nodeA: Node,
    public nodeB: Node,
    private nodeBRole: Role,
    relation: RelationType,
    public hierarchyDefinition: string,
    private ea: ExcalidrawAutomate,
    settings: ExcaliBrainSettings,
    plugin: ExcaliBrain
  ) {
    const hlist = hierarchyDefinition?.split(",").map(h=>h.trim());
    this.isInferred = relation === RelationType.INFERRED;
    let linkstyle: LinkStyle = {};
    if(hlist) {
      hlist.forEach(h=>{
        if(!plugin.hierarchyLinkStylesExtended[h]) {
          switch(h) {
            case "file-tree": 
              linkstyle = {
                ...linkstyle,
                ...settings.folderLinkStyle    
              };
              break;
            case "tag-tree":
              linkstyle = {
                ...linkstyle,
                ...settings.tagLinkStyle    
              };
              break;
          }
          return;
        }
        linkstyle = {
          ...linkstyle,
          ...plugin.hierarchyLinkStylesExtended[h]
        }
      })
    }
    // Up / Down region of the link, from the fields in hierarchyDefinition (docs/ontology-axis-design.md §1).
    // Inferred links carry no definition, so they get no region.
    const axis = axisOf(hierarchyDefinition, plugin.hierarchyLowerCase);
    const axisStyle: LinkStyle = axis === "abstract"
      ? settings.upLinkStyle
      : axis === "concrete"
        ? settings.downLinkStyle
        : {};
    // Layered base, inferred, region, per-field: a per-field style still wins over the region's.
    this.style = {
      ...settings.baseLinkStyle,
      ...this.isInferred
        ? settings.inferredLinkStyle
        : {},
      ...axisStyle,
      ...linkstyle
    };
  }

  /**
   * `view3D` (docs/3d-design.md §6-3): the line joins the two boxes themselves (`Node.id`, whose centres
   * `connectObjects` links and clips at the outlines), thin and faint; the colour, dash and arrowheads of the
   * region and per-field style stay. Scene draws links behind the nodes, so the line ends under the boxes.
   * In 2D (the default) nothing changes: the role picks the gates as upstream does (`gateIds()`).
   */
  render(hide: boolean, view3D: boolean = false) {
    const ea = this.ea;
    const style = this.style;
    applyEAStyle(ea, {
      strokeStyle: style.strokeStyle,
      roughness: style.roughness,
      strokeColor: style.strokeColor,
      strokeWidth: view3D ? LINK_3D.strokeWidth : style.strokeWidth,
      opacity: hide ? 10 : view3D ? LINK_3D.opacity : 100,
    });
    const [startId, endId] = view3D ? [this.nodeA.id, this.nodeB.id] : this.gateIds();
    const id = ea.connectObjects(
      startId,
      null,
      endId,
      null,
      {
        startArrowHead: style.startArrowHead === "none" ? null : style.startArrowHead,
        endArrowHead: style.endArrowHead === "none" ? null : style.endArrowHead,
      }
    )
    if(style.showLabel && this.hierarchyDefinition) {
      applyEAStyle(ea, {
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        strokeColor: style.textColor,
      });
      ea.addLabelToLine(id,this.hierarchyDefinition);
    }
  }

  /**
   * The gates to connect in 2D, nodeA's first (the arrow keeps its nodeA → nodeB direction), by role as
   * upstream does: a parent/child link joins the child gate (bottom) of the upper node to the parent gate
   * (top) of the lower one, since Layout puts parents north and children south; left/right links use the
   * friend gates. Not read in 3D, where the gates are not drawn.
   */
  private gateIds(): [gateAId: string, gateBId: string] {
    const a = this.nodeA;
    const b = this.nodeB;
    switch(this.nodeBRole) {
      case Role.CHILD:
        return [a.childGateId, b.parentGateId];
      case Role.PARENT:
        return [a.parentGateId, b.childGateId];
      case Role.RIGHT:
        return [a.nextFriendGateId, b.nextFriendGateId];
      default:
        return [a.friendGateId, b.friendGateId];
    }
  }
}