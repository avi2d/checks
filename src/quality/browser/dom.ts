import { Effect } from "effect";
import type { CDPSession } from "playwright-core";
import { attempt, BrowserFailure } from "./page.ts";

export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

type TreeNode = {
  readonly nodeId: number;
  readonly backendNodeId: number;
  readonly children?: readonly TreeNode[];
};

export type Dom = {
  readonly cdp: CDPSession;
  readonly rootId: number;
  readonly backendOf: ReadonlyMap<number, number>;
  readonly parentOf: ReadonlyMap<number, number>;
};

export const readDom = Effect.fn("readDom")(function* (cdp: CDPSession) {
  const { root } = yield* attempt("cannot read the DOM", () => cdp.send("DOM.getDocument", { depth: -1 }));
  const backendOf = new Map<number, number>();
  const parentOf = new Map<number, number>();
  const visit = (node: TreeNode): void => {
    backendOf.set(node.nodeId, node.backendNodeId);
    for (const child of node.children ?? []) {
      parentOf.set(child.backendNodeId, node.backendNodeId);
      visit(child);
    }
  };
  visit(root);
  return { cdp, rootId: root.nodeId, backendOf, parentOf } satisfies Dom;
});

export const querySelectorAll = Effect.fn("querySelectorAll")(function* (dom: Dom, selector: string) {
  const { nodeIds } = yield* attempt(`cannot query ${selector}`, () => dom.cdp.send("DOM.querySelectorAll", { nodeId: dom.rootId, selector }));
  return nodeIds.flatMap((nodeId) => {
    const backend = dom.backendOf.get(nodeId);
    return backend === undefined ? [] : [backend];
  });
});

export function isWithin(dom: Dom, node: number, ancestor: number): boolean {
  for (let at: number | undefined = node; at !== undefined; at = dom.parentOf.get(at)) {
    if (at === ancestor) return true;
  }
  return false;
}

function rectOfQuad(quad: readonly number[]): Rect {
  const xs = quad.filter((_, index) => index % 2 === 0);
  const ys = quad.filter((_, index) => index % 2 === 1);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

export const lineRects = Effect.fn("lineRects")(function* (dom: Dom, backendNodeId: number) {
  const { quads } = yield* attempt("cannot read an element's boxes", () => dom.cdp.send("DOM.getContentQuads", { backendNodeId }));
  return quads.map(rectOfQuad).filter((rect) => rect.right - rect.left > 0 && rect.bottom - rect.top > 0);
});

export function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

export type Viewport = {
  readonly width: number;
  readonly height: number;
  readonly contentWidth: number;
  readonly scrollX: number;
  readonly scrollY: number;
};

export const viewportOf = Effect.fn("viewportOf")(function* (cdp: CDPSession) {
  const { cssLayoutViewport, cssContentSize } = yield* attempt("cannot read the layout metrics", () => cdp.send("Page.getLayoutMetrics"));
  return {
    width: cssLayoutViewport.clientWidth,
    height: cssLayoutViewport.clientHeight,
    contentWidth: cssContentSize.width,
    scrollX: cssLayoutViewport.pageX,
    scrollY: cssLayoutViewport.pageY,
  } satisfies Viewport;
});

// Content quads are relative to the viewport, and the hit test takes coordinates relative to the document.
export const nodeAt = Effect.fn("nodeAt")(function* (dom: Dom, viewport: Viewport, x: number, y: number) {
  const { backendNodeId } = yield* attempt("cannot hit-test the page", () =>
    dom.cdp.send("DOM.getNodeForLocation", { x: Math.round(x + viewport.scrollX), y: Math.round(y + viewport.scrollY) }),
  );
  return backendNodeId;
});

export const callOn = Effect.fn("callOn")(function* (dom: Dom, backendNodeId: number, functionDeclaration: string) {
  const { object } = yield* attempt("cannot resolve an element", () => dom.cdp.send("DOM.resolveNode", { backendNodeId }));
  const { objectId } = object;
  if (objectId === undefined) return yield* new BrowserFailure({ message: `node ${backendNodeId} resolved to no object` });
  const { result } = yield* attempt("cannot call into the page", () =>
    dom.cdp.send("Runtime.callFunctionOn", { objectId, functionDeclaration, returnByValue: true }),
  );
  const value: unknown = result.value;
  return value;
});

export const evaluate = Effect.fn("evaluate")(function* (cdp: CDPSession, expression: string) {
  yield* attempt("cannot evaluate in the page", () => cdp.send("Runtime.evaluate", { expression }));
});
