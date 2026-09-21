import { ExcalidrawAutomate, ExcalidrawImageElement, applyEAStyle } from "src/utils/ExcalidrawAutomateCompatibility";
import { ExcaliBrainSettings } from "src/Settings";
import { Dimensions, NodeStyle } from "src/Types";
import { getTagStyle } from "src/utils/dataview";
import { Page } from "./Page";
import { isEmbedFileType } from "src/utils/fileUtils";
import { getEmbeddableDimensions } from "src/utils/embeddableHelper";
import { Level } from "./Projection";

/** 3D (docs/3d-design.md §6-3): the level label at the shoulder of the box, as a fraction of the node font size. */
const LEVEL_LABEL_FONT_SCALE = 0.6;

/** WCAG contrast a text colour must reach on the level colour before it is swapped for black or white (AA, large text). */
const MIN_TEXT_CONTRAST = 3;

type Rgb = [number, number, number];

/** `#rrggbb` or `#rrggbbaa` (the settings' colour pickers write the latter) → channels 0..255 and alpha 0..1. Null if unparsable. */
const parseColor = (color: string): { rgb: Rgb; alpha: number } | null => {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return null;
  const rgb = [0, 2, 4].map((at) => parseInt(match[1].substring(at, at + 2), 16)) as Rgb;
  return { rgb, alpha: match[2] ? parseInt(match[2], 16) / 255 : 1 };
};

/** The colour seen when `color` is drawn over an opaque `ground`. */
const compositeOver = (color: { rgb: Rgb; alpha: number }, ground: Rgb): Rgb =>
  color.rgb.map((c, i) => c * color.alpha + ground[i] * (1 - color.alpha)) as Rgb;

/** Relative luminance (WCAG, 0 = black, 1 = white). */
const luminanceOf = ([r, g, b]: Rgb): number => {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrastOf = (l1: number, l2: number): number => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/**
 * The text colour to use on `background`: `preferred` (the node's own text colour) while it reads on it
 * (contrast ≥ `MIN_TEXT_CONTRAST`), otherwise black or white, whichever contrasts more. The default text is
 * white and the default level colours are light, so without this the lower levels would be unreadable in 3D.
 * `canvas` is what shows through a translucent `background` (the pickers have an opacity slider): the
 * background is composited over it, and the text over the result, before the contrast is measured. Without
 * `canvas` the background counts as opaque. A background or text colour that does not parse keeps `preferred`.
 */
export const readableTextColor = (background: string, preferred: string, canvas?: string): string => {
  const bg = parseColor(background);
  const text = parseColor(preferred);
  if (!bg || !text) return preferred;
  const ground = canvas === undefined ? null : parseColor(canvas);
  const bgRgb = ground ? compositeOver(bg, ground.rgb) : bg.rgb;
  const bgL = luminanceOf(bgRgb);
  if (contrastOf(bgL, luminanceOf(compositeOver(text, bgRgb))) >= MIN_TEXT_CONTRAST) return preferred;
  return contrastOf(bgL, 0) >= contrastOf(bgL, 1) ? "#000000ff" : "#ffffffff";
};

/** What `Scene.render3D()` hands `Node.render()` in 3D: the lowest level on screen (`Projection.floorOf`), shown as L1. */
export type View3DRender = { floor: Level };

export class Node {
  page: Page;
  settings: ExcaliBrainSettings;
  ea: ExcalidrawAutomate;
  style: NodeStyle = {};
  private center: {x:number, y:number} = {x:0,y:0};
  public id: string;
  public friendGateId: string;
  public nextFriendGateId: string; // for central nodes
  public parentGateId: string;
  public childGateId: string;
  private friendGateOnLeft: boolean;
  public title: string;
  public isCentral: boolean = false;
  public isEmbedded: boolean = false;
  public embeddedElementIds: string[] = [];
  /**
   * Height band for the 3D view (docs/3d-design.md §3-1): +1 for a parent linked through an
   * Up field, -1 for a child linked through a Down field, 0 for everything else. The 2D path
   * never changes it; `render()` reads it only in 3D (the level colour and label).
   */
  public level: Level = 0;

  constructor(x:{
    ea: ExcalidrawAutomate,
    page:Page,
    isInferred: boolean,
    isCentral: boolean,
    isSibling: boolean,
    friendGateOnLeft:boolean,
    isEmbeded?: boolean,
    embeddedElementIds?: string[],
  }) {
    if(x.embeddedElementIds) {
      this.embeddedElementIds = x.embeddedElementIds;
    }
    this.isEmbedded = x.isEmbeded ?? false;
    this.isCentral = x.isCentral;
    this.page = x.page;
    this.settings = x.page.plugin.settings;
    this.ea = x.ea;
    if(this.page.isFolder) {
      this.style = {
        ...this.settings.baseNodeStyle,
        ...x.isCentral?this.settings.centralNodeStyle:{},
        ...x.isSibling?this.settings.siblingNodeStyle:{},
        ...this.settings.folderNodeStyle
      }
    } else if (this.page.isTag) {
      this.style = {
        ...this.settings.baseNodeStyle,
        ...x.isCentral?this.settings.centralNodeStyle:{},
        ...x.isSibling?this.settings.siblingNodeStyle:{},
        ...this.settings.tagNodeStyle
      }
    } else {
      this.style = {
        ...this.settings.baseNodeStyle,
        ...x.isInferred?this.settings.inferredNodeStyle:{},
        ...x.page.isURL?this.settings.urlNodeStyle:{},
        ...x.page.isVirtual?this.settings.virtualNodeStyle:{},
        ...x.isCentral?this.settings.centralNodeStyle:{},
        ...x.isSibling?this.settings.siblingNodeStyle:{},
        ...x.page.isAttachment?this.settings.attachmentNodeStyle:{},
        ...getTagStyle([this.page.primaryStyleTag, this.page.styleTags],this.settings),
        embedHeight: this.settings.centerEmbedHeight,
        embedWidth: this.settings.centerEmbedWidth,
      };
    }
    this.friendGateOnLeft = x.friendGateOnLeft;
    this.title = this.page.getTitle();
  }

  get prefix(): string {
    return(this.style.prefix??"");
  }

  private displayText(): string {
    const label = (this.style.prefix??"") + this.title;    
    const segmentedLabel = new Intl.Segmenter().segment(label); // a tough problem string const str = "❤️😊👨‍👩‍👦"; developed from hint here: https://stackoverflow.com/questions/73145508/how-to-truncate-utf8-string-in-javascript-without-breaking-multibyte-characters/73145642#73145642
    const segArr = Array.from(segmentedLabel, ({segment}) => segment);
    return segArr.length > this.page.maxLabelLength
      ? segArr.slice(0,this.page.maxLabelLength-3).join('') + "..."
      : label;
  }

  setCenter(center:{x:number, y:number}) {
    this.center = center;
  }

  /** The centre `setCenter()` stored, as a copy. The 3D branch of Scene reads it to project the node. */
  getCenter(): {x:number, y:number} {
    return {...this.center};
  }


  async renderEmbedded():Promise<Dimensions> {
    const ea = this.ea;
    let maxDimensions = {width: this.style.embedWidth, height: this.style.embedHeight};
    if((this.page.file && isEmbedFileType(this.page.file, ea)) || this.page.isURL) {
      if(this.page.isURL) {
        maxDimensions = getEmbeddableDimensions(this.page.url, maxDimensions);
      }
      this.id = ea.addEmbeddable(
        this.center.x - maxDimensions.width/2, 
        this.center.y - maxDimensions.height/2,
        maxDimensions.width,
        maxDimensions.height,
        this.page.isURL ? this.page.url : undefined,
        this.page.isURL ? undefined : this.page.file      
      );
      const embeddable = ea.getElement(this.id);
      //overriding the default link with the full filepath
      embeddable.link = this.page.isURL ? this.page.url : `[[${this.page.file.path}]]`;
      embeddable.backgroundColor = this.style.backgroundColor;
      embeddable.strokeColor = this.style.borderColor;
      embeddable.strokeStyle = this.style.strokeStyle;
      this.embeddedElementIds.push(this.id);
      return maxDimensions;
    } else {
      this.id = await ea.addImage(
        this.center.x - maxDimensions.width/2, 
        this.center.y - maxDimensions.height/2,
        this.page.file,
        false,
        false,
      )
      const imgEl = ea.getElement<ExcalidrawImageElement>(this.id);
      //overriding the default link with the full filepath
      imgEl.link = `[[${this.page.file.path}]]`;
      let width  = imgEl.width;
      let height = imgEl.height;    
    
      if (width > maxDimensions.width || height > maxDimensions.height) {
        const aspectRatio = width / height;
    
        if (width > maxDimensions.width) {
          width = maxDimensions.width;
          height = width / aspectRatio;
        }
    
        if (height > maxDimensions.height) {
          height = maxDimensions.height;
          width = height * aspectRatio;
        }
      }
    
      imgEl.x = this.center.x - width / 2;
      imgEl.y = this.center.y - height / 2;
      imgEl.width = width;
      imgEl.height = height;

      const id = ea.addRect(
        this.center.x - width / 2,
        this.center.y - height / 2,
        width,
        height
      );
      const box = ea.getElement(id);
      box.backgroundColor = this.style.backgroundColor;
      box.strokeColor = this.style.borderColor;
      box.strokeStyle = this.style.strokeStyle;
      box.fillStyle = this.style.fillStyle;
      //hack to bring the image to the front
      delete ea.elementsDict[imgEl.id]
      ea.elementsDict[imgEl.id] = imgEl;
      this.embeddedElementIds.push(id);
      this.embeddedElementIds.push(this.id);
      return { width, height };
    }
  }

  renderText():Dimensions {
    const ea = this.ea;
    const label = this.displayText();
    const labelSize = ea.measureText(`${label}`);
    this.id = ea.addText(
      this.center.x - labelSize.width / 2, 
      this.center.y - labelSize.height / 2,
      label,
      {
        wrapAt: this.page.maxLabelLength+50,
        textAlign: "center",
        box: true,
        boxPadding: this.style.padding,
      }
    );
    const box = ea.getElement(this.id);
    box.link = this.page.isURL ? this.page.url : `[[${this.page.file?.path??this.page.path}]]`;
    box.backgroundColor = this.style.backgroundColor;
    box.strokeColor = this.style.borderColor;
    box.strokeStyle = this.style.strokeStyle;
    return labelSize;
  }

  /**
   * `view3D` (docs/3d-design.md §6-3, passed by `Scene.render3D()`; 2D callers pass nothing and get the upstream
   * drawing): no gates and no neighbour counts (the links join the boxes, `Link.render()`), the box takes
   * `settings.levelColors[level − floor]` and gets an "L{level − floor + 1}" label at its top right corner.
   */
  async render(view3D?: View3DRender) {
    const ea = this.ea;
    const settings = this.settings;
    
    const gateDiameter = this.style.gateRadius*2;
    applyEAStyle(ea, { fontSize: this.style.fontSize });
    applyEAStyle(ea, { fontFamily: this.style.fontFamily });
    applyEAStyle(ea, { fillStyle: this.style.fillStyle });
    applyEAStyle(ea, { roughness: this.style.roughness });
    applyEAStyle(ea, { strokeSharpness: this.style.strokeShaprness });
    applyEAStyle(ea, { strokeWidth: this.style.strokeWidth });
    applyEAStyle(ea, { strokeColor: this.style.textColor });
    applyEAStyle(ea, { backgroundColor: "transparent" });

    //if this.embeddedElementIds.length>0 then we are retaining the embedded element (so it does not reload)
    //Scene.render: retainCentralNode
    if(this.isEmbedded && this.embeddedElementIds.length>0) {
      //the elements survive from the previous render; point `id` at the frame (or image) as renderEmbedded() left it,
      //so readers of `id` (the 3D floor in Scene, which needs the box's width) find the box
      this.id = this.embeddedElementIds[this.embeddedElementIds.length-1];
    }

    // 3D (§6-3): the box takes the colour of its level and the text a colour that reads on it. Not for an embedded
    // node: its frame survives a re-render (retainCentralNode), so a level colour would stay on it back in 2D,
    // and the frame's background is hidden by the embedded content anyway.
    const levelColor = view3D && !this.isEmbedded ? this.levelColor(view3D.floor) : undefined;
    if(levelColor) {
      applyEAStyle(ea, { strokeColor: readableTextColor(levelColor, this.style.textColor, settings.backgroundColor) });
    }
    if(view3D && this.isEmbedded && this.embeddedElementIds.length>0) {
      // In 3D the links bind to this retained element (in 2D to gates made afresh each render); the arrows of the
      // previous render are deleted but stay listed in its boundElements, so drop them or the list grows every render.
      const box = ea.getElement(this.id);
      if(box) {
        box.boundElements = (box.boundElements ?? []).filter(bound => {
          const element = ea.getElement(bound.id);
          return element && !element.isDeleted;
        });
      }
    }

    const labelSize = this.isEmbedded
      ? this.embeddedElementIds.length>0
        ? {width: this.style.embedWidth, height: this.style.embedHeight}
        : await this.renderEmbedded()
      : this.renderText();

    if(levelColor) {
      const box = ea.getElement(this.id);
      box.backgroundColor = levelColor;
      // The level colour is a solid step; a hatched style (virtual nodes by default) would show mostly canvas.
      box.fillStyle = "solid";
    }

    if(view3D) {
      // No gates and no neighbour counts in 3D (§6-3): the links join the boxes (`Link.render()`), so the gate ids
      // stay unset. The level label is the only extra element and moves with the box.
      const labelId = this.renderLevelLabel(view3D.floor);
      ea.addToGroup([
        ...labelId ? [labelId] : [],
        ...this.isEmbedded
          ? this.embeddedElementIds
          : [this.id, ea.getElement(this.id).boundElements[0].id]
      ]);
      return;
    }

    applyEAStyle(ea, { fillStyle: this.style.gateFillStyle });
    applyEAStyle(ea, { strokeColor: this.style.gateStrokeColor });
    applyEAStyle(ea, { strokeStyle: "solid" });

    const previousFriendCount = this.friendGateOnLeft
      ? this.page.previousFriendCount()
      : this.page.nextFriendCount();
    const nextFriendCount = this.friendGateOnLeft
      ? this.page.nextFriendCount()
      : this.page.previousFriendCount();
    
    const leftFriendCount = this.page.leftFriendCount() + previousFriendCount;
    applyEAStyle(ea, {
      backgroundColor: leftFriendCount > 0 ? this.style.gateBackgroundColor : "transparent",
    });
    this.friendGateId = ea.addEllipse(
      this.friendGateOnLeft
        ? this.center.x - gateDiameter - this.style.padding - labelSize.width / 2
        : this.center.x + this.style.padding + labelSize.width / 2,
      this.center.y - this.style.gateRadius,
      gateDiameter,
      gateDiameter
    );

    const neighborCountLabelIds = [];
    if(settings.showNeighborCount && leftFriendCount>0) {
      applyEAStyle(ea, { fontSize: gateDiameter });
      neighborCountLabelIds.push(ea.addText(
        this.friendGateOnLeft
        ? leftFriendCount>9
          ? this.center.x - 2*gateDiameter - this.style.padding - labelSize.width / 2
          : this.center.x - gateDiameter - this.style.padding - labelSize.width / 2
        : this.center.x + this.style.padding + labelSize.width / 2,
        this.friendGateOnLeft
        ? this.center.y - 2*gateDiameter
        : this.center.y - this.style.gateRadius + gateDiameter,
        leftFriendCount.toString()
      ));
    }

    const rightFriendCount = this.page.rightFriendCount() + nextFriendCount;
    applyEAStyle(ea, {
      backgroundColor: rightFriendCount > 0 ? this.style.gateBackgroundColor : "transparent",
    });
    this.nextFriendGateId = ea.addEllipse(
      !this.friendGateOnLeft
        ? this.center.x - gateDiameter - this.style.padding - labelSize.width / 2
        : this.center.x + this.style.padding + labelSize.width / 2,
      this.center.y - this.style.gateRadius,
      gateDiameter,
      gateDiameter
    );

    if(settings.showNeighborCount && rightFriendCount>0) {
      applyEAStyle(ea, { fontSize: gateDiameter });
      neighborCountLabelIds.push(ea.addText(
        !this.friendGateOnLeft
        ? rightFriendCount>9
          ? this.center.x - 2*gateDiameter - this.style.padding - labelSize.width / 2
          : this.center.x - gateDiameter - this.style.padding - labelSize.width / 2
        : this.center.x + this.style.padding + labelSize.width / 2,
        !this.friendGateOnLeft
        ? this.center.y - 2*gateDiameter
        : this.center.y - this.style.gateRadius + gateDiameter,
        rightFriendCount.toString()
      ));
    }

    if(!this.isCentral) {
      this.nextFriendGateId = this.friendGateId;
    }

    const parentCount = this.page.parentCount()
    applyEAStyle(ea, {
      backgroundColor: parentCount > 0 ? this.style.gateBackgroundColor : "transparent",
    });
    this.parentGateId = ea.addEllipse(
      this.center.x - this.style.gateRadius - this.style.gateOffset,
      this.center.y - gateDiameter - this.style.padding - labelSize.height / 2,
      gateDiameter,
      gateDiameter
    );
    if(settings.showNeighborCount && parentCount>0) {
      applyEAStyle(ea, { fontSize: gateDiameter });
      neighborCountLabelIds.push(ea.addText(
        this.center.x + gateDiameter - this.style.gateOffset,
        this.center.y - gateDiameter - this.style.padding - labelSize.height / 2,
        parentCount.toString()
      ));
    }

    const childrenCount = this.page.childrenCount()
    applyEAStyle(ea, {
      backgroundColor: childrenCount > 0 ? this.style.gateBackgroundColor : "transparent",
    });
    this.childGateId = ea.addEllipse(
      this.center.x - this.style.gateRadius + this.style.gateOffset,
      this.center.y + this.style.padding + labelSize.height / 2,
      gateDiameter,
      gateDiameter
    );
    if(settings.showNeighborCount && childrenCount>0) {
      applyEAStyle(ea, { fontSize: gateDiameter });
      neighborCountLabelIds.push(ea.addText(
        this.center.x + gateDiameter + this.style.gateOffset,
        this.center.y + this.style.padding + labelSize.height / 2,
        childrenCount.toString()
      ));
    }
    
    ea.addToGroup([
      this.friendGateId,
      this.parentGateId,
      this.childGateId,
      ...this.nextFriendGateId !== this.friendGateId ? [this.nextFriendGateId] : [],
      ...neighborCountLabelIds,
      ...this.isEmbedded
        ? this.embeddedElementIds
        : [this.id, ea.getElement(this.id).boundElements[0].id]
    ]);
  }

  /** Index of the node's level from `floor`: 0 for the floor (L1). Only meaningful in 3D. */
  private levelIndex(floor: Level): number {
    return this.level - floor;
  }

  /** `settings.levelColors[level − floor]`, or undefined when the array has no entry for it (the node keeps its own colour). */
  private levelColor(floor: Level): string | undefined {
    return this.settings.levelColors[this.levelIndex(floor)];
  }

  /**
   * The "L{n}" label at the top right corner of the box, outside it (§6-3): right-aligned with the box, its bottom
   * at the box's top, `LEVEL_LABEL_FONT_SCALE` of the node's font. It sits on the canvas, not on the level colour,
   * so the node's text colour is checked against `settings.backgroundColor` (the central style's black text would
   * vanish on the default dark canvas). The box is read back from the element `id` points at (text box, frame or
   * image); a retained frame the user removed from the canvas has none, and then there is no label either.
   */
  private renderLevelLabel(floor: Level): string | undefined {
    const ea = this.ea;
    const box = ea.getElement(this.id);
    if(!box) return undefined;
    const text = `L${this.levelIndex(floor) + 1}`;
    applyEAStyle(ea, {
      fontSize: this.style.fontSize * LEVEL_LABEL_FONT_SCALE,
      fontFamily: this.style.fontFamily,
      strokeColor: readableTextColor(this.settings.backgroundColor, this.style.textColor),
    });
    const size = ea.measureText(text);
    return ea.addText(box.x + box.width - size.width, box.y - size.height, text);
  }

}