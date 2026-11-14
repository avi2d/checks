import { Effect } from "effect";
import type { CDPSession } from "playwright-core";
import type { Target } from "./declaration.ts";
import { callOn, evaluate, isWithin, lineRects, nodeAt, overlapArea, querySelectorAll, readDom, viewportOf, type Dom, type Rect, type Viewport } from "./dom.ts";
import { attempt } from "./page.ts";

const EDGE_TOLERANCE_PX = 0.5;
const OVERLAP_TOLERANCE_PX2 = 1;
const LABEL_CHARS = 48;

type Scanned = {
  readonly name: string;
  readonly text: string;
  readonly lines: number;
};

type LayoutReport = {
  readonly found: readonly string[];
  readonly scanned: readonly Scanned[];
  readonly parked: readonly string[];
};

type Resolved = {
  readonly id: number;
  readonly name: string;
  readonly text: string;
};

function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function label(element: Resolved): string {
  return `${element.name} "${element.text.slice(0, LABEL_CHARS)}"`;
}

const textOf = Effect.fn("textOf")(function* (dom: Dom, id: number) {
  const text = yield* callOn(dom, id, "function () { return this.textContent ?? ''; }");
  return typeof text === "string" ? normaliseText(text) : "";
});

const IS_VISIBLE = `function () {
  const box = this.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && this.checkVisibility({ visibilityProperty: true });
}`;

const IS_PARKED = `function () {
  const box = this.getBoundingClientRect();
  return box.right + scrollX <= 0 || box.bottom + scrollY <= 0 || box.width <= 1 || box.height <= 1;
}`;

const parkedUntilFocused = Effect.fn("parkedUntilFocused")(function* (dom: Dom, id: number) {
  if ((yield* callOn(dom, id, IS_PARKED)) !== true) return false;
  yield* callOn(dom, id, "function () { this.focus(); }");
  const parkedWhenFocused = yield* callOn(dom, id, IS_PARKED);
  yield* evaluate(dom.cdp, "document.activeElement?.blur()");
  return parkedWhenFocused !== true;
});

const resolveTargets = Effect.fn("resolveTargets")(function* (dom: Dom, targets: readonly Target[]) {
  const resolved = new Map<number, Resolved>();
  const parked: string[] = [];
  for (const target of targets) {
    for (const id of yield* querySelectorAll(dom, target.selector)) {
      if (resolved.has(id) || (yield* callOn(dom, id, IS_VISIBLE)) !== true) continue;
      if (target.focusable === true && (yield* parkedUntilFocused(dom, id))) {
        parked.push(target.name);
        continue;
      }
      resolved.set(id, { id, name: target.name, text: yield* textOf(dom, id) });
    }
  }
  return { elements: [...resolved.values()], parked };
});

const findOverlaps = Effect.fn("findOverlaps")(function* (dom: Dom, elements: readonly Resolved[], found: string[]) {
  const boxes = yield* Effect.forEach(elements, (element) => lineRects(dom, element.id).pipe(Effect.map((rects) => ({ element, rects }))));
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      if (isWithin(dom, a.element.id, b.element.id) || isWithin(dom, b.element.id, a.element.id)) continue;
      const area = a.rects.reduce((sum, ra) => sum + b.rects.reduce((inner, rb) => inner + overlapArea(ra, rb), 0), 0);
      if (area > OVERLAP_TOLERANCE_PX2) found.push(`${label(a.element)} overlaps ${label(b.element)} by ${area.toFixed(0)}px²`);
    }
  }
});

function probePoints(rect: Rect, viewport: Viewport): readonly (readonly [number, number])[] {
  const y = (Math.max(rect.top, 0) + Math.min(rect.bottom, viewport.height)) / 2;
  const inset = Math.min(2, (rect.right - rect.left) / 2);
  return [
    [rect.left + inset, y],
    [(rect.left + rect.right) / 2, y],
    [rect.right - inset, y],
  ];
}

const judgeLine = Effect.fn("judgeLine")(function* (dom: Dom, viewport: Viewport, element: Resolved, rect: Rect) {
  if (rect.left < -EDGE_TOLERANCE_PX || rect.right > viewport.width + EDGE_TOLERANCE_PX) {
    return [`${label(element)} spans ${rect.left.toFixed(0)} to ${rect.right.toFixed(0)}px, past the ${viewport.width}px viewport`];
  }
  for (const [x, y] of probePoints(rect, viewport)) {
    if (y < 0 || y >= viewport.height) continue;
    const hit = yield* nodeAt(dom, viewport, x, y);
    if (!isWithin(dom, hit, element.id)) return [`${label(element)} is covered or clipped at ${x.toFixed(0)},${y.toFixed(0)}`];
  }
  return [];
});

const CLIPS_ITS_OWN_TEXT = `function () {
  if (getComputedStyle(this).display === "inline") return false;
  const clips = (o) => o !== "visible";
  const style = getComputedStyle(this);
  const x = clips(style.overflowX);
  const y = clips(style.overflowY);
  if (!x && !y) return false;
  const box = this.getBoundingClientRect();
  const sx = this.offsetWidth ? box.width / this.offsetWidth : 1;
  const sy = this.offsetHeight ? box.height / this.offsetHeight : 1;
  const num = (v) => parseFloat(v) || 0;
  const cb = (s, fx) => {
    if (!fx && s.position !== "static") return true;
    if (s.transform !== "none") return true;
    if (s.perspective !== "none") return true;
    if (s.filter !== "none") return true;
    if (s.backdropFilter !== "none") return true;
    if (s.translate !== "none") return true;
    if (s.rotate !== "none") return true;
    if (s.scale !== "none") return true;
    const cn = s.contain || "";
    if (cn.indexOf("paint") !== -1 || cn.indexOf("layout") !== -1 || cn === "strict" || cn === "content") return true;
    const wc = s.willChange || "";
    if (wc.indexOf("transform") !== -1 || wc.indexOf("perspective") !== -1 || wc.indexOf("filter") !== -1 || wc.indexOf("translate") !== -1 || wc.indexOf("rotate") !== -1 || wc.indexOf("scale") !== -1 || wc.indexOf("contain") !== -1) return true;
    if ((s.containerType || "").indexOf("size") !== -1) return true;
    return false;
  };
  const padLeft = box.left + num(style.borderLeftWidth) * sx;
  const padTop = box.top + num(style.borderTopWidth) * sy;
  const padRight = box.left + box.width - num(style.borderRightWidth) * sx;
  const padBottom = box.top + box.height - num(style.borderBottomWidth) * sy;
  const flatParent = (n) => {
    if (n instanceof ShadowRoot) return n.host;
    if (n.assignedSlot) return n.assignedSlot;
    return n.parentNode;
  };
  const texts = [];
  const stack = [this];
  while (stack.length > 0) {
    const cur = stack.pop();
    const tw = document.createTreeWalker(cur, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n !== null; n = tw.nextNode()) texts.push(n);
    if (cur instanceof Element && cur.shadowRoot) stack.push(cur.shadowRoot);
    const ew = document.createTreeWalker(cur, NodeFilter.SHOW_ELEMENT);
    for (let e = ew.nextNode(); e !== null; e = ew.nextNode()) {
      if (e.shadowRoot) stack.push(e.shadowRoot);
    }
  }
  for (const node of texts) {
    if (!node.textContent || node.textContent.trim() === "") continue;
    const raw = getComputedStyle(node.parentElement ?? this).lineHeight;
    const line = raw === "normal" ? NaN : parseFloat(raw);
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      let l = rect.left;
      let r = rect.right;
      let t = rect.top;
      let b = rect.bottom;
      if (!Number.isNaN(line)) {
        const h = Math.min(rect.height, line * sy);
        const mid = (rect.top + rect.bottom) / 2;
        t = mid - h / 2;
        b = mid + h / 2;
      }
      let at = flatParent(node);
      let empty = false;
      let absSeek = false;
      let fixSeek = false;
      while (at !== null && at !== this) {
        if (at instanceof ShadowRoot) {
          at = at.host;
          continue;
        }
        if (!(at instanceof Element)) {
          at = flatParent(at);
          continue;
        }
        const s = getComputedStyle(at);
        if (s.display === "contents") {
          at = flatParent(at);
          continue;
        }
        const pp = s.position;
        if (fixSeek) {
          if (cb(s, true)) fixSeek = false;
        } else if (absSeek) {
          if (cb(s, false)) absSeek = false;
        }
        if (!fixSeek && !absSeek) {
          const cp = s.clipPath;
          if (cp && cp !== "none") { empty = true; break; }
          const cc = s.clip;
          if (cc && cc !== "auto") {
            if (cc.indexOf("rect(") === 0) {
              const parts = cc.slice(cc.indexOf("(") + 1, cc.lastIndexOf(")")).split(",").flatMap((p) => p.trim().split(" ").filter((v) => v !== ""));
              const nv = parts.map((p) => parseFloat(p));
              if (nv.length < 4 || nv.some((v) => Number.isNaN(v))) { empty = true; break; }
              const q = at.getBoundingClientRect();
              const ex = at.offsetWidth ? q.width / at.offsetWidth : 1;
              const ey = at.offsetHeight ? q.height / at.offsetHeight : 1;
              if (l < q.left + nv[3] * ex) l = q.left + nv[3] * ex;
              if (t < q.top + nv[0] * ey) t = q.top + nv[0] * ey;
              if (r > q.left + nv[1] * ex) r = q.left + nv[1] * ex;
              if (b > q.top + nv[2] * ey) b = q.top + nv[2] * ey;
              if (r <= l || b <= t) { empty = true; break; }
            } else { empty = true; break; }
          }
          const cx = s.overflowX !== "visible";
          const cy = s.overflowY !== "visible";
          if (cx || cy) {
            const q = at.getBoundingClientRect();
            const ex = at.offsetWidth ? q.width / at.offsetWidth : 1;
            const ey = at.offsetHeight ? q.height / at.offsetHeight : 1;
            if (cx) {
              const pl = q.left + num(s.borderLeftWidth) * ex;
              const pr = q.left + q.width - num(s.borderRightWidth) * ex;
              if (l < pl) l = pl;
              if (r > pr) r = pr;
              if (r <= l) { empty = true; break; }
            }
            if (cy) {
              const pt = q.top + num(s.borderTopWidth) * ey;
              const pb = q.top + q.height - num(s.borderBottomWidth) * ey;
              if (t < pt) t = pt;
              if (b > pb) b = pb;
              if (b <= t) { empty = true; break; }
            }
          }
        }
        if (pp === "fixed") { fixSeek = true; absSeek = false; }
        else if (pp === "absolute" && !fixSeek && !absSeek) absSeek = true;
        at = flatParent(at);
      }
      if (empty) continue;
      if (absSeek || fixSeek) {
        const isCB = fixSeek ? cb(style, true) : cb(style, false);
        if (!isCB) continue;
      }
      const ti = parseFloat(getComputedStyle(node.parentElement ?? this).textIndent) || 0;
      if (ti < 0 && (r < padLeft - ${EDGE_TOLERANCE_PX} || l > padRight + ${EDGE_TOLERANCE_PX} || b < padTop - ${EDGE_TOLERANCE_PX} || t > padBottom + ${EDGE_TOLERANCE_PX})) continue;
      if (
        (x && (l < padLeft - ${EDGE_TOLERANCE_PX} || r > padRight + ${EDGE_TOLERANCE_PX})) ||
        (y && (t < padTop - ${EDGE_TOLERANCE_PX} || b > padBottom + ${EDGE_TOLERANCE_PX}))
      ) return true;
    }
  }
  return false;
}`;

const FIRST_UNSHOWN_TEXT = `function () {
  const alphaOf = (color) => {
    const afterSlash = /\\/\\s*([^\\s)]+)\\s*\\)$/.exec(color);
    if (afterSlash !== null) return parseFloat(afterSlash[1]);
    const components = color.slice(color.indexOf("(") + 1, -1).split(",");
    return components.length === 4 ? parseFloat(components[3]) : 1;
  };
  const unrendered = (element) =>
    element.tagName === "TEXTAREA" ||
    element.closest("svg title, svg desc") !== null ||
    (!element.checkVisibility() && getComputedStyle(element).display !== "contents");
  if (unrendered(this)) return null;
  const walker = document.createTreeWalker(this, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, (node) => {
    if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
    return unrendered(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text === "") continue;
    const parent = node.parentElement;
    const style = getComputedStyle(parent);
    let boxed = parent;
    while (getComputedStyle(boxed).display === "contents" && boxed.parentElement !== null) boxed = boxed.parentElement;
    const range = document.createRange();
    range.selectNodeContents(node);
    const drawn = Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    const shown =
      drawn &&
      parseFloat(style.fontSize) > 0 &&
      style.visibility === "visible" &&
      boxed.checkVisibility({ checkOpacity: true }) &&
      alphaOf(style.color) !== 0;
    if (!shown) return text;
  }
  return null;
}`;

const CUT_OFF_BY_UNSCROLLABLE = `function () {
  const unscrollable = (overflow) => overflow === "hidden" || overflow === "clip";
  const clippers = [];
  for (let at = this.parentElement; at !== null; at = at.parentElement) {
    const style = getComputedStyle(at);
    const x = unscrollable(style.overflowX);
    const y = unscrollable(style.overflowY);
    if (!x && !y) continue;
    at.scrollLeft = 0;
    at.scrollTop = 0;
    clippers.push({ at, x, y });
  }
  const lines = Array.from(this.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  return clippers.some(({ at, x, y }) => {
    const box = at.getBoundingClientRect();
    const left = box.left + at.clientLeft;
    const top = box.top + at.clientTop;
    return lines.some(
      (rect) =>
        (x && (rect.left < left - ${EDGE_TOLERANCE_PX} || rect.right > left + at.clientWidth + ${EDGE_TOLERANCE_PX})) ||
        (y && (rect.top < top - ${EDGE_TOLERANCE_PX} || rect.bottom > top + at.clientHeight + ${EDGE_TOLERANCE_PX})),
    );
  });
}`;

const judgeReach = Effect.fn("judgeReach")(function* (dom: Dom, element: Resolved, found: string[]) {
  const unshown = yield* callOn(dom, element.id, FIRST_UNSHOWN_TEXT);
  if (typeof unshown === "string") {
    found.push(`${label(element)} hides its text "${normaliseText(unshown).slice(0, LABEL_CHARS)}"`);
    return 0;
  }
  yield* evaluate(dom.cdp, "window.scrollTo(0, 0)");
  if ((yield* callOn(dom, element.id, CUT_OFF_BY_UNSCROLLABLE)) === true) found.push(`${label(element)} is cut off by a container that cannot be scrolled`);
  yield* attempt("cannot scroll an element into view", () => dom.cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.id }));
  const viewport = yield* viewportOf(dom.cdp);
  if (viewport.scrollX > 0) found.push(`${label(element)} is reachable only by scrolling the page sideways`);
  const rects = yield* lineRects(dom, element.id);
  for (const rect of rects) found.push(...(yield* judgeLine(dom, viewport, element, rect)));
  if ((yield* callOn(dom, element.id, CLIPS_ITS_OWN_TEXT)) === true) found.push(`${label(element)} clips its own text`);
  return rects.length;
});

export const judgeLayout = Effect.fn("judgeLayout")(function* (cdp: CDPSession, targets: readonly Target[]) {
  const found: string[] = [];
  const viewport = yield* viewportOf(cdp);
  if (viewport.contentWidth > viewport.width + EDGE_TOLERANCE_PX) {
    found.push(`the page is ${viewport.contentWidth}px wide in a ${viewport.width}px viewport`);
  }
  const dom = yield* readDom(cdp);
  const { elements, parked } = yield* resolveTargets(dom, targets);
  yield* findOverlaps(dom, elements, found);
  const scanned: Scanned[] = [];
  for (const element of elements) {
    const lines = yield* judgeReach(dom, element, found);
    scanned.push({ name: element.name, text: element.text, lines });
  }
  return { found, scanned, parked } satisfies LayoutReport;
});
