import { Schema } from "effect";

const BoxSchema = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});

type Box = typeof BoxSchema.Type;

type PageStyle = {
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly outlineColor: string;
  readonly outlineOffset: string;
  readonly boxShadow: string;
  readonly borderTopWidth: string;
  readonly borderTopStyle: string;
  readonly borderTopColor: string;
  readonly borderRightWidth: string;
  readonly borderRightStyle: string;
  readonly borderRightColor: string;
  readonly borderBottomWidth: string;
  readonly borderBottomStyle: string;
  readonly borderBottomColor: string;
  readonly borderLeftWidth: string;
  readonly borderLeftStyle: string;
  readonly borderLeftColor: string;
  readonly backgroundColor: string;
  readonly backgroundImage: string;
  readonly content: string;
  readonly opacity: string;
  readonly visibility: string;
  readonly display: string;
  readonly clipPath: string;
  readonly position: string;
  readonly width: string;
  readonly height: string;
  readonly boxSizing: string;
  readonly direction: string;
  readonly paddingTop: string;
  readonly paddingRight: string;
  readonly paddingBottom: string;
  readonly paddingLeft: string;
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
  readonly marginTop: string;
  readonly marginRight: string;
  readonly marginBottom: string;
  readonly marginLeft: string;
  readonly transform: string;
  readonly translate: string;
  readonly rotate: string;
  readonly scale: string;
  readonly perspective: string;
  readonly filter: string;
  readonly backdropFilter: string;
  readonly contain: string;
  readonly containerType: string;
  readonly willChange: string;
};

type PageView = {
  readonly getComputedStyle: (node: PageElement, pseudo?: string) => PageStyle;
  readonly devicePixelRatio: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly atob: (data: string) => string;
  readonly createImageBitmap: (image: PageBlob) => Promise<PageBitmap>;
  readonly Blob: new (parts: ReadonlyArray<Uint8Array>, options: { readonly type: string }) => PageBlob;
  checksKb?: WeakMap<object, string>;
};

type PageDocument = {
  readonly defaultView: PageView;
  readonly documentElement: PageElement;
  readonly createElement: (tag: string) => PageCanvas;
};

type PageElement = {
  readonly parentElement: PageElement | null;
  readonly ownerDocument: PageDocument;
  readonly getBoundingClientRect: () => Box;
  readonly clientLeft: number;
  readonly clientTop: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly blur: () => void;
  readonly focus: (options: { readonly preventScroll: true }) => void;
};

type PageBitmap = { readonly close: () => void };

type PageBlob = { readonly size: number };

type PageContext = {
  readonly drawImage: (
    image: PageBitmap,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
  readonly getImageData: (x: number, y: number, width: number, height: number) => { readonly data: ArrayLike<number> };
};

type PageCanvas = {
  width: number;
  height: number;
  readonly getContext: (kind: string, options: { readonly willReadFrequently: boolean }) => PageContext | null;
};

const measurePseudoBox = (anchor: PageElement, pseudoStyle: PageStyle, hostBox: Box): Box => {
  if (pseudoStyle.position !== "absolute") return hostBox;
  const view = anchor.ownerDocument.defaultView;
  const root = anchor.ownerDocument.documentElement;
  const holdsPlaced = (style: PageStyle): boolean =>
    style.position !== "static" ||
    [style.transform, style.translate, style.rotate, style.scale, style.perspective, style.filter, style.backdropFilter].some((value) => value !== "none") ||
    /layout|paint|strict|content/.test(style.contain) ||
    style.containerType !== "normal" ||
    /transform|perspective|filter/.test(style.willChange);
  const cssPixels = (token: string): number => token.endsWith("px") ? parseFloat(token) : NaN;
  const pxOrZero = (token: string): number => cssPixels(token) || 0;
  const frameOf = (host: PageElement): Box => {
    let holder: PageElement | null = host;
    while (holder !== null && holder !== root && !holdsPlaced(view.getComputedStyle(holder))) holder = holder.parentElement;
    if (holder === null || holder === root) {
      return { x: -view.scrollX, y: -view.scrollY, width: root.clientWidth, height: root.clientHeight };
    }
    const rect = holder.getBoundingClientRect();
    if (holder.clientWidth === 0 && holder.clientHeight === 0 && (rect.width !== 0 || rect.height !== 0)) {
      const holderStyle = view.getComputedStyle(holder);
      const borderLeft = pxOrZero(holderStyle.borderLeftWidth);
      const borderTop = pxOrZero(holderStyle.borderTopWidth);
      const borderRight = pxOrZero(holderStyle.borderRightWidth);
      const borderBottom = pxOrZero(holderStyle.borderBottomWidth);
      return { x: rect.x + borderLeft - holder.scrollLeft, y: rect.y + borderTop - holder.scrollTop, width: Math.max(0, rect.width - borderLeft - borderRight), height: Math.max(0, rect.height - borderTop - borderBottom) };
    }
    return { x: rect.x + holder.clientLeft - holder.scrollLeft, y: rect.y + holder.clientTop - holder.scrollTop, width: holder.clientWidth, height: holder.clientHeight };
  };
  type Axis = { readonly start: number; readonly size: number };
  const insetAxis = (frameSize: number, start: number, end: number, size: number, fromEnd = false): Axis | null => {
    if (Number.isFinite(size)) {
      if (Number.isFinite(end) && (fromEnd || !Number.isFinite(start))) return { start: frameSize - end - size, size };
      if (Number.isFinite(start)) return { start, size };
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, size: Math.max(0, frameSize - start - end) };
  };
  const insetWithMargin = (inset: string, margin: string): number => cssPixels(inset) + pxOrZero(margin);
  const borderBoxSize = (style: PageStyle, size: string, edges: readonly string[]): number =>
    cssPixels(size) + (style.boxSizing === "border-box" ? 0 : edges.reduce((total, edge) => total + pxOrZero(edge), 0));
  const horizontalAxis = (style: PageStyle, frame: Box): Axis | null => insetAxis(
    frame.width,
    insetWithMargin(style.left, style.marginLeft),
    insetWithMargin(style.right, style.marginRight),
    borderBoxSize(style, style.width, [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]),
    style.direction === "rtl",
  );
  const verticalAxis = (style: PageStyle, frame: Box): Axis | null => insetAxis(
    frame.height,
    insetWithMargin(style.top, style.marginTop),
    insetWithMargin(style.bottom, style.marginBottom),
    borderBoxSize(style, style.height, [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]),
  );
  const frame = frameOf(anchor);
  const horizontal = horizontalAxis(pseudoStyle, frame);
  const vertical = verticalAxis(pseudoStyle, frame);
  return {
    x: horizontal === null ? hostBox.x : frame.x + horizontal.start,
    y: vertical === null ? hostBox.y : frame.y + vertical.start,
    width: horizontal?.size ?? hostBox.width,
    height: vertical?.size ?? hostBox.height,
  };
};

export const scanRings = (el: PageElement): RingScan[] => {
    const visibleColor = (color: string): boolean =>
    !(color.startsWith("rgba(") && color.endsWith(", 0)")) && !color.endsWith(" / 0)");
  const paintsEdge = (width: string, style: string, color: string): boolean =>
    style !== "none" && style !== "hidden" && parseFloat(width) > 0 && visibleColor(color);
  const edgePaint = (width: string, style: string, color: string): string =>
    paintsEdge(width, style, color) ? [width, style, color].join(" ") : "";
  const ringPaint = (style: PageStyle): ReadonlyArray<string> => [
    edgePaint(style.outlineWidth, style.outlineStyle, style.outlineColor) === ""
      ? "" : [style.outlineWidth, style.outlineStyle, style.outlineColor, style.outlineOffset].join(" "),
    edgePaint(style.borderTopWidth, style.borderTopStyle, style.borderTopColor),
    edgePaint(style.borderRightWidth, style.borderRightStyle, style.borderRightColor),
    edgePaint(style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor),
    edgePaint(style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor),
    style.boxShadow === "none" ? "" : style.boxShadow,
    visibleColor(style.backgroundColor) ? style.backgroundColor : "",
    style.backgroundImage === "none" ? "" : style.backgroundImage,
  ];
  const revealKeys = [
    "content", "opacity", "visibility", "display", "clipPath", "transform", "translate", "rotate", "scale",
    "position", "top", "right", "bottom", "left", "width", "height",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
  ] as const;
  const view = el.ownerDocument.defaultView;
  const ringOf = (style: PageStyle, box: Box, paint: ReadonlyArray<string>): Ring => ({
    box,
    outlineWidth: paintsEdge(style.outlineWidth, style.outlineStyle, style.outlineColor) ? style.outlineWidth : "0",
    outlineOffset: style.outlineOffset,
    boxShadow: style.boxShadow,
    paint,
  });
  const pseudoOf = (host: PageElement, pseudo: string, hostBox: Box): Ring | null => {
    const style = view.getComputedStyle(host, pseudo);
    if (["none", "normal"].includes(style.content) || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return null;
    const edgesAndFill = ringPaint(style);
    if (style.content === '""' && edgesAndFill.every((part) => part === "")) return null;
    return ringOf(style, measurePseudoBox(host, style, hostBox), [...edgesAndFill, ...revealKeys.map((key) => style[key])]);
  };
  const nodes: RingScan[] = [];
  let current: PageElement | null = el;
  while (current !== null) {
    const rect = current.getBoundingClientRect();
    const box: Box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const self = view.getComputedStyle(current);
    nodes.push({
      element: ringOf(self, box, ringPaint(self)),
      before: pseudoOf(current, "::before", box),
      after: pseudoOf(current, "::after", box),
    });
    current = current.parentElement;
  }
  return nodes;
};

const RingSchema = Schema.Struct({
  box: BoxSchema,
  outlineWidth: Schema.String,
  outlineOffset: Schema.String,
  boxShadow: Schema.String,
  paint: Schema.Array(Schema.String),
});

type Ring = typeof RingSchema.Type;

const RingScanSchema = Schema.Struct({
  element: RingSchema,
  before: Schema.NullOr(RingSchema),
  after: Schema.NullOr(RingSchema),
});

type RingScan = typeof RingScanSchema.Type;

const NAMED_WIDTHS: Readonly<Record<string, number>> = { thin: 1, medium: 3, thick: 5, "0": 0 };

const len = (token: string | undefined): number | undefined => {
  if (token === undefined) return undefined;
  const named = NAMED_WIDTHS[token];
  if (named !== undefined) return named;
  const made = /^(-?[\d.]+)px$/.exec(token);
  if (made === null) return undefined;
  const whole = made[1];
  if (whole === undefined) return undefined;
  const parsed = parseFloat(whole);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const splitTopLevel = (value: string, separators: ReadonlyArray<string>): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (separators.includes(ch) && depth === 0) {
      parts.push(part);
      part = "";
    } else {
      part += ch;
    }
  }
  parts.push(part);
  return parts;
};

const shadowExtent = (item: string): number => {
  const tokens = splitTopLevel(item, [" ", ",", "\t"]).filter((token) => token !== "");
  if (tokens.includes("inset")) return 0;
  const made = tokens.map(len).filter((parsed) => parsed !== undefined);
  const horizontal = made[0] ?? 0;
  const vertical = made[1] ?? 0;
  const blur = Math.max(0, made[2] ?? 0);
  const spread = made[3] ?? 0;
  return Math.max(0, horizontal + blur + spread, -horizontal + blur + spread, vertical + blur + spread, -vertical + blur + spread);
};

const shadowOut = (value: string): number => {
  if (value === "" || value === "none") return 0;
  return splitTopLevel(value, [","]).reduce((extent, item) => Math.max(extent, shadowExtent(item)), 0);
};

const ringOut = (ring: Ring): number => {
  const width = len(ring.outlineWidth) ?? 0;
  const outline = width > 0 ? width + (len(ring.outlineOffset) ?? 0) : 0;
  return Math.max(outline, shadowOut(ring.boxShadow));
};

const grown = (box: Box, margin: number): Box => ({
  x: box.x - margin,
  y: box.y - margin,
  width: box.width + margin * 2,
  height: box.height + margin * 2,
});

const changedRingBoxes = (focused: Ring | null, blurred: Ring | null): readonly Box[] => {
  if (focused?.paint.join("\n") === blurred?.paint.join("\n")) return [];
  return [focused, blurred].flatMap((ring) => ring === null ? [] : [grown(ring.box, ringOut(ring))]);
};

export const changedPaintBoxes = (focused: RingScan, blurred: RingScan): readonly Box[] => [
  ...changedRingBoxes(focused.element, blurred.element),
  ...changedRingBoxes(focused.before, blurred.before),
  ...changedRingBoxes(focused.after, blurred.after),
];

export const decodeRingScans = Schema.decodeUnknownEffect(Schema.Array(RingScanSchema));

export const RESOLVE_LEAF = `(() => {
  let leaf = null;
  let scope = document;
  while (scope.activeElement !== null && scope.activeElement !== leaf) {
    leaf = scope.activeElement;
    const inner = leaf.shadowRoot;
    if (inner === undefined || inner === null) return leaf;
    scope = inner;
  }
  return leaf;
})()`;

export const remember = (el: PageElement, id: string): void => {
  const view = el.ownerDocument.defaultView;
  if (view.checksKb === undefined) view.checksKb = new WeakMap();
  const seen = view.checksKb.get(el);
  view.checksKb.set(el, seen === undefined ? id : seen + " " + id);
};

export const recall = (el: PageElement): string => el.ownerDocument.defaultView.checksKb?.get(el) ?? "";

export const decodeRecall = Schema.decodeUnknownEffect(Schema.String);

export type { Box, PageBitmap, PageElement, PageView };
