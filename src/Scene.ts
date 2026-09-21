import { App, FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { EMPTYBRAIN } from "./constants/emptyBrainFile";
import { Layout } from "./graph/Layout";
import { Links } from "./graph/Links";
import { Node } from "./graph/Node";
import ExcaliBrain from "./excalibrain-main";
import { ExcaliBrainSettings } from "./Settings";
import { ToolsPanel } from "./Components/ToolsPanel";
import { Mutable, Neighbour, NodeStyle, RelationType, Role } from "./Types";
import { HistoryPanel } from "./Components/HistoryPanel";
import { WarningPrompt } from "./utils/Prompts";
import { errorlog, keepOnTop } from "./utils/utils";
import { isEmbedFileType } from "./utils/fileUtils";
import { Page } from "./graph/Page";
import { FLOOR_LEVEL, FloorPlan, Point, Projected, ProjectionParams, bandShift, compareDrawOrder, floorDrop, floorOf, floorPlan, friendBandShift, levelOf, project, verticalRow } from "./graph/Projection";
import { t } from "./lang/helpers";
import { ExcalidrawAutomate, ExcalidrawElement, addElementsToViewTransient, applyEAStyle, configureExcaliBrainView, getEA, destroyViewEA, releaseViewEA, updateViewSceneTransient, waitForExcalidrawViewReady } from "./utils/ExcalidrawAutomateCompatibility";
 
/**
 * 床・柱・影の固定値（docs/3d-design.md §6-2）。投影の係数は設定 `view3D`。
 * 色はすべて設定のテキスト色（`baseNodeStyle.textColor`）から不透明度だけ落として作るので、背景に対して必ず見える。
 * 長さは nodeHeight（影・グリッド間隔・余白・床の沈みの上限）と gateRadius（目盛り）に対する比で、px 固定にしない。
 */
const VIEW_3D = {
  /** 床の外周と面 */
  floorStrokeAlpha: 0.25,
  floorFillAlpha: 0.05,
  /** グリッド線（nodeHeight 間隔） */
  gridAlpha: 0.15,
  gridWidth: 1,
  /** 中心ノートの足元を通る東西・南北の 2 本（床の十字） */
  crossAlpha: 0.4,
  crossWidth: 2,
  /** 十字の両端の N／S／W／E */
  compassAlpha: 0.6,
} as const;

/** `#rrggbb`／`#rrggbbaa` の色に不透明度（0〜1）を付け直す。 */
const withAlpha = (color: string, alpha: number): string =>
  `${color.substring(0, 7)}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;

/** `Layout.place()` が決めた 2D の中心（友の帯は `friendBandShift` 適用後。影の足元でもある）と、その投影。 */
type PlacedNode = { node: Node; center: Point; projected: Projected };

/** 床の平面（§6-2）: 2D の点を、中心の段（`FLOOR_LEVEL`）の投影を画面で `floorDrop` だけ下げた位置に置く。 */
type FloorPlane = (point: Point) => Point;

export class Scene {
  ea: ExcalidrawAutomate;
  plugin: ExcaliBrain;
  app: App;
  leaf: WorkspaceLeaf;
  centralPagePath: string; //path of the page in the center of the graph
  centralPageFile: TFile;
  private _centralLeaf: WorkspaceLeaf; //workspace leaf containing the central page
  textSize: {width:number, height:number};
  nodeWidth: number;
  nodeHeight: number;
  minLinkLength = 100;
  public disregardLeafChange = false;
  public terminated: boolean;
  public nodesMap: Map<string,Node> = new Map<string,Node>();
  public links: Links;
  private layouts: Layout[] = [];
  private removeEH?: () => void;
  private removeTimer?: () => void;
  private removeOnCreate?: () => void;
  private removeOnModify?: () => void;
  private removeOnDelete?: () => void;
  private removeOnRename?: () => void;
  private blockUpdateTimer: boolean = false;
  public toolsPanel: ToolsPanel;
  private historyPanel: HistoryPanel;
  public vaultFileChanged: boolean = false;
  public pinLeaf: boolean = false;
  public focusSearchAfterInitiation: boolean = true;
  private zoomToFitOnNextBrainLeafActivate: boolean = false; //this addresses the issue caused in Obsidian 0.16.0 when the brain graph is rendered while the leaf is hidden because tab is not active
  private rootNode: Node;
  /**
   * 3D 表示（docs/3d-design.md）。起動時は常に false。ToolsPanel のトグル（LEV-114）が切り替え、設定には保存しない。
   * false のあいだ render() は分岐に入らず、変更前と同じ経路を通る。
   */
  public view3D: boolean = false;

  constructor(plugin: ExcaliBrain, newLeaf: boolean, leaf?: WorkspaceLeaf, ea?: ExcalidrawAutomate) {
    const resolvedEA = ea ?? plugin.EA ?? getEA(leaf?.view);
    if(!resolvedEA) throw new Error("ExcaliBrain: Excalidraw Automate is not available.");
    this.ea = resolvedEA;
    this.plugin = plugin;
    this.app = plugin.app;
    this.leaf = leaf ?? this.app.workspace.getLeaf(newLeaf);
    this.terminated = false;
    this.links = new Links(plugin);
  }

  set centralLeaf(leaf: WorkspaceLeaf) {
    this._centralLeaf = leaf;
  }
  
  get centralLeaf(): WorkspaceLeaf {
    if(!this.plugin.settings.autoOpenCentralDocument || !this._centralLeaf) {
      return null;
    }
    if(this.app.workspace.getLeafById(this._centralLeaf.id)) {
      return this._centralLeaf;
    } 
    return null;
  }

  /**
   * Rebind the disposable EA instance to the brain view when Excalidraw has
   * temporarily cleared targetView during lifecycle transitions. The Scene's
   * own leaf is the stable source of truth for whether the brain view still
   * exists.
   */
  private ensureBrainViewBound(): boolean {
    if(this.terminated) return false;
    if(!(this.leaf?.view instanceof FileView)) return false;
    if(this.leaf.view.file?.path !== this.plugin.settings.excalibrainFilepath) return false;

    if(this.ea.targetView?.file?.path === this.plugin.settings.excalibrainFilepath) {
      return true;
    }

    this.ea.setView?.(this.leaf.view);
    const rebound = this.ea.targetView?.file?.path === this.plugin.settings.excalibrainFilepath;
    if(rebound) {
      this.ea.registerThisAsViewEA?.();
    }
    return rebound;
  }

  public async initialize(focusSearchAfterInitiation: boolean): Promise<void> {
    this.focusSearchAfterInitiation = focusSearchAfterInitiation;
    await this.plugin.loadSettings();
    if(!this.leaf?.view || !this.ea) return;
    if(!await waitForExcalidrawViewReady(this.ea)) {
      throw new Error("ExcaliBrain: Excalidraw view did not become ready within 10 seconds.");
    }
    const excalidrawEl = this.leaf.view.containerEl.querySelector<HTMLElement>(".excalidraw");
    if(!excalidrawEl) {
      throw new Error("ExcaliBrain: Excalidraw canvas DOM is unavailable after view startup.");
    }
    this.toolsPanel = new ToolsPanel(excalidrawEl,this.plugin);
    await this.initializeScene();
  }

  /**
   * Check if ExcaliBrain is currently active
   * @returns boolean; true if active
   */
  public isActive(): boolean {
    return !this.terminated && this.leaf?.id != null && this.app.workspace.getLeafById(this.leaf.id) != null;
  }

  /**
   * Updates the current Scene applying changes in the Index
   * @returns 
   */
  public async reRender(updateIndex:boolean = true) {
    if(!this.isActive()) {
      return;
    }

    if(!this.centralPagePath) {
      return;
    }

    if(updateIndex) {
      this.vaultFileChanged = false;
      await this.plugin.createIndex(); //temporary
    }

    keepOnTop(this.ea, this.app);
    const centralPage = this.plugin.pages.get(this.centralPagePath);
    if(
      centralPage?.file &&
      !(centralPage.isFolder || centralPage.isTag || centralPage.isVirtual) &&
      this.plugin.settings.autoOpenCentralDocument
    ) {
      if(!this.centralLeaf) {
        this.ea.openFileInNewOrAdjacentLeaf(centralPage.file);
      } else if (
        !(this.centralLeaf.view instanceof FileView) ||
        this.centralLeaf.view.file?.path !== centralPage.file.path
      ) {
        void this.centralLeaf.openFile(centralPage.file, {active: false});
      }
    }
    await this.render(this.plugin.settings.embedCentralNode);
  }

  private getCentralPage():Page {
    //centralPagePath might no longer be valid in case the user changed the filename of the central page
    //this is relevant only when the central page is embedded, since if the file is in another leaf the leaf.view.file will
    //have the right new path
    let centralPage = this.plugin.pages.get(this.centralPagePath)
    if(!centralPage && this.centralPageFile) {
      this.centralPagePath = this.centralPageFile.path;
      centralPage = this.plugin.pages.get(this.centralPageFile.path);
    }
    return centralPage;
  }

  /** iterates through a neighbour stack and returns the longest title length found.
   * @param Neighbour[]
   * @returns number
   * @description: Possibly time consuming - are there other options? 
  */ 
  private longestTitle(neighbours: Neighbour[], checkMax=20): number {
    const lengths:number[] = [0];
    for (let index = 0; (index<neighbours.length) && (index<=checkMax); index++) {
      const item = neighbours[index];
      lengths.push(item.page.getTitle().length);
    }
    return Math.max(...lengths);
  }

  /**
   * Renders the ExcaliBrain graph for the file provided by its path
   * @param path 
   * @returns 
   */
  public async renderGraphForPath(path: string, shouldOpenFile:boolean = true) {
    if(!this.isActive()) {
      return;
    }

    this.blockUpdateTimer = true; //blocks the updateTimer
    const settings = this.plugin.settings;
    const page = this.plugin.pages.get(path);
    if(!page) {
      this.blockUpdateTimer = false;
      return;
    }

    const isFile = !(page.isFolder || page.isTag || page.isVirtual || page.isURL);

    if(isFile && !page.file) {
      this.blockUpdateTimer = false;
      return;
    }

    // Abort if the brain leaf is gone. If EA merely lost its target binding,
    // restore it from the still-live brain leaf before continuing.
    if(!this.ensureBrainViewBound()) {
      this.unloadScene();
      return;
    }
    
    //don't render if the user is trying to render the excaliBrain file itself
    if (isFile && page.file.path === settings.excalibrainFilepath) { //brainview drawing is the active leaf
      this.blockUpdateTimer = false;
      return; 
    }
  
    keepOnTop(this.ea, this.app);

    const centralPage = this.getCentralPage();
    const isSameFileAsCurrent = centralPage && 
      ((isFile &&  centralPage.file === page.file) ||
       (page.isURL && centralPage.isURL && centralPage.url === page.url))

    // if the file hasn't changed don't update the graph
    if(isSameFileAsCurrent && (page.isURL || (page.file.stat.mtime === centralPage.mtime))) {
      this.blockUpdateTimer = false;
      return; //don't reload the file if it has not changed
    }

    if(isFile && shouldOpenFile && settings.autoOpenCentralDocument) {
      const centralLeaf = this.centralLeaf;
      if(!centralLeaf || !this.app.workspace.getLeafById(centralLeaf.id)) {
        this.centralLeaf = this.ea.openFileInNewOrAdjacentLeaf(page.file, {active: false});
      } else {
        void centralLeaf.openFile(page.file, {active: false});
      }
      this.plugin.navigationHistory.addToHistory(page.file.path);
    } else {
      this.plugin.navigationHistory.addToHistory(page.path);
    }

    if(page.isFolder && !settings.showFolderNodes) {
      settings.showFolderNodes = true;
      this.toolsPanel.rerender();
    }

    if(page.isURL && !settings.showURLNodes) {
      settings.showURLNodes = true;
      this.toolsPanel.rerender();
    }

    if(page.isTag && !settings.showTagNodes) {
      settings.showTagNodes = true;
      this.toolsPanel.rerender();
    }

    this.centralPagePath = path;
    this.centralPageFile = page.file;
    await this.render(isSameFileAsCurrent);
  }

  public static async openExcalidrawLeaf(
    app: App,
    ea: ExcalidrawAutomate,
    settings: ExcaliBrainSettings,
    leaf?: WorkspaceLeaf,
  ): Promise<WorkspaceLeaf | null> {
    let counter = 0;

    let file = app.vault.getAbstractFileByPath(settings.excalibrainFilepath);
    if(file && !(file instanceof TFile)) {
      new Notice(`Please check settings. ExcaliBrain path (${settings.excalibrainFilepath}) points to a folder, not a file`);
      return null;
    }
    if(!file) {
      file = await app.vault.create(settings.excalibrainFilepath,EMPTYBRAIN);
      //an ugly temporary hack waiting for metadataCache to index the new file
      while(file instanceof TFile && !ea.isExcalidrawFile(file) && counter++<10) {
        await sleep(50);
      }
    }
    if (!(file instanceof TFile)) return null;

    counter = 0;
    if(!ea.isExcalidrawFile(file)) {
      const brainFile = file;
      (new WarningPrompt(
        app,
        "⚠ File Exists",
        `${brainFile.path} already exists in your Vault. Is it ok to overwrite this file? If not, change ExcaliBrain file path in plugin settings.`)
      ).show((result: boolean) => {
        if(!result) {
          new Notice(`Could not start ExcaliBrain. Please change the ExcaliBrain file path in plugin settings.`);
          return;
        }
        void (async (): Promise<void> => {
          await app.vault.modify(brainFile, EMPTYBRAIN);
          while(!ea.isExcalidrawFile(brainFile) && counter++ < 10) {
            await sleep(50);
          }
          void Scene.openExcalidrawLeaf(app, ea, settings, leaf);
        })();
      });
      return null;
    }
    if(!leaf) {
      leaf = app.workspace.getLeaf(false);
      if(leaf.getViewState().type !== "empty") {
        leaf = ea.getLeaf(leaf, "new-pane");
      }
    }
    if(settings.defaultAlwaysOnTop && leaf && ea.DEVICE?.isDesktop) {
      const ownerWindow = leaf.view.containerEl.ownerDocument.defaultView as (Window & {
        electronWindow?: { isMaximized(): boolean; setAlwaysOnTop(value: boolean): void };
      }) | null;
      const electronWindow = ownerWindow?.electronWindow;
      if(ownerWindow && ownerWindow !== window && electronWindow && !electronWindow.isMaximized()) {
        electronWindow.setAlwaysOnTop(true);
      }
    }
    await leaf.openFile(file);
    return leaf;
  }

  public async initializeScene(): Promise<void> {
    this.disregardLeafChange = false;
    const ea = this.ea;
    const settings = this.plugin.settings;

    ea.clear();
    ea.setView?.(this.leaf.view);
    if(!this.ensureBrainViewBound()) {
      throw new Error("ExcaliBrain: Excalidraw view lost its target binding during scene initialization.");
    }
    ea.copyViewElementsToEAforEditing(ea.getViewElements());
    ea.getElements().forEach((el: Mutable<ExcalidrawElement>)=>el.isDeleted=true);

    if(!await waitForExcalidrawViewReady(ea)) {
      throw new Error("ExcaliBrain: Excalidraw API is unavailable during scene initialization.");
    }

    const api = ea.getExcalidrawAPI?.();
    if(!api) {
      throw new Error("ExcaliBrain: Excalidraw API is unavailable.");
    }

    ea.registerThisAsViewEA?.();
    configureExcaliBrainView(ea, true);
    api.setMobileModeAllowed?.(false);
    this.setBaseLayoutParams();

    updateViewSceneTransient(ea, {
      appState: {
        viewModeEnabled:true,
        activeTool: {
          lastActiveToolBeforeEraser: null,
          locked: false,
          type: "selection"
        },
        theme: "light",
        viewBackgroundColor: settings.backgroundColor,
      },
    });

    applyEAStyle(ea, { strokeColor: settings.baseNodeStyle.textColor });
    ea.addText(0,0,"🚀 To get started\nselect a document using the search in the top left or\n" +
      "open a document in another pane.\n\n" +
      "✨ For the best experience enable 'Open in adjacent pane'\nin Excalidraw settings " +
      "under 'Links and Transclusion'.\n\n⚠ ExcaliBrain may need to wait for " +
      "DataView to initialize its index.\nThis can take up to a few minutes after starting Obsidian.", {textAlign:"center"});
    await addElementsToViewTransient(ea);

    if(settings.allowAutozoom) {
      window.setTimeout((): void => api.zoomToFit?.(null, settings.maxZoom, 0.15),100);
    }
    await this.addEventHandler();
    const excalidrawEl = this.leaf.view.containerEl.querySelector<HTMLElement>(".excalidraw");
    if(!excalidrawEl) {
      throw new Error("ExcaliBrain: Excalidraw canvas DOM disappeared during scene initialization.");
    }
    this.historyPanel = new HistoryPanel(excalidrawEl,this.plugin);
    new Notice("ExcaliBrain On");
  }

  public setBaseLayoutParams() {
    const ea = this.ea;
    const settings = this.plugin.settings;
    const style = {
      ...settings.baseNodeStyle,
      ...settings.centralNodeStyle,
    };

    applyEAStyle(ea, { fontFamily: settings.baseLinkStyle.fontFamily });
    applyEAStyle(ea, { fontSize: settings.baseLinkStyle.fontSize });
    this.minLinkLength = ea.measureText("m".repeat(settings.minLinkLength)).width;

    applyEAStyle(ea, { fontFamily: style.fontFamily });
    applyEAStyle(ea, { fontSize: style.fontSize });
    this.textSize = ea.measureText("m".repeat(style.maxLabelLength));
    this.nodeWidth = this.textSize.width + 2 * style.padding;
    this.nodeHeight = 2 * (this.textSize.height + 2 * style.padding);
  }

  addNodes(x:{
    neighbours:Neighbour[],
    layout:Layout,
    isCentral:boolean,
    isSibling:boolean,
    friendGateOnLeft: boolean,
    /** 中心ノートから見た隣接ノードの役割。3D の高さ（`levelOf`）にだけ使う */
    role: Role,
  }) {
    x.neighbours.forEach(n => {
      if(n.page.path === this.plugin.settings.excalibrainFilepath) {
        return; 
      }
      n.page.maxLabelLength = x.layout.spec.maxLabelLength;
      const node = new Node({
        ea: this.ea,
        page: n.page,
        isInferred: n.relationType === RelationType.INFERRED,
        isCentral: x.isCentral,
        isSibling: x.isSibling,
        friendGateOnLeft: x.friendGateOnLeft
      });
      if(this.view3D) {
        node.level = levelOf(n.typeDefinition, x.role, this.plugin.hierarchyLowerCase, {isSibling: x.isSibling});
      }
      this.nodesMap.set(n.page.path,node);
      x.layout.nodes.push(node);
    });
  }

  private getNeighbors(centralPage: Page): {
    parents: Neighbour[],
    children: Neighbour[],
    leftFriends: Neighbour[],
    rightFriends: Neighbour[],
    siblings: Neighbour[]
  } {
    const settings = this.plugin.settings;
    // 3D は帯の中を潰さないぶん画面が高くなるので、領域ごとの上限を下げる（docs/3d-design.md §4-1）
    const maxItemCount = this.view3D ? settings.maxItemCount3D : settings.maxItemCount;
    
    //List nodes for the graph
    const parents = centralPage.getParents()
      .filter(x => 
        (x.page.path !== centralPage.path) &&
        !settings.excludeFilepaths.some(p => x.page.path.startsWith(p)) &&
        //tha node either has no primary tag or the tag is not filtered out
        (!x.page.primaryStyleTag || !this.toolsPanel.linkTagFilter.selectedTags.has(x.page.primaryStyleTag)))
      .slice(0,maxItemCount);
    const parentPaths = parents.map(x=>x.page.path);

    const children =centralPage.getChildren()
      .filter(x => 
        (x.page.path !== centralPage.path) &&
        !settings.excludeFilepaths.some(p => x.page.path.startsWith(p)) &&
        (!x.page.primaryStyleTag || !this.toolsPanel.linkTagFilter.selectedTags.has(x.page.primaryStyleTag)))
      .slice(0,maxItemCount);
    
    const leftFriends = centralPage.getLeftFriends().concat(centralPage.getPreviousFriends())
      .filter(x => 
        (x.page.path !== centralPage.path) &&
        !settings.excludeFilepaths.some(p => x.page.path.startsWith(p)) &&
        (!x.page.primaryStyleTag || !this.toolsPanel.linkTagFilter.selectedTags.has(x.page.primaryStyleTag)))
      .slice(0,maxItemCount);

    const rightFriends = centralPage.getRightFriends().concat(centralPage.getNextFriends())
      .filter(x => 
        (x.page.path !== centralPage.path) &&
        !settings.excludeFilepaths.some(p => x.page.path.startsWith(p)) &&
        (!x.page.primaryStyleTag || !this.toolsPanel.linkTagFilter.selectedTags.has(x.page.primaryStyleTag)))
      .slice(0,maxItemCount);

    const rawSiblings = centralPage
      .getSiblings()
      .filter(s => 
        //the node is not included already as a parent, child, or friend
        !(parents.some(p=>p.page.path === s.page.path)  ||
          children.some(c=>c.page.path === s.page.path) ||
          leftFriends.some(f=>f.page.path === s.page.path)  ||
          rightFriends.some(f=>f.page.path === s.page.path)  ||
          //or not exluded via folder path in settings
          settings.excludeFilepaths.some(p => s.page.path.startsWith(p))
        ) && 
        //it is not the current central page
        (s.page.path !== centralPage.path));

    const siblings = rawSiblings
      .filter(s => 
        //Only display siblings for which the parents are actually displayed.
        //There might be siblings whose parents have been filtered from view
        s.page.getParents().map(x=>x.page.path).some(y=>parentPaths.includes(y)) &&
        //filter based on primary tag
        (!s.page.primaryStyleTag || !this.toolsPanel.linkTagFilter.selectedTags.has(s.page.primaryStyleTag)))
      .slice(0,maxItemCount);
    return {parents,children,leftFriends,rightFriends,siblings};
  }

  private calculateAreas({
    parents,     parentCols,     parentWidth,
    children,    childrenCols,   childWidth,
    leftFriends,     leftFriendCols,     leftFriendWidth,
    rightFriends, rightFriendCols, rightFriendWidth,
    siblings,    siblingsCols,   siblingsNodeWidth, siblingsNodeHeight
  }:{
    parents: Neighbour[],
    children: Neighbour[],
    leftFriends: Neighbour[],
    rightFriends: Neighbour[],
    siblings: Neighbour[],
    leftFriendCols: number,
    leftFriendWidth: number,
    rightFriendCols: number,
    rightFriendWidth: number,
    parentCols: number,
    parentWidth: number,
    childrenCols: number,
    childWidth: number,
    siblingsNodeWidth: number,
    siblingsCols: number,
    siblingsNodeHeight: number
  }) {
    // layout areas
    const leftFriendsArea = {
      width:  leftFriends.length>0? leftFriendCols*leftFriendWidth:0, 
      height: leftFriends.length>0? Math.ceil(leftFriends.length/leftFriendCols)*this.nodeHeight:0
    }
    const rightFriendsArea = {
      width:  rightFriends.length>0? rightFriendCols*rightFriendWidth:0, 
      height: rightFriends.length>0? Math.ceil(rightFriends.length/rightFriendCols)*this.nodeHeight:0
    }
    const parentsArea = {
      width:  parents.length>0? parentCols*parentWidth:0, 
      height: parents.length>0? Math.ceil(parents.length/parentCols)*this.nodeHeight:0
    }
    const childrenArea = {
      width:  children.length>0? childrenCols*childWidth:0, 
      height: children.length>0? Math.ceil(children.length/childrenCols)*this.nodeHeight:0
    }
    const siblingsArea = {
      width:  siblings.length>0? siblingsNodeWidth*siblingsCols:0, 
      height: siblings.length>0? Math.ceil(siblings.length/siblingsCols)*siblingsNodeHeight:0
    }
    return {leftFriendsArea,rightFriendsArea,parentsArea,childrenArea,siblingsArea};
  }

  private calculateLayoutParams({
    centralPage,
    parents,
    children,
    leftFriends,
    rightFriends,
    siblings,
    isCenterEmbedded,
    centerEmbedHeight,
    centerEmbedWidth,
    style,
    rootNode,
  }:{
    centralPage: Page, 
    parents: Neighbour[],
    children: Neighbour[],
    leftFriends: Neighbour[],
    rightFriends: Neighbour[],
    siblings: Neighbour[],
    isCenterEmbedded: boolean,
    centerEmbedHeight: number,
    centerEmbedWidth: number,
    style: NodeStyle,
    rootNode: Node,
  }) {
    const settings = this.plugin.settings;
    const ea = this.ea;
    const basestyle = settings.baseNodeStyle;

    const isCompactView = settings.compactView;
    const compactFactor = 1.166 * settings.compactingFactor;
    const horizontalFactor = 0.833 * settings.compactingFactor;
    const minLinkLength = this.minLinkLength * horizontalFactor * 2;

    const manyFriends = leftFriends.length >= 10;
    const manyNextFriends = rightFriends.length >= 10;
    const minLabelLength = 7;
    
    const baseChar4x = this.ea.measureText("mi3L".repeat(1));
    const baseChar = {
      width: baseChar4x.width * 0.25,
      height: baseChar4x.height
    };
    this.nodeWidth = basestyle.maxLabelLength * baseChar.width + 2 * basestyle.padding;

    this.nodeHeight = compactFactor * (baseChar.height + 2 * basestyle.padding);
    const padding = 6 * basestyle.padding;
    const prefixLength = Math.max(rootNode.prefix.length,2);
    
    // container
    const container = this.leaf.view.containerEl;
    const h = container.innerHeight-150;
    const w = container.innerWidth;
    const rf = 1/(h/w);
    const rfCorr = Math.min(rf,1);
    
    const correctedMaxLabelLength = Math.round(style.maxLabelLength*rfCorr);
    const correctedMinLabelLength = Math.max(minLabelLength, correctedMaxLabelLength); 

    //columns
    const siblingsCols = siblings.length >= 20
      ? 3
      : siblings.length >= 10
        ? 2
        : 1;
    
    const childrenCols = isCompactView 
      ? children.length <= 12 
        ? [1, 1, 2, 3, 3, 3, 3, 2, 2, 3, 3, 2, 2][children.length]
        : 3
      : children.length <= 12 
        ? [1, 1, 2, 3, 3, 3, 3, 4, 4, 5, 5, 4, 4][children.length]
        : 5;

    const parentCols = isCompactView
      ? (parents.length < 2) ? 1 : 2
      : parents.length < 5
        ? [1, 1, 2, 3, 2][parents.length]
        : 3;;

    const leftFriendCols = isCenterEmbedded
      ? Math.ceil((leftFriends.length*this.nodeHeight)/centerEmbedHeight)
      : manyFriends
        ? 2
        : 1;
  
    const rightFriendCols = isCenterEmbedded
      ? Math.ceil((rightFriends.length*this.nodeHeight)/centerEmbedHeight)
      : manyNextFriends
        ? 2
        : 1;
  
    //center     
    const rootTitle = centralPage.getTitle();
    const rootNodeDimensions = ea.measureText(rootTitle.repeat(1));
    const actualRootLength = [...new Intl.Segmenter().segment(rootTitle)].length;
    const rootNodeLength = Math.min(actualRootLength + prefixLength, style.maxLabelLength);
    const rootWidth = rootNodeDimensions.width + 2 * style.padding;
    const heightInCenter = isCenterEmbedded
      ? centerEmbedHeight + 2 * this.nodeHeight
      : 4 *this.nodeHeight;
    
    //parents
    const parentLabelLength = Math.min(this.longestTitle(parents) + prefixLength, correctedMinLabelLength);
    const parentWidth = horizontalFactor * (parentLabelLength * baseChar.width + padding);

    //children
    const childLength = Math.min(this.longestTitle(children,20) + prefixLength, correctedMinLabelLength);
    const childWidth = horizontalFactor * (childLength * baseChar.width + padding);

    // leftFriends
    const leftFriendLength = Math.min(this.longestTitle(leftFriends) + prefixLength,correctedMinLabelLength);
    const leftFriendWidth = horizontalFactor * (leftFriendLength * baseChar.width + padding);

    // nextFriends
    const rightFriendLength = Math.min(this.longestTitle(rightFriends) + prefixLength, correctedMinLabelLength);
    const rightFriendWidth = horizontalFactor * (rightFriendLength * baseChar.width + padding);

    //siblings
    const siblingsStyle = settings.siblingNodeStyle;
    const siblingsPadding = siblingsStyle.padding??settings.baseNodeStyle.padding;
    const siblingsLabelLength = Math.min(this.longestTitle(siblings,20) + prefixLength, correctedMinLabelLength);
    applyEAStyle(ea, { fontFamily: siblingsStyle.fontFamily });
    applyEAStyle(ea, { fontSize: siblingsStyle.fontSize });
    const siblingsTextSize = ea.measureText("m".repeat(siblingsLabelLength+3));
    const siblingsNodeWidth =  horizontalFactor * (siblingsTextSize.width + 3 * siblingsPadding);
    const siblingsNodeHeight = compactFactor * (siblingsTextSize.height + 2 * siblingsPadding);

    // layout areas
    const {parentsArea,childrenArea,leftFriendsArea,rightFriendsArea,siblingsArea} = this.calculateAreas({
      parents,      parentCols,      parentWidth,
      children,     childrenCols,    childWidth,
      leftFriends,  leftFriendCols,  leftFriendWidth,
      rightFriends, rightFriendCols, rightFriendWidth,
      siblings,     siblingsCols,    siblingsNodeWidth, siblingsNodeHeight
    });
    
    // Origos
    const parentsOrigoY = (parentsArea.height + Math.max(leftFriendsArea.height,rightFriendsArea.height,heightInCenter))*0.5 + padding;
    const childrenOrigoY = (childrenArea.height + Math.max(leftFriendsArea.height,rightFriendsArea.height,heightInCenter))*0.5 + padding;

    const leftFriendOrigoX = Math.max(
        (isCenterEmbedded
          ? centerEmbedWidth + minLabelLength * 1.2 //the normal central nodes witdh seems to be a bit over estimated, thus applying a slight increase to the minLinkLength if the center is embedded
          : rootWidth + minLinkLength) + leftFriendsArea.width, 
        childrenArea.width - leftFriendsArea.width, 
        parentsArea.width - leftFriendsArea.width
      )/2 + padding;
        
    const rightFriendOrigoX = Math.max(
        (isCenterEmbedded
          ? centerEmbedWidth + minLabelLength * 1.2 //the normal central nodes witdh seems to be a bit over estimated, thus applying a slight increase to the minLinkLength if the center is embedded
          : rootWidth + minLinkLength) + rightFriendsArea.width, 
        childrenArea.width - rightFriendsArea.width, 
        parentsArea.width - rightFriendsArea.width
      )/2 + padding;
    
    const siblingsOrigoX = (
      Math.max(
        parentsArea.width,
        (isCenterEmbedded?centerEmbedWidth:rootWidth)
      ) + siblingsArea.width)/2 + 3*siblingsPadding*(1 + siblingsCols);

    const siblingsOrigoY = 
      Math.max(
        parentsOrigoY, 
        (siblingsArea.height + rightFriendsArea.height)/2
      ) + this.nodeHeight;

    return {
      rootNodeDimensions,               rootWidth,                             rootNodeLength,
      childrenOrigoY,                   childWidth,                            childLength,         childrenCols,
      parentsOrigoY,                    parentWidth,                           parentLabelLength,   parentCols,
      leftFriendOrigoX,                 leftFriendWidth,                       leftFriendLength,    leftFriendCols,
      rightFriendOrigoX,                rightFriendWidth,                      rightFriendLength,   rightFriendCols,
      siblingsOrigoX,   siblingsOrigoY, siblingsNodeWidth, siblingsNodeHeight, siblingsLabelLength, siblingsCols,
    };
  }

  /**
   * if retainCentralNode is true, the central node is not removed from the scene when the scene is rendered
   * this will ensure that the embedded frame in the center is not reloaded
   * @param retainCentralNode 
   * @returns 
   */
  private async render(retainCentralNode:boolean = false) {
    if(!this.ensureBrainViewBound()) {
      return;
    }
    if(this.historyPanel) {
      this.historyPanel.rerender()
    }
    if(!this.centralPagePath) return;

    const settings = this.plugin.settings;
    
    let centralPage = this.plugin.pages.get(this.centralPagePath);
    if(!centralPage) {
      //path case sensitivity issue
      this.centralPagePath = this.plugin.lowercasePathMap.get(this.centralPagePath.toLowerCase());
      centralPage = this.plugin.pages.get(this.centralPagePath);
      if(!centralPage) return;
      this.centralPageFile = centralPage.file;
    }

    const ea = this.ea;
    retainCentralNode = 
      retainCentralNode && this.rootNode !== undefined &&
      settings.embedCentralNode && ((centralPage.file && isEmbedFileType(centralPage.file,ea)) || centralPage.isURL);

    this.zoomToFitOnNextBrainLeafActivate = !this.leaf.view.containerEl.isShown();

    ea.clear();
    ea.copyViewElementsToEAforEditing(ea.getViewElements());
    //delete existing elements from view. The actual delete will happen when addElementsToView is called
    //I delete them this way to avoid the splash screen flashing up when the scene is cleared
    //https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/1248#event-9940972555
    ea.getElements()
      .filter((el: ExcalidrawElement)=>!retainCentralNode || !this.rootNode.embeddedElementIds.includes(el.id))
      .forEach((el: Mutable<ExcalidrawElement>)=>el.isDeleted=true);
    applyEAStyle(ea, { verticalAlign: "middle" });

    const {parents,children,leftFriends,rightFriends,siblings} = this.getNeighbors(centralPage);

    //-------------------------------------------------------
    // Generate layout and nodes
    this.nodesMap = new Map<string,Node>();
    this.links = new Links(this.plugin);
    this.layouts = [];

    const isCenterEmbedded = 
      settings.embedCentralNode &&
      !centralPage.isVirtual &&
      !centralPage.isFolder &&
      !centralPage.isTag;
    const centerEmbedWidth = settings.centerEmbedWidth;
    const centerEmbedHeight = settings.centerEmbedHeight;

    const style = {
      ...settings.baseNodeStyle,
      ...settings.centralNodeStyle,
    };
    const basestyle = settings.baseNodeStyle;
    applyEAStyle(ea, { fontFamily: basestyle.fontFamily });
    applyEAStyle(ea, { fontSize: basestyle.fontSize });

    this.rootNode = new Node({
      ea,
      page: centralPage,
      isInferred: false,
      isCentral: true,
      isSibling: false,
      friendGateOnLeft: true,
      isEmbeded: isCenterEmbedded,
      embeddedElementIds: retainCentralNode ? this.rootNode?.embeddedElementIds : undefined,
    });

    const {
      rootNodeDimensions,rootWidth,       rootNodeLength,
      childrenOrigoY,    childWidth,      childLength,      childrenCols,
      parentsOrigoY,     parentWidth,     parentLabelLength,parentCols,
      leftFriendOrigoX,  leftFriendWidth, leftFriendLength, leftFriendCols,
      rightFriendOrigoX, rightFriendWidth,rightFriendLength,rightFriendCols,
      siblingsOrigoX, siblingsOrigoY, siblingsNodeWidth, siblingsNodeHeight, siblingsLabelLength, siblingsCols,
    } = this.calculateLayoutParams({
      centralPage,
      parents, children, leftFriends, rightFriends, siblings,
      isCenterEmbedded, centerEmbedHeight, centerEmbedWidth,
      style, rootNode: this.rootNode
    });
 
    // layout    
    const lCenter = new Layout({
      origoX: 0,
      origoY: isCenterEmbedded
        ? centerEmbedHeight/2 // -this.nodeHeight/2 (would move friends exactly in alignment with the center)
        : 0, // because this is set to zero friends are just slightly off center
      top: null,
      bottom: null,
      columns: 1,
      columnWidth: isCenterEmbedded
        ? centerEmbedWidth
        : rootWidth,
      rowHeight: isCenterEmbedded
        ? centerEmbedHeight
        : rootNodeDimensions.height,
        maxLabelLength: rootNodeLength
    });
    this.layouts.push(lCenter);

    const lChildren = new Layout({
      origoX: 0,
      origoY: childrenOrigoY,
      top: 0,
      bottom: null,
      columns: childrenCols,
      columnWidth: childWidth,
      rowHeight: this.nodeHeight,
      maxLabelLength: childLength
    });
    this.layouts.push(lChildren);
    
    const lFriends = new Layout({
      origoX: -leftFriendOrigoX,
      origoY: 0,
      top: null,
      bottom: null,
      columns: leftFriendCols,
      columnWidth: leftFriendWidth,
      rowHeight: this.nodeHeight,
      maxLabelLength: leftFriendLength
    });
    this.layouts.push(lFriends);

    const lNextFriends = new Layout({
      origoX: rightFriendOrigoX,
      origoY: 0,
      top: null,
      bottom: null,
      columns: rightFriendCols,
      columnWidth: rightFriendWidth,
      rowHeight: this.nodeHeight,
      maxLabelLength: rightFriendLength
    });
    this.layouts.push(lNextFriends);
    
    const lParents = new Layout({
      origoX:0,
      origoY: - parentsOrigoY,
      top: null,
      bottom: -2 * this.nodeHeight,
      columns: parentCols, // 3,
      columnWidth: parentWidth,
      rowHeight: this.nodeHeight,
      maxLabelLength: parentLabelLength
    });
    this.layouts.push(lParents);

    const lSiblings = new Layout({
      //origoX: this.nodeWidth * ((parentCols-1)/2 + (siblingsCols+1.5)/3), //orig
      origoX: siblingsOrigoX,
      origoY: - siblingsOrigoY,
      top: null,
      bottom: null,
      columns: siblingsCols, 
      columnWidth: siblingsNodeWidth,
      rowHeight: siblingsNodeHeight,
      maxLabelLength: siblingsLabelLength
    })
    this.layouts.push(lSiblings);

    centralPage.maxLabelLength = rootNodeLength; 

    this.nodesMap.set(centralPage.path,this.rootNode);
    lCenter.nodes.push(this.rootNode);
  
    this.addNodes({
      neighbours: parents,
      layout: lParents,
      isCentral: false,
      isSibling: false,
      friendGateOnLeft: true,
      role: Role.PARENT,
    });
  
    this.addNodes({
      neighbours: children,
      layout: lChildren,
      isCentral: false,
      isSibling: false,
      friendGateOnLeft: true,
      role: Role.CHILD,
    });
  
    this.addNodes({
      neighbours: leftFriends,
      layout: lFriends,
      isCentral: false,
      isSibling: false,
      friendGateOnLeft: false,
      role: Role.LEFT,
    });

    this.addNodes({
      neighbours: rightFriends,
      layout: lNextFriends,
      isCentral: false,
      isSibling: false,
      friendGateOnLeft: true,
      role: Role.RIGHT,
    });

    if(settings.renderSiblings) {
      this.addNodes({
        neighbours: siblings,
        layout: lSiblings,
        isCentral: false,
        isSibling: true,
        friendGateOnLeft: true,
        role: Role.CHILD, // 親の getChildren() 由来。isSibling で高さは 0 になる
      });
    }

    
    //-------------------------------------------------------
    // Generate links for all displayed nodes
    const addLinks = (nodeA: Node, neighbours:Neighbour[],role: Role) => {
      neighbours.forEach(neighbour=>{
        const nodeB = this.nodesMap.get(neighbour.page.path);
        if(!nodeB) {
          return;
        }
        this.links.addLink(
          nodeA,
          nodeB,
          role,
          neighbour.relationType,
          neighbour.typeDefinition,
          neighbour.linkDirection,
          ea,
          settings
        )
      })
    }

    Array.from(this.nodesMap.values()).forEach(nodeA => {
      addLinks(nodeA, nodeA.page.getChildren(),Role.CHILD);
      addLinks(nodeA, nodeA.page.getParents(),Role.PARENT);
      addLinks(nodeA, nodeA.page.getLeftFriends(),Role.LEFT);
      addLinks(nodeA, nodeA.page.getPreviousFriends(),Role.LEFT);
      addLinks(nodeA, nodeA.page.getRightFriends(),Role.RIGHT);
      addLinks(nodeA, nodeA.page.getNextFriends(),Role.RIGHT);
    });
  
    //-------------------------------------------------------
    // Render
    applyEAStyle(ea, { opacity: 100 });
    let sceneryElements: ExcalidrawElement[] = [];
    if(this.view3D) {
      sceneryElements = await this.render3D({friends: [lFriends, lNextFriends], parents: lParents, children: lChildren});
    } else {
      await Promise.all(this.layouts.map(async (layout) => await layout.render()));
    }
    const sceneryIds = new Set(sceneryElements.map(el=>el.id));
    const nodeElements = ea.getElements().filter(el=>!sceneryIds.has(el.id));
    const nodeIds = new Set(nodeElements.map(el=>el.id));
    this.links.render(Array.from(this.toolsPanel.linkTagFilter.selectedLinks), this.view3D);
    
    const linkElements = ea.getElements().filter(el=>!nodeIds.has(el.id) && !sceneryIds.has(el.id));


    //hack to send link elements behind node elements (and, in 3D, the floor, shadows and pillars behind the links, in that order)
    const newImagesDict = sceneryElements.concat(linkElements, nodeElements) 
      .reduce<Record<string, ExcalidrawElement>>((dict, obj) => {
        dict[obj.id] = obj;
        return dict;
      }, {});

    ea.elementsDict = newImagesDict;

    const excalidrawAPI = ea.getExcalidrawAPI();
    if(!excalidrawAPI) {
      throw new Error("ExcaliBrain: Excalidraw API became unavailable during render.");
    }
    await addElementsToViewTransient(ea);
    updateViewSceneTransient(ea, {appState: {viewBackgroundColor: settings.backgroundColor}});
    if(settings.allowAutozoom && !retainCentralNode) {
      window.setTimeout(() => excalidrawAPI.zoomToFit?.(ea.getViewElements(), settings.maxZoom, 0.15), 100);
    }
  
    this.toolsPanel.rerender();
    if(this.focusSearchAfterInitiation && settings.allowAutofocuOnSearch) {
      this.toolsPanel.searchElement.focus();
      this.focusSearchAfterInitiation = false;
    }

    this.blockUpdateTimer = false;
  }

  /**
   * 3D の描画（docs/3d-design.md §6-1・§6-2・§6-5・§6-6）。配置 → 帯を動かす（友は中心の y に、Parents／Children は
   * 中心から `bandDistance`）→ Up／Down（level ≠ 0）を中心の真上・真下の垂直軸へ移す → 投影 → north 降順にノード →
   * 床（外周・グリッド・十字・方角）。柱と影は LEV-128 で描くのをやめた（本人のフィードバック 3: 上下は箱の高さで読む）。
   * 2D と同じ `place()` の中心を投影で置き換えるだけで、Node の描画は無改造。埋め込みの中心（`retainCentralNode` で
   * 要素を保持する）は Layout が原点に置き、原点は中心ノート（north 0・level 0）の投影の不動点なので、保持した要素の位置は
   * 3D でも合う。床は箱の位置（足元の横幅）が要るのでノードのあとに描くが、戻り値の要素を `render()` がリンクとノードの
   * 後ろに置く（§6-2 の重ね順。z 順は `ea.elementsDict` の並びだけで決まる）。link は付けず、ノードのグループにも
   * 入れない。床が変えた `ea.style` は元に戻すので、続く `links.render()` が受け取るスタイルは 2D と同じ（最後のノードが
   * 残したもの）。Node には `render({floor})`（`floorOf`: 画面内の最下段を L1 とする基準）で 3D を伝える
   * （§6-3: ゲート・数字なし、level 別の色、L ラベル。`Node.render()`）。
   */
  private async render3D(bands: {friends: Layout[]; parents: Layout; children: Layout}): Promise<ExcalidrawElement[]> {
    const ea = this.ea;
    const view3D = this.plugin.settings.view3D;
    const params: ProjectionParams = {
      northShearX: view3D.northShearX,
      northRise: view3D.northRise,
      upHeight: view3D.upHeightFactor * this.nodeHeight,
      downHeight: view3D.downHeightFactor * this.nodeHeight,
    };

    // 配置: 2D と同じ中心
    this.layouts.forEach(layout => layout.place());

    // 友の帯を中心ノートの y に揃える（§6-1「フレンドと中心は同じ north」）。中心は動かさない
    const rootCenter = this.rootNode.getCenter();

    // 床に残る Parents／Children の帯を中心から等距離に置く（§6-6、LEV-128）。垂直軸に立つ Up／Down と重ならないように、
    // 帯のうち中心にいちばん近い行を `bandDistance` の位置へ帯ごと動かす。level 0 のノードが無い帯は動かさない
    const bandDistance = view3D.bandDistanceFactor * this.nodeHeight;
    const bandShiftOf = (layout: Layout, side: -1 | 1): number => {
      const ys = layout.nodes.filter(node => node.level === FLOOR_LEVEL).map(node => node.getCenter().y);
      if(ys.length === 0) return 0;
      return bandShift(rootCenter.y, side < 0 ? Math.max(...ys) : Math.min(...ys), bandDistance, side);
    };
    const parentShift = bandShiftOf(bands.parents, -1);
    const childShift = bandShiftOf(bands.children, 1);
    const shiftOf = (layout: Layout): number =>
      bands.friends.includes(layout) ? friendBandShift(rootCenter.y, layout.spec.rowHeight)
      : layout === bands.parents ? parentShift
      : layout === bands.children ? childShift
      : 0;

    const laid = this.layouts.flatMap(layout => layout.nodes.map(node => {
      const c = node.getCenter();
      return { node, level: node.level, center: {x: c.x, y: c.y + shiftOf(layout)} };
    }));

    // Up／Down は帯を離れて垂直に（§6-5、本人の追記 2）: level ≠ 0 のノードは中心ノートと同じ north の行（床の十字の
    // 東西の線）へ `verticalGapFactor` の間隔で移る。1 つなら中心の真上・真下。床の平行四辺形に残るのは level 0 だけ
    const centres = verticalRow(laid, rootCenter, view3D.verticalGapFactor * this.nodeHeight);

    // 投影（§6-1）
    const placed: PlacedNode[] = laid.map(({node}, i) => ({ node, center: centres[i], projected: project(centres[i], node.level, params) }));
    placed.forEach(p => p.node.setCenter({x: p.projected.x, y: p.projected.y}));

    // 奥（north 大）から手前へ逐次描く（§6-1）。`floor` は色とラベルの基準（最下段＝L1、§6-3）で、床の平面（`FLOOR_LEVEL`）とは別
    const floor = floorOf(placed.map(p => p.node.level));
    placed.sort((a, b) => compareDrawOrder(a.projected, b.projected));
    for (const p of placed) {
      await p.node.render({floor});
    }

    // 描画済みの箱（`node.id`: テキストなら枠、埋め込みなら iframe／画像。保持した埋め込みでも `Node.render()` が `id` を付け直す）。
    // 保持した埋め込みの中心の要素がキャンバスから消えていれば、そのノードの足元は床の広さに数えない
    const boxed = placed.flatMap(p => {
      const box = ea.getElement(p.node.id);
      return box ? [{...p, box}] : [];
    });

    // 床の平面（§6-2、本人の追記 2026-09-21）: 中心の段を、床の段の箱の下端まで下げる（`floorDrop`）
    const drop = floorDrop(boxed.map(p => ({level: p.node.level, height: p.box.height})), this.nodeHeight, params.downHeight);
    const plane: FloorPlane = (point) => {
      const p = project(point, FLOOR_LEVEL, params);
      return {x: p.x, y: p.y + drop};
    };

    // 床（§6-6）: 足元と箱の横幅をすべて囲む最小の範囲に `floorMarginFactor` の余白。ただし中心から奥へ `floorNorthFactor`、
    // 手前へ `floorSouthFactor` は必ず広げる（Up／Down が帯を離れたので、足元だけでは南に奥行きが出ない）。
    // グリッドは nodeHeight 間隔、十字は中心ノートの足元。方角は外周から画面で余白の半分（南北は投影で northRise 倍に縮むので割る）
    const margin = view3D.floorMarginFactor * this.nodeHeight;
    const plan = floorPlan(
      boxed.map(p => ({...p.center, width: p.box.width})),
      rootCenter,
      this.nodeHeight,
      margin,
      {x: margin / 2, y: margin / 2 / params.northRise},
      {north: view3D.floorNorthFactor * this.nodeHeight, south: view3D.floorSouthFactor * this.nodeHeight},
    );
    const floorIds = this.keepingStyle(() => this.renderFloor(plan, plane));

    return floorIds.map(id => ea.getElement(id));
  }

  /** `draw` が変えた `ea.style` を元に戻す。床・影・柱のスタイルを、続くノードやリンクの描画に残さないため。 */
  private keepingStyle<T>(draw: () => T): T {
    const saved = {...this.ea.style};
    try {
      return draw();
    } finally {
      applyEAStyle(this.ea, saved);
    }
  }

  /** 3D の床・柱・影に共通の線のスタイル（角を立て、手描き風を切る）。色と太さは呼び出し側が重ねる。 */
  private applySceneryStyle(style: {strokeColor: string; strokeWidth: number; strokeStyle?: "solid" | "dashed"; backgroundColor?: string}): void {
    applyEAStyle(this.ea, {
      fillStyle: "solid",
      strokeSharpness: "sharp",
      roughness: 0,
      strokeStyle: "solid",
      backgroundColor: "transparent",
      ...style,
    });
  }

  /**
   * 床（§6-2）: `plan`（2D の地面座標）を床の高さに投影して、外周（薄い面付き）→ グリッド → 十字 → 方角の順に描く。
   * 東西の線は水平のまま、南北の線は northShearX／northRise の向きに傾くので、床は平行四辺形になる。
   */
  private renderFloor(plan: FloorPlan, plane: FloorPlane): string[] {
    const ea = this.ea;
    const settings = this.plugin.settings;
    const textColor = settings.baseNodeStyle.textColor;
    const {minX, maxX, minY, maxY} = plan.bounds;
    const at = (x: number, y: number): [number, number] => {
      const p = plane({x, y});
      return [p.x, p.y];
    };

    // 外周
    this.applySceneryStyle({
      strokeColor: withAlpha(textColor, VIEW_3D.floorStrokeAlpha),
      backgroundColor: withAlpha(textColor, VIEW_3D.floorFillAlpha),
      strokeWidth: VIEW_3D.gridWidth,
    });
    const nw = at(minX, minY), ne = at(maxX, minY), se = at(maxX, maxY), sw = at(minX, maxY);
    const ids = [ea.addLine([nw, ne, se, sw, nw])];

    // グリッド（十字と重なる 2 本は plan に含まれない）
    this.applySceneryStyle({ strokeColor: withAlpha(textColor, VIEW_3D.gridAlpha), strokeWidth: VIEW_3D.gridWidth });
    for (const x of plan.columnXs) ids.push(ea.addLine([at(x, minY), at(x, maxY)]));
    for (const y of plan.rowYs) ids.push(ea.addLine([at(minX, y), at(maxX, y)]));

    // 十字: 中心ノートの足元を通る東西軸と南北軸
    this.applySceneryStyle({ strokeColor: withAlpha(textColor, VIEW_3D.crossAlpha), strokeWidth: VIEW_3D.crossWidth });
    ids.push(
      ea.addLine([at(minX, plan.origin.y), at(maxX, plan.origin.y)]),
      ea.addLine([at(plan.origin.x, minY), at(plan.origin.x, maxY)]),
    );

    // 方角: 十字の両端
    applyEAStyle(ea, {
      strokeColor: withAlpha(textColor, VIEW_3D.compassAlpha),
      fontFamily: settings.baseLinkStyle.fontFamily,
      fontSize: settings.baseNodeStyle.fontSize,
    });
    const label = (text: string, {x, y}: Point): string => {
      const [px, py] = at(x, y);
      const size = ea.measureText(text);
      return ea.addText(px - size.width / 2, py - size.height / 2, text);
    };
    ids.push(
      label(t("COMPASS_NORTH"), plan.compass.north),
      label(t("COMPASS_SOUTH"), plan.compass.south),
      label(t("COMPASS_WEST"), plan.compass.west),
      label(t("COMPASS_EAST"), plan.compass.east),
    );
    return ids;
  }

  public isCentralLeafStillThere():boolean {
    const settings = this.plugin.settings;
    const centralLeaf = this.centralLeaf;
    const noCentralLeaf = !centralLeaf || this.app.workspace.getLeafById(centralLeaf.id) === null;
    if(noCentralLeaf) {
      return false;
    }
    if (centralLeaf?.view instanceof FileView && centralLeaf.view.file?.path === settings.excalibrainFilepath) {
      return false;
    }
    return true;
  }

  private async brainEventHandler (leaf:WorkspaceLeaf, startup:boolean = false) {
    const settings = this.plugin.settings;
    
    if(!this.ensureBrainViewBound()) {
      if(!this.terminated) this.unloadScene();
      return;
    }

    if(this.disregardLeafChange) {
      return;
    }

    if(!startup && !settings.autoOpenCentralDocument) {
      return;
    }

    this.blockUpdateTimer = true;
    await sleep(100);

    // active-leaf-change handlers can outlive a startup/teardown transition.
    // Revalidate after the await before touching EA or Scene state.
    if(this.terminated || !this.ensureBrainViewBound()) {
      this.blockUpdateTimer = false;
      return;
    }

    // The user may turn navigation synchronization off while this debounced
    // active-leaf-change handler is waiting. Do not let that already queued
    // event navigate the graph after the toggle has been switched off.
    if(!startup && !this.plugin.settings.autoOpenCentralDocument) {
      this.blockUpdateTimer = false;
      return;
    }

    //-------------------------------------------------------
    //terminate event handler if view no longer exists or file has changed

    if(this.pinLeaf && !this.isCentralLeafStillThere()) {
      this.pinLeaf = false;
      this.toolsPanel.rerender();
    }

    if(this.pinLeaf && leaf !== this.centralLeaf) return;
    
    if(!(leaf?.view && (leaf.view instanceof FileView) && leaf.view.file)) {
      this.blockUpdateTimer = false;
      return;
    }

    const rootFile = leaf.view.file;
    
    if (rootFile.path === settings.excalibrainFilepath) { //brainview drawing is the active leaf
      if(this.vaultFileChanged) {
        this.zoomToFitOnNextBrainLeafActivate = false;
        await this.reRender(true);
      }
      if(this.zoomToFitOnNextBrainLeafActivate) {
        this.zoomToFitOnNextBrainLeafActivate = false;
        if(settings.allowAutozoom) {
          this.ea.getExcalidrawAPI().zoomToFit(null, settings.maxZoom, 0.15);
        }
      }
      this.blockUpdateTimer = false;
      return; 
    }
  
    const centralPage = this.getCentralPage();
    if(
      centralPage &&
      centralPage.path === rootFile.path &&
      rootFile.stat.mtime === centralPage.mtime
    ) {
      this.blockUpdateTimer = false;
      return; //don't reload the file if it has not changed
    }

    if(!this.plugin.pages.get(rootFile.path)) {
      await this.plugin.createIndex();
    }

    this.plugin.navigationHistory.addToHistory(rootFile.path);
    this.centralPagePath = rootFile.path;
    this.centralPageFile = rootFile;
    this.centralLeaf = leaf;
    await this.render();
  }

  private async addEventHandler() {
    const fileChangeHandler = () => {
      this.vaultFileChanged = true;
    }

    const beh = (leaf: WorkspaceLeaf): void => {
      void this.brainEventHandler(leaf).catch((error: unknown) => {
        if(!this.terminated) {
          errorlog({
            fn: "Scene.brainEventHandler",
            where: "Scene.brainEventHandler()",
            message: "Active-leaf-change handler failed",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    };
    this.app.workspace.on("active-leaf-change", beh);
    this.removeEH = () => this.app.workspace.off("active-leaf-change",beh);
    this.setTimer();
    this.app.vault.on("rename",fileChangeHandler);
    this.removeOnRename = () => this.app.vault.off("rename",fileChangeHandler)
    this.app.vault.on("modify",fileChangeHandler);
    this.removeOnModify = () => this.app.vault.off("modify",fileChangeHandler)
    this.app.vault.on("create",fileChangeHandler);
    this.removeOnCreate = () => this.app.vault.off("create",fileChangeHandler)
    this.app.vault.on("delete",fileChangeHandler);
    this.removeOnDelete = () => this.app.vault.off("delete",fileChangeHandler)

    const leaves: WorkspaceLeaf[] = [];
    this.app.workspace.iterateAllLeaves(l=>{
      if( (l.view instanceof FileView) && l.view.file && l.view.file.path !== this.plugin.settings.excalibrainFilepath) {
        leaves.push(l);
      }
    })
    
    await this.plugin.createIndex(); //temporary
    
    let leafToOpen = leaves[0];
    if(leaves.length>0) {
      const lastFilePath = this.app.workspace.getLastOpenFiles()[0];
      if(lastFilePath && lastFilePath !== "") {
        const leaf = leaves.filter((l) => l.view instanceof FileView && l.view.file?.path === lastFilePath);
        if(leaf.length>0) {
          leafToOpen = leaf[0];
        }
      }
      keepOnTop(this.ea, this.app);  
      void this.brainEventHandler(leafToOpen, true).catch((error: unknown) => {
        if(!this.terminated) {
          errorlog({
            fn: "Scene.brainEventHandler",
            where: "Scene.addEventHandler()",
            message: "Initial brain navigation failed",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    } else {
      if(this.plugin.navigationHistory.length>0) {
        const lastFilePath = this.plugin.navigationHistory.last;
        window.setTimeout(() => { void this.renderGraphForPath(lastFilePath, true); }, 100);
      }
    }
  }

  setTimer() {
    const updateTimer = async () => {
      if(this.blockUpdateTimer) {
        return;
      }
      if(this.vaultFileChanged) {
        this.vaultFileChanged = false;
        await this.plugin.createIndex();
        if(this.centralPagePath) {
          const centralPage = this.getCentralPage();
          if(!centralPage) {
            const centralLeaf = this.centralLeaf;
            if(centralLeaf?.view instanceof FileView && centralLeaf.view.file) {
              this.centralPageFile = centralLeaf.view.file;
              this.centralPagePath = this.centralPageFile.path;
            }
          }
        }
        await this.render(true);
      }
    }

    if(this.removeTimer) {
      this.removeTimer();
      this.removeTimer = undefined;
    }

    const timer = window.setInterval((): void => { void updateTimer(); }, this.plugin.settings.indexUpdateInterval);
    this.removeTimer = () => window.clearInterval(timer);
  }


  public unloadScene(saveSettings:boolean = true, silent: boolean = false) {
    if(this.removeEH) {
      this.removeEH();
      this.removeEH = undefined;
    }

    if(this.removeTimer) {
      this.removeTimer();
      this.removeTimer = undefined;
    }

    if(this.removeOnRename) {
      this.removeOnRename();
      this.removeOnRename = undefined;
    }
    
    if(this.removeOnModify) {
      this.removeOnModify();
      this.removeOnModify = undefined;
    }

    if(this.removeOnCreate) {
      this.removeOnCreate();
      this.removeOnCreate = undefined;
    }
    
    if(this.removeOnDelete) {
      this.removeOnDelete();
      this.removeOnDelete = undefined;
    }

    configureExcaliBrainView(this.ea, false);
    if(this.ea.targetView?.excalidrawAPI) {
      try {
        this.ea.targetView.excalidrawAPI.setMobileModeAllowed?.(true);
        updateViewSceneTransient(this.ea, {appState:{viewModeEnabled:false}});
      } catch {
        // View teardown can invalidate the transient API between the guard and update.
      }
    }
    releaseViewEA(this.ea);
    // timout is to make sure Obsidian is not being terminated when scene closes,
    // becasue that can lead to crippled settings file
    // if the plugin is still there after 400ms, it is safe to save the settings
    if(saveSettings) {
      window.setTimeout((): void => {
        void (async (): Promise<void> => {
          await this.plugin.loadSettings(); //only overwrite the navigation history, save other synchronized settings
          this.plugin.settings.navigationHistory = [...this.plugin.navigationHistory.get()];
          await this.plugin.saveSettings();
        })();
      }, 400);
    }
    this.toolsPanel?.terminate();
    this.toolsPanel = undefined;
    this.historyPanel?.terminate();
    this.historyPanel = undefined;  
    this.ea.setView?.(null);
    destroyViewEA(this.ea);
    this.plugin.EA = getEA() ?? this.plugin.EA;
    this.leaf = undefined;
    this.centralLeaf = undefined;
    this.centralPagePath = undefined;
    this.centralPageFile = undefined;
    this.terminated = true;
    if(!this.app.plugins.plugins["obsidian-excalidraw-plugin"]) {
      this.plugin.EA = null;
    }
    if(!silent) {
      new Notice("Brain Graph Off");
    }
    const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
    if(mostRecentLeaf) {
      this.app.workspace.setActiveLeaf(
        mostRecentLeaf,
        { focus: true },
      )
    }
  }
}
