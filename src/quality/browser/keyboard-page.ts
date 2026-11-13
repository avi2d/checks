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
};

type PageView = {
  readonly getComputedStyle: (node: PageElement, pseudo?: string) => PageStyle;
  readonly devicePixelRatio: number;
  readonly atob: (data: string) => string;
  readonly createImageBitmap: (image: PageBlob) => Promise<PageBitmap>;
  readonly Blob: new (parts: ReadonlyArray<Uint8Array>, options: { readonly type: string }) => PageBlob;
  checksKb?: WeakMap<object, string>;
};

type PageDocument = {
  readonly defaultView: PageView;
  readonly createElement: (tag: string) => PageCanvas;
};

type PageElement = {
  readonly parentElement: PageElement | null;
  readonly ownerDocument: PageDocument;
  readonly getBoundingClientRect: () => Box;
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
  const namedWidths: Record<string, number> = { thin: 1, medium: 3, thick: 5, "0": 0 };
  const ringKeys = [
    "outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "boxShadow",
    "borderTopWidth", "borderTopStyle", "borderTopColor",
    "borderRightWidth", "borderRightStyle", "borderRightColor",
    "borderBottomWidth", "borderBottomStyle", "borderBottomColor",
    "borderLeftWidth", "borderLeftStyle", "borderLeftColor",
    "backgroundColor", "backgroundImage",
  ] as const;
  const len = (token: string | undefined): number | undefined => {
    if (token === undefined) return undefined;
    const named = namedWidths[token];
    if (named !== undefined) return named;
    const made = /^(-?[\d.]+)px$/.exec(token);
    if (made === null) return undefined;
    const whole = made[1];
    if (whole === undefined) return undefined;
    const parsed = parseFloat(whole);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const splitTokens = (value: string): string[] => {
    const tokens: string[] = [];
    let depth = 0;
    let token = "";
    for (const ch of value) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if ((ch === " " || ch === "," || ch === "\t") && depth === 0) {
        if (token !== "") {
          tokens.push(token);
          token = "";
        }
      } else {
        token += ch;
      }
    }
    if (token !== "") tokens.push(token);
    return tokens;
  };
  const splitShadows = (value: string): string[] => {
    const shadows: string[] = [];
    let depth = 0;
    let part = "";
    for (const ch of value) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        shadows.push(part);
        part = "";
      } else {
        part += ch;
      }
    }
    shadows.push(part);
    return shadows;
  };
  const shadowExtent = (item: string): number => {
    const tokens = splitTokens(item);
    if (tokens.indexOf("inset") !== -1) return 0;
    const made: number[] = [];
    for (const token of tokens) {
      const parsed = len(token);
      if (parsed !== undefined) made.push(parsed);
    }
    const horizontal = made[0] ?? 0;
    const vertical = made[1] ?? 0;
    const blur = Math.max(0, made[2] ?? 0);
    const spread = made[3] ?? 0;
    return Math.max(0, horizontal + blur + spread, -horizontal + blur + spread, vertical + blur + spread, -vertical + blur + spread);
  };
  const shadowOut = (value: string): number => {
    if (value === "" || value === "none") return 0;
    return splitShadows(value).reduce((extent, item) => Math.max(extent, shadowExtent(item)), 0);
  };
  const ringOut = (painted: PageStyle): number => {
    const outline = painted.outlineStyle === "none" ? 0 : Math.max(0, (len(painted.outlineWidth) ?? 0) + (len(painted.outlineOffset) ?? 0));
    return Math.max(outline, shadowOut(painted.boxShadow));
  };
  const ringPaint = (painted: PageStyle): ReadonlyArray<string> => ringKeys.map((key) => key + "=" + painted[key]);
  const view = el.ownerDocument.defaultView;
  const nodes: RingScan[] = [];
  let current: PageElement | null = el;
  while (current !== null) {
    const rect = current.getBoundingClientRect();
    const self = view.getComputedStyle(current);
    const before = view.getComputedStyle(current, "::before");
    const after = view.getComputedStyle(current, "::after");
    let grow = ringOut(self);
    if (before.content !== "none" && before.content !== "normal") grow = Math.max(grow, ringOut(before));
    if (after.content !== "none" && after.content !== "normal") grow = Math.max(grow, ringOut(after));
    nodes.push({
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      paint: [...ringPaint(self), ...ringPaint(before).map((entry) => "before:" + entry), ...ringPaint(after).map((entry) => "after:" + entry)],
      grow,
    });
    current = current.parentElement;
  }
  return nodes;
};

const RingScanSchema = Schema.Struct({
  box: BoxSchema,
  paint: Schema.Array(Schema.String),
  grow: Schema.Finite,
});

type RingScan = typeof RingScanSchema.Type;

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
