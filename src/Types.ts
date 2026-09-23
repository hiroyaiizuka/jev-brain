import { FillStyle, StrokeRoundness, StrokeStyle, Arrowhead as ExcalidrawArrowHead } from "./utils/ExcalidrawAutomateCompatibility";
import { Page } from "./graph/Page";

export enum RelationType {
  DEFINED = 1,
  INFERRED = 2
}

export enum Role {
  PARENT,
  CHILD,
  LEFT,
  RIGHT,
}

export enum LinkDirection {
  TO = 1,
  FROM = 2,
  BOTH = 3,
}

export type Arrowhead = ExcalidrawArrowHead;

export type Relation = {
  target: Page;
  direction: LinkDirection;
  isHidden: boolean;
  isParent: boolean;
  parentType?: RelationType;
  parentTypeDefinition?: string;
  isChild: boolean;
  childType?: RelationType;
  childTypeDefinition?: string;
  isLeftFriend: boolean;
  leftFriendType?: RelationType;
  leftFriendTypeDefinition?: string;
  isRightFriend: boolean;
  rightFriendType?: RelationType;
  rightFriendTypeDefinition?: string;
  isNextFriend: boolean;
  nextFriendType?: RelationType;
  nextFriendTypeDefinition?: string;
  isPreviousFriend: boolean;
  previousFriendType?: RelationType;
  previousFriendTypeDefinition?: string;
}

export type Hierarchy = {
  hidden: string[],
  /** Up region: fields whose target is more abstract than the page (docs/ontology-axis-design.md). Wins over parents. */
  abstract: string[],
  /** Down region: fields whose target is more concrete than the page. Wins over children. */
  concrete: string[],
  parents: string[],
  children: string[],
  leftFriends: string[],
  /** Legacy pre-left/right friend setting retained only for settings migration. */
  friends?: string[],
  rightFriends: string[],
  previous: string[],
  next: string[],
  exclusions: string[],
}

export type NodeStyle = {
  prefix?: string
  backgroundColor?: string,
  fillStyle?: FillStyle,
  textColor?: string,
  borderColor?: string,
  fontSize?: number,
  fontFamily?: number,
  maxLabelLength?: number,
  roughness?: number,
  strokeShaprness?: StrokeRoundness,
  strokeWidth?: number,
  strokeStyle?: StrokeStyle,
  padding?: number,
  gateRadius?: number,
  gateOffset?: number,
  gateStrokeColor?: string,
  gateBackgroundColor?: string,
  gateFillStyle?: FillStyle,
  embedWidth?: number,
  embedHeight?: number,
}

export type NodeStyleData = {
  style: NodeStyle,
  allowOverride:boolean,
  userStyle: boolean,
  display: string,
  getInheritedStyle: ()=>NodeStyle
}

export type NodeStyles = {
  [key:string]: NodeStyleData
};

export type LinkStyle = {
  strokeColor?: string,
  strokeWidth?: number,
  strokeStyle?: StrokeStyle,
  roughness?: number,
  startArrowHead?: Arrowhead,
  endArrowHead?: Arrowhead,
  showLabel?: boolean,
  fontSize?: number,
  fontFamily?: number,
  textColor?: string
}

export type LinkStyleData = {
  style: LinkStyle,
  allowOverride:boolean,
  userStyle: boolean,
  display: string,
  getInheritedStyle: ()=>LinkStyle,
}

export type LinkStyles = {
  [key:string]: LinkStyleData
};

export type Neighbour = {
  page: Page;
  relationType: RelationType;
  typeDefinition: string;
  linkDirection: LinkDirection;
}

/**
 * Settings of the 3D view (docs/3d-design.md §6-1): the cabinet projection `Projection.project` uses.
 * The toggle itself (`Scene.view3D`) is not saved. Defaults: `DEFAULT_VIEW_3D_SETTINGS` in constants.ts.
 */
export type View3DSettings = {
  /** Screen x shift per unit of north (2D distance north of the central node). */
  northShearX: number;
  /** Screen y rise per unit of north. */
  northRise: number;
  /** Screen x shift per pixel of height, so what stands on the floor leans east the way the floor does (LEV-137; the author's 0.64). */
  heightShearX: number;
  /** Height of the Up level above the centre = nodeHeight × this (LEV-128: the author's 241px is 3.1). */
  upHeightFactor: number;
  /** Depth of the Down level below the centre = nodeHeight × this (LEV-128: the author's 274px is 3.6). */
  downHeightFactor: number;
  /** East-west gap between several Ups (or Downs) on the vertical axis = nodeHeight × this. */
  verticalGapFactor: number;
  /** How many Ups (or Downs) stand side by side before the next row starts (LEV-127; the author's 5). */
  verticalColumns: number;
  /**
   * Height of one wrapped row = nodeHeight × this. Kept between the box height (≈0.86 × nodeHeight, below which
   * rows overlap) and the Up height (above which a wrapped row reads as another level). The slider enforces 0.9–2.5.
   */
  rowLiftFactor: number;
  /** Distance from the centre to the nearest row of the level-0 Parents/Children bands = nodeHeight × this. */
  bandDistanceFactor: number;
  /** Smallest floor reach north of the centre = nodeHeight × this (the feet widen it further). */
  floorNorthFactor: number;
  /** Smallest floor reach south of the centre = nodeHeight × this: the depth in front (3d-feedback 追記 3). */
  floorSouthFactor: number;
  /** Margin left around the feet at the edge of the floor = nodeHeight × this. */
  floorMarginFactor: number;
};

/**
 * Settings of the Jev link typer (docs/jev-link-typer-design.md §6). Defaults: `DEFAULT_JEV_SETTINGS`
 * in constants.ts. Without a key and `enabled`, excalibrain-main.ts registers nothing of Jev.
 */
export type JevSettings = {
  /** TypeSafe API key. data.json keeps it in plain text, which the settings tab says. */
  apiKey: string;
  /** Turns Jev off without deleting the key. */
  enabled: boolean;
  /** Suggest a field right after the closing `]]` of a link (JEV-2). */
  suggestOnLinkClose: boolean;
  /** Characters sent from either side of the link as context. */
  contextChars: number;
  /** Heading of the section a confirmed `field:: [[X]]` line is appended to in `relations` mode. */
  relationsHeading: string;
  /** Where a confirmed field goes: the link in the body it was pointed at (the default), or the Relations section. */
  writeMode: "relations" | "inline";
  /**
   * Q1 offers only the fields the index uses at least this many times; 0 offers every field of the
   * ontology (design §2-4, LEV-164). A field used fewer times is never suggested.
   */
  candidateMinUses: number;
  /** Smallest probability at which a bulk run confirms the first candidate on its own (JEV-4). 0 = off, the default (LEV-164). */
  autoConfirmThreshold: number;
  /** Smallest probability at which an existing field is offered for review (JEV-4). 0 = off, the default (LEV-164). */
  reviewThreshold: number;
  /** Jev endpoint the client posts to. */
  endpoint: string;
  /** Jev model. */
  model: string;
};

export type LayoutSpecification = {
  columns: number;
  origoX: number;
  origoY: number;
  top: number;
  bottom: number;
  rowHeight: number;
  columnWidth: number;
  maxLabelLength: number;
}

export type Dimensions = {width:number, height:number};

export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};