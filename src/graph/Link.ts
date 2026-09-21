import { ExcalidrawAutomate, applyEAStyle } from "src/utils/ExcalidrawAutomateCompatibility";
import ExcaliBrain from "src/excalibrain-main";
import { ExcaliBrainSettings } from "src/Settings";
import { LinkStyle, RelationType, Role } from "src/Types";
import { axisOf } from "src/utils/hierarchy";
import { Node } from "./Node";

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
   * `view3D`: pick the parent/child gates from the projected centres instead of the role
   * (see `gateIds()`). The 2D path never passes it, so it keeps the upstream gates.
   */
  render(hide: boolean, view3D: boolean = false) {
    const ea = this.ea;
    const style = this.style;
    applyEAStyle(ea, {
      strokeStyle: style.strokeStyle,
      roughness: style.roughness,
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth,
      opacity: hide ? 10 : 100,
    });
    const [gateAId, gateBId] = this.gateIds(view3D);
    const id = ea.connectObjects(
      gateAId,
      null,
      gateBId,
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
   * The gates to connect, nodeA's first (the arrow keeps its nodeA → nodeB direction). A parent/child
   * link joins the child gate (bottom) of the upper node to the parent gate (top) of the lower one.
   * In 2D the role says which node is upper, since Layout puts parents north and children south. In 3D
   * a parent on the ground can be projected below the centre (docs/3d-design.md §1 「ゲートの向きの問題」),
   * so the projected centres `Scene.render3D()` stored with `setCenter()` decide, and the role only breaks
   * a tie. Left/right links keep the friend gates.
   */
  private gateIds(view3D: boolean): [gateAId: string, gateBId: string] {
    const a = this.nodeA;
    const b = this.nodeB;
    switch(this.nodeBRole) {
      case Role.CHILD:
      case Role.PARENT: {
        const dy = view3D ? b.getCenter().y - a.getCenter().y : 0;
        const bBelowA = dy === 0 ? this.nodeBRole === Role.CHILD : dy > 0;
        return bBelowA
          ? [a.childGateId, b.parentGateId]
          : [a.parentGateId, b.childGateId];
      }
      case Role.RIGHT:
        return [a.nextFriendGateId, b.nextFriendGateId];
      default:
        return [a.friendGateId, b.friendGateId];
    }
  }
}