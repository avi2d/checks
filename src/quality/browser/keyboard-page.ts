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

export const scanRings = (el: PageElement): RingScan[] => {
  const ringKeys = [
    "outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "boxShadow",
    "borderTopWidth", "borderTopStyle", "borderTopColor",
    "borderRightWidth", "borderRightStyle", "borderRightColor",
    "borderBottomWidth", "borderBottomStyle", "borderBottomColor",
    "borderLeftWidth", "borderLeftStyle", "borderLeftColor",
    "backgroundColor", "backgroundImage",
  ] as const;
  const ringPaint = (painted: PageStyle): ReadonlyArray<string> => ringKeys.map((key) => key + "=" + painted[key]);
  const revealKeys = [
    "content", "opacity", "visibility", "display", "clipPath", "transform", "translate", "rotate", "scale",
    "position", "top", "right", "bottom", "left",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
  ] as const;
  const pseudoPaint = (painted: PageStyle): ReadonlyArray<string> => [...ringPaint(painted), ...revealKeys.map((key) => key + "=" + painted[key])];
  const view = el.ownerDocument.defaultView;
  const root = el.ownerDocument.documentElement;
  const holdsPlaced = (style: PageStyle): boolean =>
    style.position !== "static" ||
    [style.transform, style.translate, style.rotate, style.scale, style.perspective, style.filter, style.backdropFilter].some((value) => value !== "none") ||
    /layout|paint|strict|content/.test(style.contain) ||
    style.containerType !== "normal" ||
    /transform|perspective|filter/.test(style.willChange);
  const frameOf = (host: PageElement): Box => {
    let holder: PageElement | null = host;
    while (holder !== null && holder !== root && !holdsPlaced(view.getComputedStyle(holder))) holder = holder.parentElement;
    if (holder === null || holder === root) {
      return { x: -view.scrollX, y: -view.scrollY, width: root.clientWidth, height: root.clientHeight };
    }
    const rect = holder.getBoundingClientRect();
    if (holder.clientWidth === 0 && holder.clientHeight === 0 && (rect.width !== 0 || rect.height !== 0)) {
      const holderStyle = view.getComputedStyle(holder);
      const toPx = (token: string): number => {
        if (token === "thin") return 1;
        if (token === "medium") return 3;
        if (token === "thick") return 5;
        const parsed = parseFloat(token);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const borderLeft = toPx(holderStyle.borderLeftWidth);
      const borderTop = toPx(holderStyle.borderTopWidth);
      const borderRight = toPx(holderStyle.borderRightWidth);
      const borderBottom = toPx(holderStyle.borderBottomWidth);
      return { x: rect.x + borderLeft - holder.scrollLeft, y: rect.y + borderTop - holder.scrollTop, width: Math.max(0, rect.width - borderLeft - borderRight), height: Math.max(0, rect.height - borderTop - borderBottom) };
    }
    return { x: rect.x + holder.clientLeft - holder.scrollLeft, y: rect.y + holder.clientTop - holder.scrollTop, width: holder.clientWidth, height: holder.clientHeight };
  };
  const pseudoBox = (host: PageElement, painted: PageStyle, hostBox: Box): Box => {
    if (painted.position !== "absolute") return hostBox;
    const left = parseFloat(painted.left) + parseFloat(painted.marginLeft);
    const top = parseFloat(painted.top) + parseFloat(painted.marginTop);
    const right = parseFloat(painted.right) + parseFloat(painted.marginRight);
    const bottom = parseFloat(painted.bottom) + parseFloat(painted.marginBottom);
    if (![left, top, right, bottom].every((inset) => Number.isFinite(inset))) return hostBox;
    const frame = frameOf(host);
    return { x: frame.x + left, y: frame.y + top, width: frame.width - left - right, height: frame.height - top - bottom };
  };
  const ringOf = (painted: PageStyle, box: Box): Ring => ({
    box,
    outlineStyle: painted.outlineStyle,
    outlineWidth: painted.outlineWidth,
    outlineOffset: painted.outlineOffset,
    boxShadow: painted.boxShadow,
  });
  const nodes: RingScan[] = [];
  let current: PageElement | null = el;
  while (current !== null) {
    const rect = current.getBoundingClientRect();
    const box: Box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const self = view.getComputedStyle(current);
    const before = view.getComputedStyle(current, "::before");
    const after = view.getComputedStyle(current, "::after");
    const rings = [ringOf(self, box)];
    for (const pseudo of [before, after]) {
      if (pseudo.content !== "none" && pseudo.content !== "normal") rings.push(ringOf(pseudo, pseudoBox(current, pseudo, box)));
    }
    nodes.push({
      rings,
      paint: [...ringPaint(self), ...pseudoPaint(before).map((entry) => "before:" + entry), ...pseudoPaint(after).map((entry) => "after:" + entry)],
    });
    current = current.parentElement;
  }
  return nodes;
};

const RingSchema = Schema.Struct({
  box: BoxSchema,
  outlineStyle: Schema.String,
  outlineWidth: Schema.String,
  outlineOffset: Schema.String,
  boxShadow: Schema.String,
});

type Ring = typeof RingSchema.Type;

const RingScanSchema = Schema.Struct({
  rings: Schema.Array(RingSchema),
  paint: Schema.Array(Schema.String),
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
  const outline = ring.outlineStyle === "none" ? 0 : Math.max(0, (len(ring.outlineWidth) ?? 0) + (len(ring.outlineOffset) ?? 0));
  return Math.max(outline, shadowOut(ring.boxShadow));
};

export const union = (first: Box, second: Box): Box => ({
  x: Math.min(first.x, second.x),
  y: Math.min(first.y, second.y),
  width: Math.max(first.x + first.width, second.x + second.width) - Math.min(first.x, second.x),
  height: Math.max(first.y + first.height, second.y + second.height) - Math.min(first.y, second.y),
});

const grown = (box: Box, margin: number): Box => ({
  x: box.x - margin,
  y: box.y - margin,
  width: box.width + margin * 2,
  height: box.height + margin * 2,
});

export const reachOf = (scan: RingScan, from: Box): Box =>
  scan.rings.reduce((reach, ring) => union(reach, grown(ring.box, ringOut(ring))), from);

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

export type CropArgs = {
  readonly first: string;
  readonly second: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const CompareOutcomeSchema = Schema.Union([
  Schema.Struct({ compared: Schema.Literal(true), differs: Schema.Boolean }),
  Schema.Struct({ compared: Schema.Literal(false) }),
]);

type CompareOutcome = typeof CompareOutcomeSchema.Type;

export const compareCrops = (el: PageElement, args: CropArgs): Promise<CompareOutcome> => {
  const view = el.ownerDocument.defaultView;
  const scale = view.devicePixelRatio || 1;
  const left = Math.round(args.x * scale);
  const top = Math.round(args.y * scale);
  const width = Math.max(1, Math.round(args.width * scale));
  const height = Math.max(1, Math.round(args.height * scale));
  const unreadable: CompareOutcome = { compared: false };
  const changed: CompareOutcome = { compared: true, differs: true };
  const same: CompareOutcome = { compared: true, differs: false };
  const decode = (raw: string): Promise<PageBitmap> => {
    const binary = view.atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return view.createImageBitmap(new view.Blob([bytes], { type: "image/png" }));
  };
  const pixelsOf = (shot: PageBitmap): ArrayLike<number> | null => {
    const canvas = el.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(shot, left, top, width, height, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  return decode(args.first).then((first) => {
    const before = pixelsOf(first);
    first.close();
    if (before === null) return unreadable;
    return decode(args.second).then((second) => {
      const after = pixelsOf(second);
      second.close();
      if (after === null) return unreadable;
      if (before.length !== after.length) return changed;
      for (let index = 0; index < before.length; index += 1) {
        if (before[index] !== after[index]) return changed;
      }
      return same;
    });
  });
};

export const decodeOutcome = Schema.decodeUnknownEffect(CompareOutcomeSchema);

export const remember = (el: PageElement, id: string): void => {
  const view = el.ownerDocument.defaultView;
  if (view.checksKb === undefined) view.checksKb = new WeakMap();
  const seen = view.checksKb.get(el);
  view.checksKb.set(el, seen === undefined ? id : seen + " " + id);
};

export const recall = (el: PageElement): string => el.ownerDocument.defaultView.checksKb?.get(el) ?? "";

export const decodeRecall = Schema.decodeUnknownEffect(Schema.String);

export const blurs = (el: PageElement): void => {
  el.blur();
};

export type { Box, PageElement };
