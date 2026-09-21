import {
  App,
  DropdownComponent,
  PluginSettingTab,
  Setting,
  SliderComponent,
  TextAreaComponent,
  TextComponent,
  ToggleComponent,
} from "obsidian";
import { Page } from "./graph/Page";
import { t } from "./lang/helpers";
import ExcaliBrain from "./excalibrain-main";
import { Hierarchy, NodeStyle, LinkStyle, RelationType, NodeStyleData, LinkStyleData, LinkDirection, Role, View3DSettings } from "./Types";
import { WarningPrompt } from "./utils/Prompts";
import { Node as GraphNode } from "./graph/Node";
import { svgToBase64 } from "./utils/utils";
import { Link } from "./graph/Link";
import { DEFAULT_AXIS_LINK_STYLE, DEFAULT_HIERARCHY_DEFINITION, DEFAULT_LEVEL_COLORS, DEFAULT_LINK_STYLE, DEFAULT_NODE_STYLE, DEFAULT_VIEW_3D_SETTINGS, PREDEFINED_LINK_STYLES } from "./constants/constants";
import { ExcalidrawAutomate, getEA } from "./utils/ExcalidrawAutomateCompatibility";
import { axisOf, compareFieldsIgnoringCase, toHierarchyKey, type HierarchyAxis } from "./utils/hierarchy";

export interface ExcaliBrainSettings {
  compactView: boolean;
  compactingFactor: number;
  minLinkLength: number;
  excalibrainFilepath: string;
  indexUpdateInterval: number;
  hierarchy: Hierarchy;
  inferAllLinksAsFriends: boolean;
  inverseInfer: boolean;
  inverseArrowDirection: boolean;
  renderAlias: boolean;
  nodeTitleScript: string;
  backgroundColor: string;
  excludeFilepaths: string[];
  autoOpenCentralDocument: boolean;
  toggleEmbedTogglesAutoOpen: boolean;
  showInferredNodes: boolean;
  showAttachments: boolean;
  showURLNodes: boolean;
  showVirtualNodes: boolean;
  showFolderNodes: boolean;
  showTagNodes: boolean;
  showPageNodes: boolean;
  showNeighborCount: boolean;
  showFullTagName: boolean;
  maxItemCount: number;
  /** Per-area node cap while the 3D view is on (docs/3d-design.md §4-1). The 2D view keeps `maxItemCount`. */
  maxItemCount3D: number;
  /**
   * Cabinet projection of the 3D view (docs/3d-design.md §6-1): `northShearX`, `northRise`, `levelHeightFactor`.
   * The 3D toggle itself (`Scene.view3D`) is not saved. `loadSettings()` merges the defaults into a saved object.
   */
  view3D: View3DSettings;
  /**
   * Node background per level while the 3D view is on (docs/3d-design.md §6-3), indexed by `level − floor`
   * (the floor is index 0, shown as L1). Defaults: `DEFAULT_LEVEL_COLORS`, the four steps of the feedback mock.
   * A level beyond the array keeps the node's own colour. The 2D view never reads it.
   */
  levelColors: string[];
  renderSiblings: boolean;
  applyPowerFilter: boolean;
  baseNodeStyle: NodeStyle;
  centralNodeStyle: NodeStyle;
  inferredNodeStyle: NodeStyle;
  urlNodeStyle: NodeStyle;
  virtualNodeStyle: NodeStyle;
  siblingNodeStyle: NodeStyle;
  attachmentNodeStyle: NodeStyle;
  folderNodeStyle: NodeStyle;
  tagNodeStyle: NodeStyle;
  tagNodeStyles: {[key: string]: NodeStyle};
  tagStyleList: string[];
  primaryTagField: string;
  primaryTagFieldLowerCase: string; //automatically populated
  displayAllStylePrefixes: boolean;
  baseLinkStyle: LinkStyle;
  inferredLinkStyle: LinkStyle;
  folderLinkStyle: LinkStyle;
  tagLinkStyle: LinkStyle;
  /** Style of links whose field is in the Up (abstract) region; a per-field style in hierarchyLinkStyles wins over it. */
  upLinkStyle: LinkStyle;
  /** Same for the Down (concrete) region. */
  downLinkStyle: LinkStyle;
  hierarchyLinkStyles: {[key: string]: LinkStyle};
  navigationHistory: string[];
  allowOntologySuggester: boolean;
  ontologySuggesterParentTrigger: string;
  ontologySuggesterChildTrigger: string;
  ontologySuggesterLeftFriendTrigger: string;
  ontologySuggesterRightFriendTrigger: string;
  ontologySuggesterPreviousTrigger: string;
  ontologySuggesterNextTrigger: string;
  ontologySuggesterTrigger: string;
  ontologySuggesterMidSentenceTrigger: string;
  boldFields: boolean;
  allowAutozoom: boolean;
  maxZoom: number;
  allowAutofocuOnSearch: boolean;
  defaultAlwaysOnTop: boolean;
  embedCentralNode: boolean;
  centerEmbedWidth: number;
  centerEmbedHeight: number;
}

export const DEFAULT_SETTINGS: ExcaliBrainSettings = {
  compactView: false,
  compactingFactor: 1.5,
  minLinkLength: 18,
  excalibrainFilepath: "excalibrain.md",
  indexUpdateInterval: 60000,
  hierarchy: DEFAULT_HIERARCHY_DEFINITION,
  inferAllLinksAsFriends: false,
  inverseInfer: false,
  inverseArrowDirection: true,
  renderAlias: true,
  nodeTitleScript: "",
  backgroundColor: "#0c3e6aff",
  excludeFilepaths: [],
  autoOpenCentralDocument: true,
  toggleEmbedTogglesAutoOpen: true,
  showInferredNodes: true,
  showAttachments: true,
  showURLNodes: true,
  showVirtualNodes: true,
  showFolderNodes: false,
  showTagNodes: false,
  showPageNodes: true,
  showNeighborCount: true,
  showFullTagName: false,
  maxItemCount: 30,
  maxItemCount3D: 12,
  view3D: { ...DEFAULT_VIEW_3D_SETTINGS },
  levelColors: [...DEFAULT_LEVEL_COLORS],
  renderSiblings: false,
  applyPowerFilter: false,
  baseNodeStyle: DEFAULT_NODE_STYLE,
  centralNodeStyle: {
    fontSize: 30,
    backgroundColor: "#B5B5B5",
    textColor: "#000000ff",
  },
  inferredNodeStyle: {
    backgroundColor: "#000005b3",
    textColor: "#95c7f3ff",
  },
  urlNodeStyle: {
    prefix: "🌐 "
  },
  virtualNodeStyle: {
    backgroundColor: "#ff000066",
    fillStyle: "hachure",
    textColor: "#ffffffff",
  },
  siblingNodeStyle: {
    fontSize: 15,
  },
  attachmentNodeStyle: {
    prefix: "📎 ",
  },
  folderNodeStyle: {
    prefix: "📂 ",
    strokeShaprness: "sharp",
    borderColor: "#ffd700ff",
    textColor: "#ffd700ff"
  },
  tagNodeStyle: {
    prefix: "#",
    strokeShaprness: "sharp",
    borderColor: "#4682b4ff",
    textColor: "#4682b4ff"
  },
  tagNodeStyles: {},
  tagStyleList: [],
  primaryTagField: "Note type",
  primaryTagFieldLowerCase: "note-type",
  displayAllStylePrefixes: true,  
  baseLinkStyle: DEFAULT_LINK_STYLE,
  inferredLinkStyle: {
    strokeStyle: "dashed",
  },
  folderLinkStyle: {
    strokeColor: "#ffd700ff",
  },
  tagLinkStyle: {
    strokeColor: "#4682b4ff",
  },
  // Two objects, not one shared: the settings tab edits a style object in place, so a shared
  // one would make an edit to Up show up in Down. (Like the other link styles, a data.json
  // without these keys still gets these very objects from Object.assign in loadSettings.)
  upLinkStyle: { ...DEFAULT_AXIS_LINK_STYLE },
  downLinkStyle: { ...DEFAULT_AXIS_LINK_STYLE },
  hierarchyLinkStyles: {},
  navigationHistory: [],
  allowOntologySuggester: true,
  ontologySuggesterParentTrigger: "::p",
  ontologySuggesterChildTrigger: "::c",
  ontologySuggesterLeftFriendTrigger: "::l",
  ontologySuggesterRightFriendTrigger: "::r",
  ontologySuggesterPreviousTrigger: "::e",
  ontologySuggesterNextTrigger: "::n",
  ontologySuggesterTrigger: ":::",
  ontologySuggesterMidSentenceTrigger: "(",
  boldFields: false,
  allowAutozoom: true,
  maxZoom: 1,
  allowAutofocuOnSearch: true,
  defaultAlwaysOnTop: false,
  embedCentralNode: false,
  centerEmbedWidth: 550,
  centerEmbedHeight: 700,
};

const HIDE_DISABLED_STYLE = "excalibrain-hide-disabled";
const HIDE_DISABLED_CLASS = "excalibrain-settings-disabled";

/**
 * Keys of the Up / Down region styles (settings.upLinkStyle / downLinkStyle) in the link style
 * dropdown. Not plain "up" / "down": those are field names in the default ontology and would
 * collide with a per-field style. Kept apart from PREDEFINED_LINK_STYLES because the entries are
 * registered by this tab (ensureAxisLinkStyles), not by loadSettings.
 */
const UP_LINK_STYLE_KEY = "up-axis";
const DOWN_LINK_STYLE_KEY = "down-axis";
const AXIS_LINK_STYLE_KEYS = [UP_LINK_STYLE_KEY, DOWN_LINK_STYLE_KEY];

const getHex = (color:string) => color.substring(0,7);
const getAlphaFloat = (color:string) => parseInt(color.substring(7,9),16)/255;
const getAlphaHex = (a: number) => ((a * 255) | 1 << 8).toString(16).slice(1)

const decodeMarkupEntities = (text: string): string => text
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&thinsp;", "\u2009");

/** Render the small trusted formatting vocabulary used by locale strings. */
const fragWithHTML = (markup: string): DocumentFragment => createFragment((frag) => {
  const doc = frag.ownerDocument;
  const stack: Array<{tag: string; node: HTMLElement}> = [];
  let parent: DocumentFragment | HTMLElement = frag;

  const createFormattingElement = (tag: string): HTMLElement | null => {
    switch(tag) {
      case "b": return createEl("b");
      case "i": return createEl("i");
      case "u": return createEl("u");
      case "code": return createEl("code");
      case "kbd": return createEl("kbd");
      case "mark": return createEl("mark");
      case "ul": return createEl("ul");
      case "ol": return createEl("ol");
      case "li": return createEl("li");
      default: return null;
    }
  };

  markup.split(/(<[^>]+>)/g).filter(Boolean).forEach((token) => {
    if(!token.startsWith("<")) {
      parent.appendChild(doc.createTextNode(decodeMarkupEntities(token)));
      return;
    }

    const match = token.match(/^<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>$/);
    if(!match) {
      parent.appendChild(doc.createTextNode(token));
      return;
    }

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    if(tag === "br") {
      if(!closing) parent.appendChild(createEl("br"));
      return;
    }
    if(closing) {
      const index = stack.map((item) => item.tag).lastIndexOf(tag);
      if(index >= 0) stack.splice(index);
      parent = stack.at(-1)?.node ?? frag;
      return;
    }

    const element = createFormattingElement(tag);
    if(!element) {
      parent.appendChild(doc.createTextNode(token));
      return;
    }
    parent.appendChild(element);
    stack.push({tag, node: element});
    parent = element;
  });
});


export class ExcaliBrainSettingTab extends PluginSettingTab {
  private isPersistingSettings: boolean = false;
  private settingsFocusoutHandler: ((event: FocusEvent) => void) | null = null;
  plugin: ExcaliBrain;
  ea: ExcalidrawAutomate;
  private dirty:boolean = false;
  private demoNode: GraphNode;
  private demoNodeImg: HTMLImageElement;
  private demoLinkImg: HTMLImageElement;
  private demoLinkStyle: LinkStyleData;
  /** Dropdown key of demoLinkStyle; the region entries are told apart by key, not by object identity. */
  private demoLinkStyleKey: string = "base";
  /** Region of demoLinkStyle when its pickers were built, to rebuild them when a textarea moves the field. */
  private demoLinkAxis: HierarchyAxis | null = null;
  private demoNodeStyle: NodeStyleData;
  private updateTimer: boolean = false;

  constructor(app: App, plugin: ExcaliBrain) {
    super(app, plugin);
    this.plugin = plugin;
  }

  get hierarchyStyleList(): string[] {
    return PREDEFINED_LINK_STYLES
      .concat(Array.from(this.plugin.settings.hierarchy.hidden))
      .concat(Array.from(this.plugin.settings.hierarchy.abstract))
      .concat(Array.from(this.plugin.settings.hierarchy.concrete))
      .concat(Array.from(this.plugin.settings.hierarchy.parents))
      .concat(Array.from(this.plugin.settings.hierarchy.children))
      .concat(Array.from(this.plugin.settings.hierarchy.leftFriends))
      .concat(Array.from(this.plugin.settings.hierarchy.rightFriends))
      .concat(Array.from(this.plugin.settings.hierarchy.previous))
      .concat(Array.from(this.plugin.settings.hierarchy.next));
  };

  /**
   * The Up / Down region styles as entries of the link style dropdown, next to base / inferred /
   * folder / tag. plugin.linkStyles is read only by this tab, so the two entries are added here
   * rather than in excalibrain-main.ts. Every loadSettings() (display(), but also Scene and the
   * ontology modal) rebuilds the map without them, so this runs before each lookup and only fills
   * what is missing. Their inherited style is base: Link layers base → inferred → region → field.
   */
  private ensureAxisLinkStyles() {
    const { settings, linkStyles } = this.plugin;
    linkStyles[UP_LINK_STYLE_KEY] ??= {
      style: settings.upLinkStyle,
      allowOverride: true,
      userStyle: false,
      display: t("LINKSTYLE_UP"),
      getInheritedStyle: () => this.plugin.settings.baseLinkStyle,
    };
    linkStyles[DOWN_LINK_STYLE_KEY] ??= {
      style: settings.downLinkStyle,
      allowOverride: true,
      userStyle: false,
      display: t("LINKSTYLE_DOWN"),
      getInheritedStyle: () => this.plugin.settings.baseLinkStyle,
    };
  }

  /** The region a per-field entry's field is in; the predefined and region entries have none. */
  private axisOfLinkStyle(ls: LinkStyleData): HierarchyAxis | null {
    return ls.userStyle ? axisOf(ls.display, this.plugin.hierarchyLowerCase) : null;
  }

  /**
   * What the canvas draws under a link style entry: base for the predefined and region entries,
   * base plus the region style for a per-field entry whose field is in Up / Down. Used for the
   * pickers' inherited values and the demo image so they match Link's base → inferred → region →
   * field layering.
   */
  private inheritedLinkStyle(ls: LinkStyleData): LinkStyle {
    const inherited = ls.getInheritedStyle();
    switch(this.axisOfLinkStyle(ls)) {
      case "abstract": return { ...inherited, ...this.plugin.settings.upLinkStyle };
      case "concrete": return { ...inherited, ...this.plugin.settings.downLinkStyle };
      default: return inherited;
    }
  }

  /**
   * The demo link points north (to a parent) for the Up region's own entry and for fields in Up
   * or Parents; the Down entry and its fields point south like Children, as everything else does.
   */
  private demoLinkIsParent(): boolean {
    const { hierarchy } = this.plugin.settings;
    const { display } = this.demoLinkStyle;
    return this.demoLinkStyleKey === UP_LINK_STYLE_KEY || hierarchy.abstract.contains(display) || hierarchy.parents.contains(display);
  }

  async updateNodeDemoImg() {
    this.ea.reset();
    this.ea.canvas.viewBackgroundColor = this.plugin.settings.backgroundColor;
    this.demoNode.style = {
      ...this.demoNodeStyle.getInheritedStyle(),
      ...this.demoNodeStyle.style
    }
    await this.demoNode.render();
    const svg = await this.ea.createSVG(null,true,{withBackground:true, withTheme:false},null,"",40);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    this.demoNodeImg.setAttribute("src", svgToBase64(svg.outerHTML));
  };

  async updateLinkDemoImg() {
    this.ea.reset();
    this.ea.canvas.viewBackgroundColor = this.plugin.settings.backgroundColor;    

    const page = new Page(
      null,
      "Start node",
      null,
      this.plugin
    )
    const page2 = new Page(
      null,
      "End node",
      null,
      this.plugin
    )

    const hierarchy = this.plugin.settings.hierarchy;

    if(hierarchy.leftFriends.contains(this.demoLinkStyle.display)) {
      page.addLeftFriend(page2,RelationType.DEFINED,LinkDirection.FROM);
      page2.addLeftFriend(page,RelationType.DEFINED,LinkDirection.TO);        
    } else if(hierarchy.rightFriends.contains(this.demoLinkStyle.display)) {
      page.addRightFriend(page2,RelationType.DEFINED,LinkDirection.FROM);
      page2.addRightFriend(page,RelationType.DEFINED,LinkDirection.TO);        
    } else if(this.demoLinkIsParent()) {
      page.addParent(page2,RelationType.DEFINED,LinkDirection.FROM);
      page2.addChild(page,RelationType.DEFINED,LinkDirection.TO);  
    } else {
      page.addChild(page2,RelationType.DEFINED,LinkDirection.FROM);
      page2.addParent(page,RelationType.DEFINED,LinkDirection.TO);  
    }

    const demoNode = new GraphNode({
      ea: this.ea,
      page,
      isInferred: false,
      isCentral: true,
      isSibling: false,
      friendGateOnLeft: true
    })
    demoNode.ea = this.ea;
    demoNode.setCenter({x:0,y:0}) 

    const demoNode2 = new GraphNode({
      ea: this.ea,
      page: page2,
      isInferred:false,
      isCentral: false,
      isSibling: false,
      friendGateOnLeft: false
    })
    demoNode2.ea = this.ea;
    let role:Role = Role.CHILD;
    if(hierarchy.leftFriends.contains(this.demoLinkStyle.display)) {
      demoNode2.setCenter({x:-300,y:0});
      role = Role.LEFT;
    } else if(hierarchy.rightFriends.contains(this.demoLinkStyle.display)) {
      demoNode2.setCenter({x:300,y:0});
      role = Role.RIGHT;
    } else if(this.demoLinkIsParent()) {
      demoNode2.setCenter({x:0,y:-150});
      role = Role.PARENT
    } else {
      demoNode2.setCenter({x:0,y:150});
    }       

    const demoLink = new Link(
      demoNode,
      demoNode2,
      role,
      RelationType.DEFINED,
      "base",
      this.ea,
      this.plugin.settings,
      this.plugin
    );

    demoNode.style = {
      ...this.plugin.settings.baseNodeStyle,
      ...this.plugin.settings.centralNodeStyle,
    }
    await demoNode.render();

    demoNode2.style = {
      ...this.demoNodeStyle.getInheritedStyle(),
      ...this.demoNodeStyle.style
    }
    await demoNode2.render();

    demoLink.style = {
      ...this.inheritedLinkStyle(this.demoLinkStyle),
      ...this.demoLinkStyle.style
    }
    demoLink.render(false);

    const svg = await this.ea.createSVG(null,true,{withBackground:true, withTheme:false},null,"",40);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    this.demoLinkImg.setAttribute("src", svgToBase64(svg.outerHTML));
  };

private normalizeSettings() {
    if (this.plugin.settings.ontologySuggesterParentTrigger === "") {
      this.plugin.settings.ontologySuggesterParentTrigger = "::p";
    }
    if (this.plugin.settings.ontologySuggesterChildTrigger === "") {
      this.plugin.settings.ontologySuggesterChildTrigger = "::c";
    }
    if (this.plugin.settings.ontologySuggesterLeftFriendTrigger === "") {
      this.plugin.settings.ontologySuggesterLeftFriendTrigger = "::l";
    }
    if (this.plugin.settings.ontologySuggesterRightFriendTrigger === "") {
      this.plugin.settings.ontologySuggesterRightFriendTrigger = "::r";
    }
    if (this.plugin.settings.ontologySuggesterPreviousTrigger === "") {
      this.plugin.settings.ontologySuggesterPreviousTrigger = "::e";
    }
    if (this.plugin.settings.ontologySuggesterNextTrigger === "") {
      this.plugin.settings.ontologySuggesterNextTrigger = "::n";
    }
    if (this.plugin.settings.ontologySuggesterTrigger === "") {
      this.plugin.settings.ontologySuggesterTrigger = ":::";
    }
    if (this.plugin.settings.ontologySuggesterMidSentenceTrigger === "") {
      this.plugin.settings.ontologySuggesterMidSentenceTrigger = "(";
    }

    this.plugin.settings.tagStyleList = Object.keys(this.plugin.settings.tagNodeStyles);
  }

  private applyPendingActions() {
    this.plugin.setHierarchyLinkStylesExtended();
    this.plugin.loadCustomNodeLabelFunction();
    if (this.plugin.scene && !this.plugin.scene.terminated) {
      this.plugin.scene.setBaseLayoutParams();

      if (this.updateTimer) {
        this.plugin.scene.setTimer();
        this.updateTimer = false;
      }
        
      void this.plugin.scene.reRender();
    }
  }

  private async executeSaveAndApply() {
    if (!this.dirty || this.isPersistingSettings) {
      return;
    }

    this.isPersistingSettings = true;
    try {
      // Loop allows us to capture settings dirtied concurrently during the async save
      while (this.dirty) {
        this.dirty = false;
        
        this.normalizeSettings();
        
        // Apply actions synchronously before the file write starts. 
        // This mirrors the original logic and prevents race conditions if the modal is closing.
        this.applyPendingActions();
        
        await this.plugin.saveSettings();
      }
    } finally {
      this.isPersistingSettings = false;
    }
  }

  private detachSettingsFocusoutHandler() {
    if (!this.settingsFocusoutHandler) {
      return;
    }
    this.containerEl.removeEventListener(
      "focusout",
      this.settingsFocusoutHandler,
    );
    this.settingsFocusoutHandler = null;
  }

  private attachSettingsFocusoutHandler() {
    this.detachSettingsFocusoutHandler();
    this.settingsFocusoutHandler = (event: FocusEvent) => {
      window.setTimeout(() => {
        if (!this.containerEl?.isConnected) {
          return;
        }

        const doc = this.containerEl.ownerDocument;
        const ownerWindow = doc.defaultView;
        const nextFocusTarget = ownerWindow && event.relatedTarget instanceof ownerWindow.Node
          ? event.relatedTarget
          : doc.activeElement;
        
        // If the new focus is still inside the settings container AND the document still has focus, do nothing
        if (doc.hasFocus() && nextFocusTarget && this.containerEl.contains(nextFocusTarget)) {
          return;
        }

        // Execute pending actions if settings are dirty
        if (this.dirty) {
          void this.executeSaveAndApply();
        }
      }, 0);
    };
    this.containerEl.addEventListener("focusout", this.settingsFocusoutHandler);
  }

  hide(): void {
    this.detachSettingsFocusoutHandler();
    if (this.dirty) {
      void this.executeSaveAndApply();
    }
  }

  colorpicker(
    containerEl: HTMLElement,
    name: string,
    description: string,
    getValue:()=>string,
    setValue:(val:string)=>void,
    deleteValue:()=>void,
    allowOverride: boolean,
    defaultValue: string
  ) {
    let sliderComponent: SliderComponent;
    let picker: HTMLInputElement;
    let toggleComponent: ToggleComponent;
    let colorLabel: HTMLSpanElement;
    let opacityLabel: HTMLSpanElement;
    let displayText: HTMLDivElement;

    const setting = new Setting(containerEl)
      .setName(name)

    if(description) {
      setting.setDesc(fragWithHTML(description));
    }

    const setDisabled = (isDisabled:boolean) => {
      if(isDisabled) {
        setting.settingEl.addClass(HIDE_DISABLED_CLASS);
      } else {
        setting.settingEl.removeClass(HIDE_DISABLED_CLASS);
      }      
      picker.disabled = isDisabled;
      picker.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
      sliderComponent.setDisabled(isDisabled);
      sliderComponent.sliderEl.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
      colorLabel.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
      opacityLabel.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
      displayText.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
    }
    if(allowOverride) {
      setting.addToggle(toggle => {
        toggleComponent = toggle;
        toggle.toggleEl.addClass("excalibrain-settings-toggle");
        toggle
          .setValue(typeof getValue() !== "undefined")
          .setTooltip(t("NODESTYLE_INCLUDE_TOGGLE"))
          .onChange(value => {
            this.dirty = true;
            if(!value) {
              setDisabled(true);
              deleteValue();
              return;
            }
            setValue(picker.value + getAlphaHex(sliderComponent.getValue()))
            setDisabled(false);
          })
      })
    }
    setting.settingEl.removeClass("mod-toggle");
    colorLabel = createSpan({
      text: "color:",
      cls: "excalibrain-settings-colorlabel"
    });
    
    setting.controlEl.appendChild(colorLabel)   

    picker = createEl("input", {
      type: "color",
      cls: "excalibrain-settings-colorpicker"
    },(el:HTMLInputElement)=>{
      el.value = getHex(getValue()??defaultValue);
      el.onchange = () => {
        setValue(el.value+ getAlphaHex(sliderComponent.getValue()));
        this.dirty = true;
      }
    });
    setting.controlEl.appendChild(picker);

    opacityLabel = createSpan({
      text: "opacity:",
      cls: "excalibrain-settings-opacitylabel"
    });
    setting.controlEl.appendChild(opacityLabel);

    setting.addSlider(slider => {
      sliderComponent = slider;
      slider
        .setLimits(0,1,0.1)
        .setValue(getAlphaFloat(getValue()??defaultValue))
        .onChange((value)=>{
          setValue(picker.value + getAlphaHex(value));
          displayText.innerText = ` ${value.toString()}`;
          picker.setCssProps({"opacity": value.toString()});
          this.dirty = true;
        })
    })

    displayText = createDiv({
      text: `${sliderComponent.getValue().toString()}`,
      cls: "excalibrain-settings-sliderlabel"
    });
    setting.controlEl.appendChild(displayText);
    picker.setCssProps({"opacity": sliderComponent.getValue().toString()});

    setDisabled(allowOverride && !toggleComponent.getValue());
    
  }

  numberslider(
    containerEl: HTMLElement,
    name: string,
    description: string,
    limits: {min:number,max:number,step:number},
    getValue:()=>number,
    setValue:(val:number)=>void,
    deleteValue:()=>void,
    allowOverride: boolean,
    defaultValue: number,
  ): Setting {
    let displayText: HTMLDivElement;
    let toggleComponent: ToggleComponent;
    let sliderComponent: SliderComponent;

    const setting = new Setting(containerEl).setName(name);

    const setDisabled = (isDisabled:boolean) => {
      if(isDisabled) {
        setting.settingEl.addClass(HIDE_DISABLED_CLASS);
      } else {
        setting.settingEl.removeClass(HIDE_DISABLED_CLASS);
      }
      sliderComponent.setDisabled(isDisabled);
      sliderComponent.sliderEl.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
      displayText.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
    }

    if(allowOverride) {
      setting.addToggle(toggle => {
        toggleComponent = toggle;
        toggle.toggleEl.addClass("excalibrain-settings-toggle");
        toggle
          .setValue(typeof getValue() !== "undefined")
          .setTooltip(t("NODESTYLE_INCLUDE_TOGGLE"))
          .onChange(value => {
            this.dirty = true;
            if(!value) {
              setDisabled(true);
              deleteValue();
              return;
            }
            setValue(sliderComponent.getValue())
            setDisabled(false);
          })
      })
    }
    
    setting.addSlider((slider) => {
      sliderComponent = slider;
      slider
        .setLimits(limits.min,limits.max,limits.step)
        .setValue(getValue()??defaultValue)
        .onChange((value) => {
          displayText.innerText = ` ${value.toString()}`;
          setValue(value);
          this.dirty = true;
        })
      });

    if(description) {
      setting.setDesc(fragWithHTML(description));
    }

    setting.settingEl.createDiv({ cls: "excalibrain-settings-number-value" }, (el) => {
      displayText = el;
      el.innerText = ` ${sliderComponent.getValue().toString()}`;
    });

    setDisabled(allowOverride && !toggleComponent.getValue());
    return setting;
  }

  toggle(
    containerEl: HTMLElement,
    name: string,
    description: string,
    getValue:()=>boolean,
    setValue:(val:boolean)=>void,
    deleteValue:()=>void,
    allowOverride: boolean,
    defaultValue: boolean,
  ) {
    let toggleComponent: ToggleComponent;
    let valueComponent: ToggleComponent;

    const setting = new Setting(containerEl).setName(name);

    const setDisabled = (isDisabled:boolean) => {
      if(isDisabled) {
        setting.settingEl.addClass(HIDE_DISABLED_CLASS);
      } else {
        setting.settingEl.removeClass(HIDE_DISABLED_CLASS);
      }
      valueComponent.setDisabled(isDisabled);
      valueComponent.toggleEl.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
    }

    if(allowOverride) {
      setting.addToggle(toggle => {
        toggleComponent = toggle;
        toggle.toggleEl.addClass("excalibrain-settings-toggle");
        toggle
          .setValue(typeof getValue() !== "undefined")
          .setTooltip(t("NODESTYLE_INCLUDE_TOGGLE"))
          .onChange(value => {
            this.dirty = true;
            if(!value) {
              setDisabled(true);
              deleteValue();
              return;
            }
            setValue(valueComponent.getValue())
            setDisabled(false);
          })
      })
    }
    
    setting.addToggle((toggle) => {
      valueComponent = toggle;
      toggle
        .setValue(getValue()??defaultValue)
        .onChange((value) => {
          setValue(value);
          this.dirty = true;
        })
      });

    if(description) {
      setting.setDesc(fragWithHTML(description));
    }

    setDisabled(allowOverride && !toggleComponent.getValue());
  }  

  dropdownpicker(
    containerEl: HTMLElement,
    name: string,
    description: string,
    options: Record<string,string>,
    getValue:()=>string,
    setValue:(val:string)=>void,
    deleteValue:()=>void,
    allowOverride: boolean,
    defaultValue: string,
  ) {
    let dropdownComponent: DropdownComponent;
    let toggleComponent: ToggleComponent;

    const setting = new Setting(containerEl).setName(name);

    const setDisabled = (isDisabled:boolean) => {
      if(isDisabled) {
        setting.settingEl.addClass(HIDE_DISABLED_CLASS);
      } else {
        setting.settingEl.removeClass(HIDE_DISABLED_CLASS);
      }
      dropdownComponent.setDisabled(isDisabled);
      dropdownComponent.selectEl.setCssProps({"opacity": isDisabled ? "0.3" : "1"});
    }

    if(allowOverride) {
      setting.addToggle(toggle => {
        toggleComponent = toggle;
        toggle.toggleEl.addClass("excalibrain-settings-toggle");
        toggle
          .setValue(typeof getValue() !== "undefined")
          .setTooltip(t("NODESTYLE_INCLUDE_TOGGLE"))
          .onChange(value => {
            this.dirty = true;
            if(!value) {
              setDisabled(true);
              deleteValue();
              return;
            }
            setValue(dropdownComponent.getValue())
            setDisabled(false);
          })
      })
    }

    setting.addDropdown(dropdown => {
      dropdownComponent = dropdown;
      dropdown
        .addOptions(options)
        .setValue(getValue()??defaultValue)
        .onChange(value => {
          setValue(value);
          this.dirty = true;
        })
      })

    if(description) {
      setting.setDesc(fragWithHTML(description));
    }

    setDisabled(allowOverride && !toggleComponent.getValue());
  }

  nodeSettings(
    containerEl: HTMLElement,
    setting: NodeStyle,
    allowOverride: boolean = true,
    inheritedStyle: NodeStyle
  ) {
   
    let textComponent: TextComponent;
    let toggleComponent: ToggleComponent;
    const prefixSetting = new Setting(containerEl)
      .setName(t("NODESTYLE_PREFIX_NAME"))
      .setDesc(fragWithHTML(t("NODESTYLE_PREFIX_DESC")));

    const setDisabled = (isDisabled: boolean) => {
      if(isDisabled) {
        prefixSetting.settingEl.addClass(HIDE_DISABLED_CLASS);
      } else {
        prefixSetting.settingEl.removeClass(HIDE_DISABLED_CLASS);
      }
      textComponent.setDisabled(isDisabled);
      textComponent.inputEl.setCssProps({"opacity": isDisabled ? "0.3" : "1"}); 
    }
    if(allowOverride) {
      prefixSetting.addToggle(toggle => {
        toggleComponent = toggle;
        toggle.toggleEl.addClass("excalibrain-settings-toggle");
        toggle
          .setValue(typeof setting.prefix !== "undefined")
          .setTooltip(t("NODESTYLE_INCLUDE_TOGGLE"))
          .onChange(value => {
            this.dirty = true;
            if(!value) {
              setDisabled(true);
              setting.prefix = undefined;
              void this.updateNodeDemoImg();
              return;
            }
            setDisabled(false);
          })
      })
    }
    prefixSetting
      .addText(text => {
        textComponent = text;
        text
          .setValue(setting.prefix??inheritedStyle.prefix)
          .onChange(value => {
            setting.prefix = value;
            void this.updateNodeDemoImg();
            this.dirty = true;
          })
      })  
    setDisabled(allowOverride && !toggleComponent.getValue());

    this.colorpicker(
      containerEl,
      t("NODESTYLE_BGCOLOR"),
      null,
      ()=>setting.backgroundColor,
      val=>{ 
        setting.backgroundColor=val;
        void this.updateNodeDemoImg();
      },
      ()=>{
        delete setting.backgroundColor;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.backgroundColor,
    );

    this.dropdownpicker(
      containerEl,
      t("NODESTYLE_BG_FILLSTYLE"),
      null,
      {"hachure": "Hachure", "cross-hatch": "Cross-hatch", "solid": "Solid"},
      () => setting.fillStyle?.toString(),
      (val) => {
        setting.fillStyle = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.fillStyle;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.fillStyle.toString(),
    )

    this.colorpicker(
      containerEl,
      t("NODESTYLE_TEXTCOLOR"),
      null,
      ()=>setting.textColor,
      val=> {
        setting.textColor=val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.textColor;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.textColor,
    );

    this.colorpicker(
      containerEl,
      t("NODESTYLE_BORDERCOLOR"),
      null,
      ()=>setting.borderColor,
      val=> {
        setting.borderColor=val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.borderColor;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.borderColor,
    );

    this.numberslider(
      containerEl,
      t("NODESTYLE_FONTSIZE"),
      null,
      {min:10,max:50,step:5},
      () => setting.fontSize,
      (val) => {
        setting.fontSize = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.fontSize;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.fontSize,
    )

    this.dropdownpicker(
      containerEl,
      t("NODESTYLE_FONTFAMILY"),
      null,
      {1:"Hand-drawn",2:"Normal",3:"Code",4:"Fourth (custom) Font"},
      () => setting.fontFamily?.toString(),
      (val) => {
        setting.fontFamily =  parseInt(val);
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.fontFamily;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.fontFamily.toString(),
    )

    this.numberslider(
      containerEl,
      t("NODESTYLE_MAXLABELLENGTH_NAME"),
      t("NODESTYLE_MAXLABELLENGTH_DESC"),
      {min:15,max:100,step:5},
      () => setting.maxLabelLength,
      (val) => {
        setting.maxLabelLength = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.maxLabelLength;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.maxLabelLength,
    )
    
    this.dropdownpicker(
      containerEl,
      t("NODESTYLE_ROUGHNESS"),
      null,
      {0:"Architect",1:"Artist",2:"Cartoonist"},
      () => setting.roughness?.toString(),
      (val) => {
        setting.roughness =  parseInt(val);
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.roughness;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.roughness.toString(),
    )

    this.dropdownpicker(
      containerEl,
      t("NODESTYLE_SHARPNESS"),
      null,
      {"sharp":"Sharp","round":"Round"},
      () => (typeof setting.strokeShaprness === "string" ? setting.strokeShaprness : ""),
      (val) => {
        if(val === "sharp" || val === "round") {
          setting.strokeShaprness = val;
          void this.updateNodeDemoImg();
        }
      },
      ()=> {
        delete setting.strokeShaprness;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      String(inheritedStyle.strokeShaprness ?? ""),
    )

    this.numberslider(
      containerEl,
      t("NODESTYLE_STROKEWIDTH"),
      null,
      {min:0.5,max:6,step:0.5},
      () => setting.strokeWidth,
      (val) => {
        setting.strokeWidth = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.strokeWidth;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.strokeWidth,
    )

    this.dropdownpicker(
      containerEl,
      t("NODESTYLE_STROKESTYLE"),
      null,
      {"solid":"Solid","dashed":"Dashed","dotted":"Dotted"},
      () => setting.strokeStyle,
      (val) => {
        setting.strokeStyle = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.strokeStyle;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.strokeStyle,
    )

    this.numberslider(
      containerEl,
      t("NODESTYLE_RECTANGLEPADDING"),
      null,
      {min:5,max:50,step:5},
      () => setting.padding,
      (val) => {
        setting.padding = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.padding;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.padding,
    )

    this.numberslider(
      containerEl,
      t("NODESTYLE_GATE_RADIUS_NAME"),
      t("NODESTYLE_GATE_RADIUS_DESC"),
      {min:3,max:10,step:1},
      () => setting.gateRadius,
      (val) => {
        setting.gateRadius = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.gateRadius;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.gateRadius,
    )
    
    this.numberslider(
      containerEl,
      t("NODESTYLE_GATE_OFFSET_NAME"),
      t("NODESTYLE_GATE_OFFSET_DESC"),
      {min:0,max:25,step:1},
      () => setting.gateOffset,
      (val) => {
        setting.gateOffset = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.gateOffset;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.gateOffset,
    )

    this.colorpicker(
      containerEl,
      t("NODESTYLE_GATE_COLOR"),
      null,
      ()=>setting.gateStrokeColor,
      val=> {
        setting.gateStrokeColor=val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.gateStrokeColor;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.gateStrokeColor,
    );
    
    this.colorpicker(
      containerEl,
      t("NODESTYLE_GATE_BGCOLOR_NAME"),
      t("NODESTYLE_GATE_BGCOLOR_DESC"),
      ()=>setting.gateBackgroundColor,
      val=> {
        setting.gateBackgroundColor=val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.gateBackgroundColor;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.gateBackgroundColor,
    );

    this.dropdownpicker(
      containerEl,
      t("NODESTYLE_GATE_FILLSTYLE"),
      null,
      {"hachure": "Hachure", "cross-hatch": "Cross-hatch", "solid": "Solid"},
      () => setting.gateFillStyle?.toString(),
      (val) => {
        setting.gateFillStyle = val;
        void this.updateNodeDemoImg();
      },
      ()=> {
        delete setting.gateFillStyle;
        void this.updateNodeDemoImg();
      },
      allowOverride,
      inheritedStyle.gateFillStyle.toString(),
    )
  }

  linkSettings(
    containerEl: HTMLElement,
    setting: LinkStyle,
    allowOverride: boolean = true,
    inheritedStyle: LinkStyle
  ) {
    this.colorpicker(
      containerEl,
      t("LINKSTYLE_COLOR"),
      null,
      ()=>setting.strokeColor,
      val=>{ 
        setting.strokeColor=val;
        void this.updateLinkDemoImg();
      },
      ()=>{
        delete setting.strokeColor;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.strokeColor,
    );

  this.numberslider(
      containerEl,
      t("LINKSTYLE_WIDTH"),
      null,
      {min:0.5,max:10,step:0.5},
      () => setting.strokeWidth,
      (val) => {
        setting.strokeWidth = val;
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.strokeWidth;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.strokeWidth,
    )

  this.dropdownpicker(
      containerEl,
      t("LINKSTYLE_ROUGHNESS"),
      null,
      {0:"Architect",1:"Artist",2:"Cartoonist"},
      () => setting.roughness?.toString(),
      (val) => {
        setting.roughness =  parseInt(val);
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.roughness;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.roughness.toString(),
    )

  this.dropdownpicker(
      containerEl,
      t("LINKSTYLE_STROKE"),
      null,
      {"solid":"Solid","dashed":"Dashed","dotted":"Dotted"},
      () => setting.strokeStyle,
      (val) => {
        setting.strokeStyle = val;
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.strokeStyle;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.strokeStyle,
    )
    
    this.dropdownpicker(
      containerEl,
      t("LINKSTYLE_ARROWSTART"),
      null,
      {"none":"None","arrow":"Arrow","bar":"Bar","dot":"Dot","triangle":"Triangle"},
      () => setting.startArrowHead,
      (val) => {
        setting.startArrowHead = (val === "") ? null : val;
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.startArrowHead;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.startArrowHead,
    )

    this.dropdownpicker(
      containerEl,
      t("LINKSTYLE_ARROWEND"),
      null,
      {"none":"None","arrow":"Arrow","bar":"Bar","dot":"Dot","triangle":"Triangle"},
      () => setting.endArrowHead,
      (val) => {
        setting.endArrowHead = (val === "") ? null : val;
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.endArrowHead;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.endArrowHead,
    )

    this.toggle(
      containerEl,
      t("LINKSTYLE_SHOWLABEL"),
      null,
      () => setting.showLabel,
      (val) => {
        setting.showLabel = val;
        void this.updateLinkDemoImg();
      },
      () => {
        delete setting.showLabel;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.showLabel
    )

    this.colorpicker(
      containerEl,
      t("NODESTYLE_TEXTCOLOR"),
      null,
      ()=>setting.textColor,
      val=> {
        setting.textColor=val;
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.textColor;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.textColor,
    );


    this.numberslider(
      containerEl,
      t("LINKSTYLE_FONTSIZE"),
      null,
      {min:6,max:30,step:3},
      () => setting.fontSize,
      (val) => {
        setting.fontSize = val;
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.fontSize;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.fontSize,
    )

    this.dropdownpicker(
      containerEl,
      t("LINKSTYLE_FONTFAMILY"),
      null,
      {1:"Hand-drawn",2:"Normal",3:"Code",4:"Fourth (custom) Font"},
      () => setting.fontFamily?.toString(),
      (val) => {
        setting.fontFamily =  parseInt(val);
        void this.updateLinkDemoImg();
      },
      ()=> {
        delete setting.fontFamily;
        void this.updateLinkDemoImg();
      },
      allowOverride,
      inheritedStyle.fontFamily.toString(),
    )

  }  

  getUnusedFieldNames():string {
    const fieldSet = new Set<string>();
    this.plugin.DVAPI.index.pages.forEach((p) => {
      const keys:IterableIterator<string> = p?.fields.keys();
      if(!keys) return;
      let f;
      while(!(f = keys.next()).done) {
        if(
          !f.value.contains(",") && 
          !(f.value.startsWith("**") && f.value.endsWith("**"))
        ) {
          fieldSet.add(f.value);
        }
      }
    });
    const fieldNameMap = new Map<string, string>();
    fieldSet.forEach((f:string)=>{
      fieldNameMap.set(f,f.toLowerCase().replaceAll(" ","-"))
    });
    const assigned = new Set<string>();
    this.plugin.settings.hierarchy.hidden.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))
    this.plugin.settings.hierarchy.abstract.forEach(x=>assigned.add(toHierarchyKey(x)))
    this.plugin.settings.hierarchy.concrete.forEach(x=>assigned.add(toHierarchyKey(x)))
    this.plugin.settings.hierarchy.parents.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))
    this.plugin.settings.hierarchy.children.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))
    this.plugin.settings.hierarchy.leftFriends.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))
    this.plugin.settings.hierarchy.rightFriends.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))
    this.plugin.settings.hierarchy.previous.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))
    this.plugin.settings.hierarchy.next.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))
    this.plugin.settings.hierarchy.exclusions.forEach(x=>assigned.add(x.toLowerCase().replaceAll(" ","-")))

    Array.from(fieldNameMap.entries()).forEach(([k,v])=>{
      if(assigned.has(k.toLowerCase().replaceAll(" ","-"))) {
        fieldNameMap.delete(k);
        fieldNameMap.delete(v);
        return;
      }
      if(assigned.has(v)) {
        fieldNameMap.delete(k);
        fieldNameMap.delete(v);
        return;
      }
      if(k!==v) fieldNameMap.delete(v);
    });
    return Array.from(fieldNameMap.keys()).sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1).join(", ")
  }

  display(): void {
    void this.displayAsync();
  }

  private async displayAsync(): Promise<void> {
    await this.plugin.loadSettings(); //in case sync loaded changed settings in the background
    this.ensureAxisLinkStyles();

    this.ea = getEA();

    //initialize sample 
    const page = new Page(
      null,
      "This is a demo node that is 46 characters long",
      null,
      this.plugin
    )
    const page2 = new Page(
      null,
      "This is a child node",
      null,
      this.plugin
    )
    page.addChild(page2,RelationType.DEFINED,LinkDirection.FROM);
    page2.addParent(page,RelationType.DEFINED,LinkDirection.TO);
    this.demoNode = new GraphNode({
      ea: this.ea,
      page,
      isInferred: false,
      isCentral: false,
      isSibling: false,
      friendGateOnLeft: true
    })
    this.demoNode.ea = this.ea;
    this.demoNode.setCenter({x:0,y:0}) 

    const { containerEl } = this;
    this.containerEl.empty();

    const coffeeDiv = containerEl.createDiv("coffee");
    coffeeDiv.addClass("ex-coffee-div");
    const coffeeLink = coffeeDiv.createEl("a", {
      href: "https://ko-fi.com/zsolt",
    });
    const coffeeImg = coffeeLink.createEl("img", {
      attr: {
        src: "https://cdn.ko-fi.com/cdn/kofi3.png?v=3",
      },
    });
    coffeeImg.height = 45;

    new Setting(containerEl)
      .setName(t("EXCALIBRAIN_FILE_NAME"))
      .setDesc(fragWithHTML(t("EXCALIBRAIN_FILE_DESC")))
      .addText(text=>
        text
          .setValue(this.plugin.settings.excalibrainFilepath)
          .onChange((value) => {
            this.dirty = true;
            if(!value.endsWith(".md")) {
              value = value + (value.endsWith(".m") ? "d" : value.endsWith(".") ? "md" : ".md");
            }
            const f = this.app.vault.getAbstractFileByPath(value);
            if(f) {
              new WarningPrompt(
                this.app,
                "⚠ File Exists",
                `${value} already exists in your Vault. Is it ok to overwrite this file?`)
              .show((result: boolean) => {
                if(result) {
                  this.plugin.settings.excalibrainFilepath = value;
                  this.dirty = true;
                  text.inputEl.value = value;
                }
              });
              return;
            }
            this.plugin.settings.excalibrainFilepath = value;
            this.dirty = true;
          })
          .inputEl.onblur = () => {text.setValue(this.plugin.settings.excalibrainFilepath)}
      )

      this.numberslider(
        containerEl,
        t("INDEX_REFRESH_FREQ_NAME"),
        t("INDEX_REFRESH_FREQ_DESC"),
        {min:5,max:600, step:5},
        ()=>this.plugin.settings.indexUpdateInterval/1000,
        (val)=>{
          this.plugin.settings.indexUpdateInterval = val*1000;
          this.updateTimer = true;
        },
        ()=>{},
        false,
        5000
      )
    
    this.containerEl.createEl("h1", {
      cls: "excalibrain-settings-h1",
      text: t("HIERARCHY_HEAD")
    });
    const hierarchyDesc = this.containerEl.createEl("p", {});
    hierarchyDesc.appendChild(fragWithHTML(t("HIERARCHY_DESC")));

    let onHierarchyChange: () => void = () => {};

    const hierarchyUpSetting = new Setting(containerEl)
      .setName(t("UP_NAME"))
      .setDesc(fragWithHTML(t("UP_DESC")))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.abstract.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.abstract = value
              .split(",")
              .map(s=>s.trim())
              .sort(compareFieldsIgnoringCase);
            this.plugin.hierarchyLowerCase.abstract = this.plugin.settings.hierarchy.abstract.map(toHierarchyKey);
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyUpSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyUpSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyUpSetting.controlEl.addClass("excalibrain-setting-controlEl");

    const hierarchyDownSetting = new Setting(containerEl)
      .setName(t("DOWN_NAME"))
      .setDesc(fragWithHTML(t("DOWN_DESC")))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.concrete.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.concrete = value
              .split(",")
              .map(s=>s.trim())
              .sort(compareFieldsIgnoringCase);
            this.plugin.hierarchyLowerCase.concrete = this.plugin.settings.hierarchy.concrete.map(toHierarchyKey);
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyDownSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyDownSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyDownSetting.controlEl.addClass("excalibrain-setting-controlEl");

    const hierarchyParentSetting = new Setting(containerEl)
      .setName(t("PARENTS_NAME"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.parents.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.parents = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
            this.plugin.hierarchyLowerCase.parents = [];
            this.plugin.settings.hierarchy.parents.forEach(f=>this.plugin.hierarchyLowerCase.parents.push(f.toLowerCase().replaceAll(" ","-")))
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyParentSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyParentSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyParentSetting.controlEl.addClass("excalibrain-setting-controlEl");

    const hierarchyChildSetting = new Setting(containerEl)
      .setName(t("CHILDREN_NAME"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.children.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.children = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
            this.plugin.hierarchyLowerCase.children = [];
            this.plugin.settings.hierarchy.children.forEach(f=>this.plugin.hierarchyLowerCase.children.push(f.toLowerCase().replaceAll(" ","-")))
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyChildSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyChildSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyChildSetting.controlEl.addClass("excalibrain-setting-controlEl");
  
    const hierarchyLeftFriendSetting = new Setting(containerEl)
      .setName(t("LEFT_FRIENDS_NAME"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.leftFriends.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.leftFriends = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
            this.plugin.hierarchyLowerCase.leftFriends = [];
            this.plugin.settings.hierarchy.leftFriends.forEach(f=>this.plugin.hierarchyLowerCase.leftFriends.push(f.toLowerCase().replaceAll(" ","-")))
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyLeftFriendSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyLeftFriendSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyLeftFriendSetting.controlEl.addClass("excalibrain-setting-controlEl");
   

    const hierarchyRightFriendSetting = new Setting(containerEl)
      .setName(t("RIGHT_FRIENDS_NAME"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.rightFriends.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.rightFriends = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
            this.plugin.hierarchyLowerCase.rightFriends = [];
            this.plugin.settings.hierarchy.rightFriends.forEach(f=>this.plugin.hierarchyLowerCase.rightFriends.push(f.toLowerCase().replaceAll(" ","-")))
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyRightFriendSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyRightFriendSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyRightFriendSetting.controlEl.addClass("excalibrain-setting-controlEl");

    const hierarchyPreviousSetting = new Setting(containerEl)
      .setName(t("PREVIOUS_NAME"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.previous.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.previous = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
            this.plugin.hierarchyLowerCase.previous = [];
            this.plugin.settings.hierarchy.previous.forEach(f=>this.plugin.hierarchyLowerCase.previous.push(f.toLowerCase().replaceAll(" ","-")))
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyPreviousSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyPreviousSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyPreviousSetting.controlEl.addClass("excalibrain-setting-controlEl");

    const hierarchyNextSetting = new Setting(containerEl)
      .setName(t("NEXT_NAME"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.next.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.next = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
            this.plugin.hierarchyLowerCase.next = [];
            this.plugin.settings.hierarchy.next.forEach(f=>this.plugin.hierarchyLowerCase.next.push(f.toLowerCase().replaceAll(" ","-")))
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyNextSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyNextSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyNextSetting.controlEl.addClass("excalibrain-setting-controlEl");

    const hierarchyHiddenSetting = new Setting(containerEl)
      .setName(t("HIDDEN_NAME"))
      .setDesc(t("HIDDEN_DESC"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.hidden.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.hidden = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
            this.plugin.hierarchyLowerCase.hidden = [];
            this.plugin.settings.hierarchy.hidden.forEach(f=>this.plugin.hierarchyLowerCase.hidden.push(f.toLowerCase().replaceAll(" ","-")))
            onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyHiddenSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyHiddenSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyHiddenSetting.controlEl.addClass("excalibrain-setting-controlEl");

    const hierarchyExclusionSetting = new Setting(containerEl)
      .setName(t("EXCLUSIONS_NAME"))
      .setDesc(t("EXCLUSIONS_DESC"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text
          .setValue(this.plugin.settings.hierarchy.exclusions.join(", "))
          .onChange(value => {
            this.plugin.settings.hierarchy.exclusions = value
              .split(",")
              .map(s=>s.trim())
              .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
              onHierarchyChange();
            this.dirty = true;
          })
      })
    hierarchyExclusionSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyExclusionSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyExclusionSetting.controlEl.addClass("excalibrain-setting-controlEl");

    let unassingedFieldsTextArea: TextAreaComponent;
    const hierarchyUnassignedSetting =new Setting(containerEl)
      .setName(t("UNASSIGNED_NAME"))
      .setDesc(t("UNASSIGNED_DESC"))
      .addTextArea((text)=> {
        unassingedFieldsTextArea = text;
        text.inputEl.addClass("excalibrain-settings-textarea-90");
        text.setValue(this.getUnusedFieldNames())
        text.setDisabled(true);
      })
    hierarchyUnassignedSetting.nameEl.addClass("excalibrain-setting-nameEl");
    hierarchyUnassignedSetting.descEl.addClass("excalibrain-setting-descEl");
    hierarchyUnassignedSetting.controlEl.addClass("excalibrain-setting-controlEl");

    new Setting(containerEl)
      .setName(t("INFER_NAME"))
      .setDesc(fragWithHTML(t("INFER_DESC")))
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.inferAllLinksAsFriends)
          .onChange(value => {
            this.plugin.settings.inferAllLinksAsFriends = value;
            this.dirty = true;
          })
        )

    new Setting(containerEl)
      .setName(t("REVERSE_NAME"))
      .setDesc(fragWithHTML(t("REVERSE_DESC")))
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.inverseInfer)
          .onChange(value => {
            this.plugin.settings.inverseInfer = value;
            this.dirty = true;
          })
        )

    new Setting(containerEl)
      .setName(t("INVERSE_ARROW_DIRECTION_NAME"))
      .setDesc(fragWithHTML(t("INVERSE_ARROW_DIRECTION_DESC")))
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.inverseArrowDirection)
          .onChange(value => {
            this.plugin.settings.inverseArrowDirection = value;
            this.dirty = true;
          })
        )

    let pSetting:Setting, cSetting:Setting, fSetting:Setting, gSetting: Setting, mSetting: Setting, bSetting: Setting;

    new Setting(containerEl)
      .setName(t("ONTOLOGY_SUGGESTER_NAME"))
      .setDesc(t("ONTOLOGY_SUGGESTER_DESC"))
      .addToggle(toggle=> 
        toggle
          .setValue(this.plugin.settings.allowOntologySuggester)
          .onChange(value => {
            this.plugin.settings.allowOntologySuggester = value;
            gSetting.setDisabled(!value);
            pSetting.setDisabled(!value);
            cSetting.setDisabled(!value);
            fSetting.setDisabled(!value);
            mSetting.setDisabled(!value);
            bSetting.setDisabled(!value);
            this.dirty = true;
          })
      )

    gSetting = new Setting(containerEl)
      .setName(t("ONTOLOGY_SUGGESTER_ALL_NAME"))
      .setDisabled(!this.plugin.settings.allowOntologySuggester)
      .addText(text=>
        text
          .setValue(this.plugin.settings.ontologySuggesterTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterTrigger = value;
            this.dirty = true;
          })  
      )

    pSetting = new Setting(containerEl)
      .setName(t("ONTOLOGY_SUGGESTER_PARENT_NAME"))
      .setDisabled(!this.plugin.settings.allowOntologySuggester)
      .addText(text=>
        text
          .setValue(this.plugin.settings.ontologySuggesterParentTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterParentTrigger = value;
            this.dirty = true;
          })  
      )
    

    cSetting = new Setting(containerEl)
      .setName(t("ONTOLOGY_SUGGESTER_CHILD_NAME"))
      .setDisabled(!this.plugin.settings.allowOntologySuggester)
      .addText(text=>
        text
          .setValue(this.plugin.settings.ontologySuggesterChildTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterChildTrigger = value;
            this.dirty = true;
          })  
      )

    fSetting = new Setting(containerEl)
      .setName(t("ONTOLOGY_SUGGESTER_LEFT_FRIEND_NAME"))
      .setDisabled(!this.plugin.settings.allowOntologySuggester)
      .addText(text=>
        text
          .setValue(this.plugin.settings.ontologySuggesterLeftFriendTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterLeftFriendTrigger = value;
            this.dirty = true;
          })  
      )

    fSetting = new Setting(containerEl)
      .setName(t("ONTOLOGY_SUGGESTER_RIGHT_FRIEND_NAME"))
      .setDisabled(!this.plugin.settings.allowOntologySuggester)
      .addText(text=>
        text
          .setValue(this.plugin.settings.ontologySuggesterRightFriendTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterRightFriendTrigger = value;
            this.dirty = true;
          })  
      )

    fSetting = new Setting(containerEl)
      .setName(fragWithHTML(t("ONTOLOGY_SUGGESTER_PREVIOUS_NAME")))
      .setDisabled(!this.plugin.settings.allowOntologySuggester)
      .addText(text=>
        text
          .setValue(this.plugin.settings.ontologySuggesterPreviousTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterPreviousTrigger = value;
            this.dirty = true;
          })  
      )

    fSetting = new Setting(containerEl)
      .setName(t("ONTOLOGY_SUGGESTER_NEXT_NAME"))
      .setDisabled(!this.plugin.settings.allowOntologySuggester)
      .addText(text=>
        text
          .setValue(this.plugin.settings.ontologySuggesterNextTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterNextTrigger = value;
            this.dirty = true;
          })  
      )

    mSetting = new Setting(containerEl)
      .setName(t("MID_SENTENCE_SUGGESTER_TRIGGER_NAME"))
      .setDesc(fragWithHTML(t("MID_SENTENCE_SUGGESTER_TRIGGER_DESC")))
      .addDropdown(dropdown => {
        dropdown
          .addOption("(","(")
          .addOption("[","[")
          .setValue(this.plugin.settings.ontologySuggesterMidSentenceTrigger)
          .onChange(value => {
            this.plugin.settings.ontologySuggesterMidSentenceTrigger = value;
            this.dirty = true;
          })
      })

    bSetting = new Setting(containerEl)
      .setName(t("BOLD_FIELDS_NAME"))
      .setDesc(fragWithHTML(t("BOLD_FIELDS_DESC")))
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.boldFields)
          .onChange(value => {
            this.plugin.settings.boldFields = value;
            this.dirty = true;
          }))

    // ------------------------------
    // Behavior
    // ------------------------------
    this.containerEl.createEl("h1", {
      cls: "excalibrain-settings-h1",
      text: t("BEHAVIOR_HEAD") 
    });

    //toggleEmbedTogglesAutoOpen: boolean;
    new Setting(containerEl)
    .setName(t("TOGGLE_AUTOOPEN_WHEN_EMBED_TOGGLE_NAME"))
    .setDesc(fragWithHTML(t("TOGGLE_AUTOOPEN_WHEN_EMBED_TOGGLE_DESC")))
    .addToggle(toggle => 
      toggle
        .setValue(this.plugin.settings.toggleEmbedTogglesAutoOpen)
        .onChange(value => {
          this.plugin.settings.toggleEmbedTogglesAutoOpen = value;
          this.dirty = true;
        }))

    const filepathList = new Setting(containerEl)
      .setName(t("EXCLUDE_PATHLIST_NAME"))
      .setDesc(fragWithHTML(t("EXCLUDE_PATHLIST_DESC")))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-100");
        text
          .setValue(this.plugin.settings.excludeFilepaths.join(", "))
          .onChange(value => {
            value = value.replaceAll("\n"," ");
            const paths = value.split(",").map(s=>s.trim());
            this.plugin.settings.excludeFilepaths = paths.filter(p=>p!=="");
            this.dirty = true;
          });
        })
    filepathList.descEl.addClass("excalibrain-setting-wide");
    filepathList.controlEl.addClass("excalibrain-setting-wide");
    
    const nodeScriptSetting = new Setting(containerEl)
      .setName(t("NODETITLE_SCRIPT_NAME"))
      .setDesc(fragWithHTML(t("NODETITLE_SCRIPT_DESC")))
      .addTextArea(text=> {
        text.inputEl.addClass("excalibrain-settings-textarea-200");
        text
          .setValue(this.plugin.settings.nodeTitleScript)
          .onChange(value => {
            this.plugin.settings.nodeTitleScript = value;
            this.dirty = true;
          })
        });
    nodeScriptSetting.descEl.addClass("excalibrain-setting-wide");
    nodeScriptSetting.controlEl.addClass("excalibrain-setting-wide");
    // ------------------------------
    // Display
    // ------------------------------
    this.containerEl.createEl("h1", {
      cls: "excalibrain-settings-h1",
      text: t("DISPLAY_HEAD") 
    });

    new Setting(containerEl)
      .setName(t("COMPACT_VIEW_NAME"))
      .setDesc(fragWithHTML(t("COMPACT_VIEW_DESC")))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.compactView)
        .onChange(value => {
          this.plugin.settings.compactView = value;
          this.dirty = true;
        })
      )

    this.numberslider(
      containerEl,
      t("COMPACTING_FACTOR_NAME"),
      t("COMPACTING_FACTOR_DESC"),
      {min:1,max:2,step:0.1},
      () => this.plugin.settings.compactingFactor,
      (val) => {
        this.plugin.settings.compactingFactor = val;
        this.dirty = true;
      },
      ()=> {
      },
      false,
      1,
    )
    
    this.numberslider(
      containerEl,
      t("MINLINKLENGTH_NAME"),
      t("MINLINKLENGTH_DESC"),
      {min:0,max:50,step:1},
      () => this.plugin.settings.minLinkLength,
      (val) => {
        this.plugin.settings.minLinkLength = val;
        this.dirty = true;
      },
      ()=> {
      },
      false,
      1,
    )

    new Setting(containerEl)
      .setName(t("SHOW_FULL_TAG_PATH_NAME"))
      .setDesc(fragWithHTML(t("SHOW_FULL_TAG_PATH_DESC")))
      .addToggle(toggle => 
        toggle
          .setValue(this.plugin.settings.showFullTagName)
          .onChange(value => {
            this.plugin.settings.showFullTagName = value;
            this.dirty = true;
          }))

    /*new Setting(containerEl)
      .setName(t("RENDERALIAS_NAME"))
      .setDesc(fragWithHTML(t("RENDERALIAS_DESC")))
      .addToggle(toggle=>
        toggle
          .setValue(this.plugin.settings.renderAlias)
          .onChange(value => {
            this.plugin.settings.renderAlias = value;
            this.dirty = true;
          })
      );

    new Setting(containerEl)
      .setName(t("SHOWINFERRED_NAME"))
      .setDesc(fragWithHTML(t("SHOWINFERRED_DESC")))
      .addToggle(toggle=>
        toggle
          .setValue(this.plugin.settings.showInferredNodes)
          .onChange(value => {
            this.plugin.settings.showInferredNodes = value;
            this.dirty = true;
          })
      );
    
    new Setting(containerEl)
      .setName(t("SHOWATTACHMENTS_NAME"))
      .setDesc(fragWithHTML(t("SHOWATTACHMENTS_DESC")))
      .addToggle(toggle=>
        toggle
          .setValue(this.plugin.settings.showAttachments)
          .onChange(value => {
            this.plugin.settings.showAttachments = value;
            this.dirty = true;
          })
      );

    new Setting(containerEl)
      .setName(t("SHOWVIRTUAL_NAME"))
      .setDesc(fragWithHTML(t("SHOWVIRTUAL_DESC")))
      .addToggle(toggle=>
        toggle
          .setValue(this.plugin.settings.showVirtualNodes)
          .onChange(value => {
            this.plugin.settings.showVirtualNodes = value;
            this.dirty = true;
          })
      );*/

    this.numberslider(
      containerEl,
      t("MAX_ITEMCOUNT_NAME"),
      t("MAX_ITEMCOUNT_DESC"),
      {min:5,max:150, step:5},
      ()=>this.plugin.settings.maxItemCount,
      (val)=>this.plugin.settings.maxItemCount = val,
      ()=>{},
      false,
      30
    )

    new Setting(containerEl)
    .setName(t("SHOW_COUNT_NAME"))
    .setDesc(fragWithHTML(t("SHOW_COUNT_DESC")))
    .addToggle(toggle => 
      toggle
        .setValue(this.plugin.settings.showNeighborCount)
        .onChange(value => {
          this.plugin.settings.showNeighborCount = value;
          this.dirty = true;
        }))

    new Setting(containerEl)
      .setName(t("ALLOW_AUTOZOOM_NAME"))
      .setDesc(fragWithHTML(t("ALLOW_AUTOZOOM_DESC")))
      .addToggle(toggle => 
        toggle
          .setValue(this.plugin.settings.allowAutozoom)
          .onChange(value => {
            this.plugin.settings.allowAutozoom = value;
            this.dirty = true;
          }))

    this.numberslider(
      containerEl,
      t("MAX_AUTOZOOM_NAME"),
      t("MAX_AUTOZOOM_DESC"),
      {min:10,max:1000, step:10},
      ()=>this.plugin.settings.maxZoom*100,
      (val)=>this.plugin.settings.maxZoom = val/100,
      ()=>{},
      false,
      100
    )

    new Setting(containerEl)
      .setName(t("ALLOW_AUTOFOCUS_ON_SEARCH_NAME"))
      .setDesc(fragWithHTML(t("ALLOW_AUTOFOCUS_ON_SEARCH_DESC")))
      .addToggle(toggle => 
        toggle
          .setValue(this.plugin.settings.allowAutofocuOnSearch)
          .onChange(value => {
            this.plugin.settings.allowAutofocuOnSearch = value;
            this.dirty = true;
          }))

      new Setting(containerEl)
        .setName(t("ALWAYS_ON_TOP_NAME"))
        .setDesc(fragWithHTML(t("ALWAYS_ON_TOP_DESC")))
        .addToggle(toggle => 
          toggle
            .setValue(this.plugin.settings.defaultAlwaysOnTop)
            .onChange(value => {
              this.plugin.settings.defaultAlwaysOnTop = value;
              this.dirty = true;
            }))

      this.numberslider(
        containerEl,
        t("EMBEDDED_FRAME_WIDTH_NAME"),
        undefined,
        {min:400,max:1600, step:50},
        ()=>this.plugin.settings.centerEmbedWidth,
        (val)=>this.plugin.settings.centerEmbedWidth = val,
        ()=>{},
        false,
        this.plugin.settings.centerEmbedWidth
      )

      this.numberslider(
        containerEl,
        t("EMBEDDED_FRAME_HEIGHT_NAME"),
        undefined,
        {min:400,max:1600, step:50},
        ()=>this.plugin.settings.centerEmbedHeight,
        (val)=>this.plugin.settings.centerEmbedHeight = val,
        ()=>{},
        false,
        this.plugin.settings.centerEmbedHeight
      )

    // ------------------------------
    // 3D view (docs/3d-design.md §6-1). The toggle lives in the tools panel and is not saved.
    // setHeading() rather than the h1 the older sections use: the lint baseline must not grow (AGENTS.md).
    // ------------------------------
    new Setting(containerEl)
      .setName(t("VIEW3D_HEAD"))
      .setHeading();

    this.numberslider(
      containerEl,
      t("VIEW3D_NORTH_SHEAR_X_NAME"),
      t("VIEW3D_NORTH_SHEAR_X_DESC"),
      {min:0,max:1,step:0.05},
      ()=>this.plugin.settings.view3D.northShearX,
      (val)=>this.plugin.settings.view3D.northShearX = val,
      ()=>{},
      false,
      DEFAULT_VIEW_3D_SETTINGS.northShearX
    )

    this.numberslider(
      containerEl,
      t("VIEW3D_NORTH_RISE_NAME"),
      t("VIEW3D_NORTH_RISE_DESC"),
      // 0.2 keeps the lowest possible parent row (Layout bottom = -2·nodeHeight) clear of the friends at the defaults
      {min:0.2,max:1,step:0.05},
      ()=>this.plugin.settings.view3D.northRise,
      (val)=>this.plugin.settings.view3D.northRise = val,
      ()=>{},
      false,
      DEFAULT_VIEW_3D_SETTINGS.northRise
    )

    this.numberslider(
      containerEl,
      t("VIEW3D_LEVEL_HEIGHT_FACTOR_NAME"),
      t("VIEW3D_LEVEL_HEIGHT_FACTOR_DESC"),
      {min:1,max:4,step:0.1},
      ()=>this.plugin.settings.view3D.levelHeightFactor,
      (val)=>this.plugin.settings.view3D.levelHeightFactor = val,
      ()=>{},
      false,
      DEFAULT_VIEW_3D_SETTINGS.levelHeightFactor
    )

    // Node colour per level (§6-3). One picker per default; the floor is L1.
    DEFAULT_LEVEL_COLORS.forEach((defaultColor, i) => {
      this.colorpicker(
        containerEl,
        t("VIEW3D_LEVEL_COLOR_NAME").replace("{n}", String(i + 1)),
        i === 0 ? t("VIEW3D_LEVEL_COLOR_DESC") : null,
        ()=>this.plugin.settings.levelColors[i],
        (val)=>{
          // Copy on write: settings loaded without levelColors share the array of DEFAULT_SETTINGS.
          const colors = [...this.plugin.settings.levelColors];
          colors[i] = val;
          this.plugin.settings.levelColors = colors;
        },
        ()=>{},
        false,
        defaultColor
      )
    });

    // ------------------------------
    // Style
    // ------------------------------
    containerEl.createEl("h1", {
      cls: "excalibrain-settings-h1",
      text: t("STYLE_HEAD")
    });
    const styleDesc = this.containerEl.createEl("p", {});
    styleDesc.appendChild(fragWithHTML(t("STYLE_DESC")));

    this.colorpicker(
      containerEl,
      t("CANVAS_BGCOLOR"),
      null,
      ()=>this.plugin.settings.backgroundColor,
      (val)=> {
        this.plugin.settings.backgroundColor=val;
        void this.updateNodeDemoImg();
      },
      ()=>{},
      false,
      this.plugin.settings.backgroundColor
    )

    //-----------------------------
    //Node Style settings
    //-----------------------------    
    let nodeStylesDropdown: DropdownComponent;
    let nodeStyleDiv: HTMLDivElement;
    const nodeDropdownOnChange = (value:string) => {
      nodeStyleDiv.empty();
      const nodeStyle = this.plugin.nodeStyles[value];
      this.nodeSettings(
        nodeStyleDiv,
        nodeStyle.style,
        nodeStyle.allowOverride,
        nodeStyle.getInheritedStyle()
      )
      this.demoNodeStyle = nodeStyle;
      void this.updateNodeDemoImg();
    }

    const taglist = new Setting(containerEl)
      .setName(t("TAGLIST_NAME"))
      .setDesc(t("TAGLIST_DESC"))
      .addTextArea((text)=> {
        text.inputEl.addClass("excalibrain-settings-textarea-200");
        text
          .setValue(this.plugin.settings.tagStyleList.sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1).join(", "))
          .onChange(value => {
            const tagStyles = this.plugin.settings.tagNodeStyles
            const nodeStyles = this.plugin.nodeStyles;
            value = value.replaceAll("\n"," ");
            const tags = value.split(",").map(s=>s.trim()).sort((a,b)=>a.toLocaleLowerCase()<b.toLocaleLowerCase()?-1:1);
            this.plugin.settings.tagStyleList = tags;
            Object.keys(tagStyles).forEach(key => {
              if(!tags.contains(key)) {
                delete tagStyles[key];
                delete nodeStyles[key];
              }
            });
            tags.forEach(tag => {
              if(!Object.keys(tagStyles).contains(tag)) {
                tagStyles[tag] = {};
                nodeStyles[tag] = {
                  style: tagStyles[tag],
                  allowOverride: true,
                  userStyle: true,
                  display: tag,
                  getInheritedStyle: () => this.plugin.settings.baseNodeStyle
                }
              }
            });
            const selectedItem = nodeStylesDropdown.getValue();
            for(let i=nodeStylesDropdown.selectEl.options.length-1;i>=0;i--) {
              nodeStylesDropdown.selectEl.remove(i);
            }
            Object.entries(nodeStyles).forEach(item=>{
              nodeStylesDropdown.addOption(item[0],item[1].display)
            })
            if(nodeStyles[selectedItem]) {
              nodeStylesDropdown.setValue(selectedItem);
            } else {
              nodeStylesDropdown.setValue("base");
              nodeDropdownOnChange("base");
            }
            this.dirty = true;
        })
      })

    new Setting(containerEl)
      .setName(t("NOTE_STYLE_TAG_NAME"))
      .setDesc(t("NOTE_STYLE_TAG_DESC"))
      .addText(text=>
        text
          .setValue(this.plugin.settings.primaryTagField)
          .onChange(value => {
            this.plugin.settings.primaryTagField = value;
            this.plugin.settings.primaryTagFieldLowerCase = value.toLocaleLowerCase().replaceAll(" ","-");
            this.dirty = true;
          })  
      )

    new Setting(containerEl)
      .setName(t("ALL_STYLE_PREFIXES_NAME"))
      .setDesc(t("ALL_STYLE_PREFIXES_DESC"))
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.displayAllStylePrefixes)
          .onChange(value=>{
            this.plugin.settings.displayAllStylePrefixes = value;
            this.dirty = true;
          })
      )

    taglist.descEl.addClass("excalibrain-setting-wide");
    taglist.controlEl.addClass("excalibrain-setting-wide");

    const nodeStylesWrapper = containerEl.createDiv({cls:"setting-item"});
    const nodeStylesDropdownWrapper = nodeStylesWrapper.createDiv({cls:"setting-item-info"});
    nodeStylesDropdown = new DropdownComponent(nodeStylesDropdownWrapper);
    
    const nodeStylestoggleLabel = nodeStylesWrapper.createDiv({
      text: "Show inherited",
      cls: "setting-item-name"
    });
    nodeStylestoggleLabel.addClass("excalibrain-settings-toggle-label");

    let linkStylesToggle: ToggleComponent;

    let boundToggleChange = false;
    const nodeStylesToggle = new ToggleComponent(nodeStylesWrapper)
    nodeStylesToggle
      .setValue(true)
      .setTooltip("Show/Hide Inherited Properties")
      .onChange(value => {
        if(boundToggleChange) {
          boundToggleChange = false;
          return;
        }
        if(value) {
          containerEl.removeClass(HIDE_DISABLED_STYLE);
        } else {
          containerEl.addClass(HIDE_DISABLED_STYLE);
        }
        boundToggleChange = true;
        linkStylesToggle.setValue(value);
      });

    Object.entries(this.plugin.nodeStyles).forEach(item=>{
      nodeStylesDropdown.addOption(item[0],item[1].display)
    })

    this.demoNodeImg = containerEl.createEl("img",{cls: "excalibrain-settings-demoimg"});

    nodeStyleDiv = containerEl.createDiv({
      cls: "excalibrain-setting-style-section"
    });
    containerEl.removeClass(HIDE_DISABLED_STYLE);
    nodeStylesDropdown
      .setValue("base")
      .onChange(nodeDropdownOnChange)
      const nodeStyle = this.plugin.nodeStyles["base"];
      this.nodeSettings(
        nodeStyleDiv,
        nodeStyle.style,
        nodeStyle.allowOverride,
        nodeStyle.getInheritedStyle()
      )
      this.demoNodeStyle = nodeStyle;
      void this.updateNodeDemoImg();

    //-----------------------------
    // Link Style settings
    //-----------------------------
    
    let linkStylesDropdown: DropdownComponent;
    let linkStyleDiv: HTMLDivElement;
    const linkDropdownOnChange = (value:string) => {
      linkStyleDiv.empty();
      this.ensureAxisLinkStyles();
      const ls = this.plugin.linkStyles[value];
      this.linkSettings(
        linkStyleDiv,
        ls.style,
        ls.allowOverride,
        this.inheritedLinkStyle(ls)
      )
      this.demoLinkStyle = ls;
      this.demoLinkStyleKey = value;
      this.demoLinkAxis = this.axisOfLinkStyle(ls);
      void this.updateLinkDemoImg();
    }

    const linkStylesWrapper = containerEl.createDiv({cls:"setting-item"});
    
    const linkStylesDropdownWrapper = linkStylesWrapper.createDiv({cls:"setting-item-info"});
    linkStylesDropdown = new DropdownComponent(linkStylesDropdownWrapper);
    
    const linkStylesToggleLabel = linkStylesWrapper.createDiv({
      text: "Show inherited",
      cls: "setting-item-name"
    });
    linkStylesToggleLabel.addClass("excalibrain-settings-toggle-label");
    
    linkStylesToggle = new ToggleComponent(linkStylesWrapper)

    linkStylesToggle
      .setValue(true)
      .setTooltip("Show/Hide Inherited Properties")
      .onChange(value => {
        if(boundToggleChange) {
          boundToggleChange = false;
          return;
        }
        if(value) {
          containerEl.removeClass(HIDE_DISABLED_STYLE);
        } else {
          containerEl.addClass(HIDE_DISABLED_STYLE);
        }
        boundToggleChange = true;
        nodeStylesToggle.setValue(value);
      });

    Object.entries(this.plugin.linkStyles).forEach(item=>{
      linkStylesDropdown.addOption(item[0],item[1].display)
    })

    this.demoLinkImg = containerEl.createEl("img",{cls: "excalibrain-settings-demoimg"});

    linkStyleDiv = containerEl.createDiv({
      cls: "excalibrain-setting-nodestyle-section"
    });

    linkStylesDropdown
      .setValue("base")
      .onChange(linkDropdownOnChange)
    linkDropdownOnChange("base");

    onHierarchyChange = () => {
      unassingedFieldsTextArea.setValue(this.getUnusedFieldNames());
      const hierarchyLinkStyles = this.plugin.settings.hierarchyLinkStyles
      this.ensureAxisLinkStyles();
      const linkStyles = this.plugin.linkStyles;
      const styleList = this.hierarchyStyleList;

      Object.keys(linkStyles).forEach(key => {
        if(PREDEFINED_LINK_STYLES.contains(key) || AXIS_LINK_STYLE_KEYS.contains(key)) {
          return;
        }
        if(!styleList.contains(key)) {
          delete linkStyles[key];
          delete hierarchyLinkStyles[key];
        }
      });
      styleList.forEach(dataviewfield => {
        if(
          !(Object.keys(hierarchyLinkStyles).contains(dataviewfield) ||
          PREDEFINED_LINK_STYLES.contains(dataviewfield) ||
          AXIS_LINK_STYLE_KEYS.contains(dataviewfield))
        ) {
          hierarchyLinkStyles[dataviewfield] = {};
          linkStyles[dataviewfield] = {
            style: hierarchyLinkStyles[dataviewfield],
            allowOverride: true,
            userStyle: true,
            display: dataviewfield,
            getInheritedStyle: () => this.plugin.settings.baseLinkStyle
          }
        }
      });
      const selectedItem = linkStylesDropdown.getValue();
      for(let i=linkStylesDropdown.selectEl.options.length-1;i>=0;i--) {
        linkStylesDropdown.selectEl.remove(i);
      }
      const h = this.plugin.settings.hierarchy;
      // Dropdown order: predefined, the two region entries (Up first), then the fields by region,
      // north before south (Up, Parents, Down, Children) and the rest last; each group A-Z.
      const sortGroup = (key:string):string => {
        if(PREDEFINED_LINK_STYLES.includes(key)) return "0";
        if(AXIS_LINK_STYLE_KEYS.includes(key)) return "1" + AXIS_LINK_STYLE_KEYS.indexOf(key).toString();
        if(h.abstract.includes(key)) return "2";
        if(h.parents.includes(key)) return "3";
        if(h.concrete.includes(key)) return "4";
        if(h.children.includes(key)) return "5";
        return "6";
      };
      const sortHelper = (a:string):string => sortGroup(a) + a.toLowerCase();
      const optionLabel = (display:string):string => {
        if(h.abstract.includes(display)) return "Up > " + display;
        if(h.concrete.includes(display)) return "Down > " + display;
        if(h.parents.includes(display)) return "Parent > " + display;
        if(h.children.includes(display)) return "Child > " + display;
        if(h.leftFriends.includes(display)) return "Left Friend > " + display;
        if(h.rightFriends.includes(display)) return "Right Friend > " + display;
        if(h.previous.includes(display)) return "Previous > " + display;
        if(h.next.includes(display)) return "Next > " + display;
        return display;
      };
      Object.entries(linkStyles)
        .sort((a,b)=>sortHelper(a[0])<sortHelper(b[0])?-1:1)
        .forEach(item=>{
          linkStylesDropdown.addOption(item[0], optionLabel(item[1].display))
      })
      if(linkStyles[selectedItem]) {
        linkStylesDropdown.setValue(selectedItem);
        // A field typed into or out of Up / Down inherits a different style: rebuild its pickers and the demo.
        if(this.axisOfLinkStyle(linkStyles[selectedItem]) !== this.demoLinkAxis) {
          linkDropdownOnChange(selectedItem);
        }
      } else {
        linkStylesDropdown.setValue("base");
        linkDropdownOnChange("base");
      }
    }
    onHierarchyChange();
    this.attachSettingsFocusoutHandler();
  }
}