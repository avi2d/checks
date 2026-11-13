import { Effect, Schema } from "effect";
import type { Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import { attempt, BrowserFailure } from "./page.ts";
import { decodePng, type Picture } from "./png.ts";

const LARGE_TEXT_PX = 24;
const LARGE_TEXT_NEEDS = 3;
const BODY_TEXT_NEEDS = 4.5;
const LABEL_CHARS = 48;
const GLYPH_COLOR = "rgb(0, 255, 0)";
const GLYPH_CHANNEL_SUM = 90;
const RING_PX = 2;
const LETTER_SHARE = 0.95;
const RING_SHARE = 0.05;

const TextBox = Schema.Struct({
  target: Schema.String,
  text: Schema.String,
  sizePx: Schema.Finite,
  box: Schema.Int,
  left: Schema.Int,
  top: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
});

export type TextBox = typeof TextBox.Type;

const decodeTextBoxes = Schema.decodeUnknownEffect(Schema.Array(TextBox));

export type Reading = {
  readonly target: string;
  readonly text: string;
  readonly box: number;
  readonly needs: number;
  readonly ratio: number | null;
};

const ENTRANCE_LIMIT_MS = 10_000;

// An entrance plays out before the text is read, since a reading mid-fade measures the fade, and a loop or a scroll-driven animation never ends, so it is paused where it stands.
const SETTLED = `Promise.race([
  Promise.all(
    Array.from(document.images).filter((image) => {
      for (const rect of image.getClientRects()) {
        if (rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) return true;
      }
      return false;
    }).map((image) => image.decode().catch(() => undefined)),
  ).then(() => Promise.all(document.getAnimations().filter((animation) => animation.playState !== "paused" && animation.timeline === document.timeline && animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined)))),
  new Promise((resolve) => setTimeout(resolve, ${ENTRANCE_LIMIT_MS})),
]).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))))`;

const TEXT_BOXES = `(targets) => {
  for (const animation of document.getAnimations()) animation.pause();
  const pixels = window.devicePixelRatio || 1;
  const shown = (el) => {
    const visibility = getComputedStyle(el).visibility;
    if (visibility === "hidden" || visibility === "collapse") return false;
    for (let at = el; at; at = at.parentElement) {
      if (getComputedStyle(at).display === "none") return false;
    }
    return true;
  };
  const boxes = [];
  for (const target of targets) {
    for (const element of document.querySelectorAll(target.selector)) {
      const text = (element.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, ${LABEL_CHARS});
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      let box = 0;
      for (const node of nodes) {
        if ((node.textContent ?? "").trim() === "") continue;
        const owner = node.parentElement;
        if (owner === null || !shown(owner)) continue;
        const sizePx = parseFloat(getComputedStyle(owner).fontSize) || parseFloat(getComputedStyle(element).fontSize);
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (Math.min(innerWidth, rect.right) - Math.max(0, rect.left) <= 0) continue;
          if (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top) <= 0) continue;
          const left = Math.floor(Math.max(0, rect.left));
          const top = Math.floor(Math.max(0, rect.top));
          const right = Math.ceil(Math.min(innerWidth, rect.right));
          const bottom = Math.ceil(Math.min(innerHeight, rect.bottom));
          box += 1;
          boxes.push({
            target: target.name,
            text,
            sizePx,
            box,
            left: Math.round(left * pixels),
            top: Math.round(top * pixels),
            width: Math.round((right - left) * pixels),
            height: Math.round((bottom - top) * pixels),
          });
        }
      }
    }
  }
  return boxes;
}`;

// A transition on color would catch the paint halfway, and shadows stay painted, so a halo behind the letters counts as their backdrop.
const PAINT = `({ selectors, color }) => {
  const paintedAll = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      paintedAll.push(element, ...element.querySelectorAll("*"));
    }
  }
  const shadows = paintedAll.map((painted) => getComputedStyle(painted).textShadow);
  const colors = paintedAll.map((painted) => getComputedStyle(painted).backgroundColor);
  const images = paintedAll.map((painted) => getComputedStyle(painted).backgroundImage);
  const boxes = paintedAll.map((painted) => getComputedStyle(painted).boxShadow);
  const borders = paintedAll.map((painted) => [getComputedStyle(painted).borderTopColor, getComputedStyle(painted).borderRightColor, getComputedStyle(painted).borderBottomColor, getComputedStyle(painted).borderLeftColor]);
  const outlines = paintedAll.map((painted) => getComputedStyle(painted).outlineColor);
  const decorations = paintedAll.map((painted) => getComputedStyle(painted).textDecorationColor);
  const rules = paintedAll.map((painted) => getComputedStyle(painted).columnRuleColor);
  paintedAll.forEach((painted, at) => {
    if (shadows[at] !== "none") painted.style.setProperty("text-shadow", shadows[at], "important");
    painted.style.setProperty("background-color", colors[at], "important");
    if (images[at] !== "none") painted.style.setProperty("background-image", images[at], "important");
    if (boxes[at] !== "none") painted.style.setProperty("box-shadow", boxes[at], "important");
    painted.style.setProperty("border-top-color", borders[at][0], "important");
    painted.style.setProperty("border-right-color", borders[at][1], "important");
    painted.style.setProperty("border-bottom-color", borders[at][2], "important");
    painted.style.setProperty("border-left-color", borders[at][3], "important");
    painted.style.setProperty("outline-color", outlines[at], "important");
    painted.style.setProperty("text-decoration-color", decorations[at], "important");
    painted.style.setProperty("column-rule-color", rules[at], "important");
  });
  for (const painted of paintedAll) {
    painted.style.setProperty("transition", "none", "important");
    painted.style.setProperty("color", color, "important");
  }
}`;

const channel = (value: number): number => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);

const luminanceAt = ({ rgb }: Picture, pixel: number): number =>
  0.2126 * channel(rgb[pixel * 3] ?? 0) + 0.7152 * channel(rgb[pixel * 3 + 1] ?? 0) + 0.0722 * channel(rgb[pixel * 3 + 2] ?? 0);

const ratioOf = (one: number, other: number): number => (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);

const share = (sorted: readonly number[], part: number): number => sorted[Math.floor((sorted.length - 1) * part)] ?? 0;

const ascending = (values: readonly number[]): readonly number[] => values.toSorted((a, b) => a - b);

export const needsOf = (sizePx: number): number => (sizePx >= LARGE_TEXT_PX ? LARGE_TEXT_NEEDS : BODY_TEXT_NEEDS);

type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

const clipped = (box: TextBox, { width, height }: Picture): Box => ({
  left: Math.max(0, box.left),
  top: Math.max(0, box.top),
  right: Math.min(width, box.left + box.width),
  bottom: Math.min(height, box.top + box.height),
});

function glyphMask(drawn: Picture, glyphs: Picture, backdrop: Picture, box: Box): ReadonlySet<number> {
  const mask = new Set<number>();
  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      const pixel = y * glyphs.width + x;
      let marked = 0;
      let painted = 0;
      for (let at = 0; at < 3; at += 1) {
        marked += Math.abs((glyphs.rgb[pixel * 3 + at] ?? 0) - (backdrop.rgb[pixel * 3 + at] ?? 0));
        painted += Math.abs((drawn.rgb[pixel * 3 + at] ?? 0) - (backdrop.rgb[pixel * 3 + at] ?? 0));
      }
      if (marked > GLYPH_CHANNEL_SUM || painted > GLYPH_CHANNEL_SUM) mask.add(pixel);
    }
  }
  return mask;
}

function nearGlyph(mask: ReadonlySet<number>, width: number, box: Box, x: number, y: number): boolean {
  for (let dy = -RING_PX; dy <= RING_PX; dy += 1) {
    for (let dx = -RING_PX; dx <= RING_PX; dx += 1) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx >= box.left && nx < box.right && ny >= box.top && ny < box.bottom && mask.has(ny * width + nx)) return true;
    }
  }
  return false;
}

export type Shots = { readonly drawn: Picture; readonly glyphs: Picture; readonly backdrop: Picture };

// The letters' extreme away from the backdrop stands for their colour, and the ring's low share for the stretch of backdrop nearest it.
export function readBox({ drawn, glyphs, backdrop }: Shots, textBox: TextBox): Reading {
  const box = clipped(textBox, drawn);
  const mask = glyphMask(drawn, glyphs, backdrop, box);
  const letters: number[] = [];
  const ring: number[] = [];
  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      const pixel = y * drawn.width + x;
      if (mask.has(pixel)) letters.push(luminanceAt(drawn, pixel));
      else if (nearGlyph(mask, drawn.width, box, x, y)) ring.push(luminanceAt(backdrop, pixel));
    }
  }
  const reading = { target: textBox.target, text: textBox.text, box: textBox.box, needs: needsOf(textBox.sizePx) };
  if (letters.length === 0 || ring.length === 0) return { ...reading, ratio: null };
  const [lit, around] = [ascending(letters), ascending(ring)];
  const text = share(lit, 0.5) >= share(around, 0.5) ? share(lit, LETTER_SHARE) : share(lit, 1 - LETTER_SHARE);
  return { ...reading, ratio: share(ascending(around.map((back) => ratioOf(text, back))), RING_SHARE) };
}

const shot = Effect.fn("shot")(function* (page: Page, doing: string) {
  const png = yield* attempt(`cannot capture the page ${doing}`, () => page.screenshot());
  return yield* decodePng(png).pipe(Effect.mapError(({ message }) => new BrowserFailure({ message: `the capture ${doing} does not decode: ${message}` })));
});

const paint = (page: Page, selectors: readonly string[], color: string) =>
  attempt(`cannot paint the text ${color}`, () => page.evaluate(`(${PAINT})(${JSON.stringify({ selectors, color })})`));

const textBoxesOn = Effect.fn("textBoxesOn")(function* (page: Page, targets: readonly Target[]) {
  const named = targets.map(({ name, selector }) => ({ name, selector }));
  const boxes: unknown = yield* attempt("cannot find the boxes of text", () => page.evaluate(`(${TEXT_BOXES})(${JSON.stringify(named)})`));
  return yield* decodeTextBoxes(boxes).pipe(Effect.mapError(() => new BrowserFailure({ message: "the page gave text boxes that do not decode" })));
});

type ContrastReport = {
  readonly found: readonly string[];
  readonly inventory: readonly string[];
};

export function verdicts(targets: readonly Target[], readings: readonly Reading[]): ContrastReport {
  const found: string[] = [];
  const inventory: string[] = [];
  for (const { name, selector } of targets) {
    const read = readings.filter(({ target }) => target === name);
    const ratios = read.flatMap(({ ratio }) => (ratio === null ? [] : [ratio]));
    const lowest = ratios.length === 0 ? "" : `, lowest ${Math.min(...ratios).toFixed(2)}:1`;
    inventory.push(`${name} ${read.length} text box(es)${lowest}`);
    if (read.length === 0) found.push(`${name} (${selector}) shows no text on screen to measure`);
    for (const { text, box, needs, ratio } of read) {
      if (ratio === null) found.push(`${name} "${text}" box ${box} draws no glyph to measure`);
      else if (ratio < needs) found.push(`${name} "${text}" box ${box} reads at ${ratio.toFixed(2)}:1, needs ${needs}:1`);
    }
  }
  return { found, inventory };
}

export const judgeContrast = Effect.fn("judgeContrast")(function* (page: Page, targets: readonly Target[]) {
  if (targets.length === 0) return { found: [], inventory: [] } satisfies ContrastReport;
  yield* attempt("the page never settles to be read", () => page.evaluate(SETTLED));
  const boxes = yield* textBoxesOn(page, targets);
  const selectors = targets.map(({ selector }) => selector);
  const drawn = yield* shot(page, "as drawn");
  yield* paint(page, selectors, GLYPH_COLOR);
  const glyphs = yield* shot(page, "with its text painted");
  yield* paint(page, selectors, "transparent");
  const backdrop = yield* shot(page, "with its text cleared");
  return verdicts(targets, boxes.map((box) => readBox({ drawn, glyphs, backdrop }, box)));
});
