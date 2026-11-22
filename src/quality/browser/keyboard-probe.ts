import type { BrowserContext } from "playwright-core";
import type { PageElement, PageView, ProbeFocusEvent } from "./keyboard-page.ts";

declare const window: Pick<PageView, "addEventListener" | "checksFocusProbe">;

const installFocusProbe = (): void => {
  let probing = false;
  const suppressProbeEvent = (event: ProbeFocusEvent): void => {
    if (probing) event.stopImmediatePropagation();
  };
  for (const name of ["blur", "focusout", "focus", "focusin"]) {
    window.addEventListener(name, suppressProbeEvent, true);
  }
  window.checksFocusProbe = (moveFocus) => {
    probing = true;
    moveFocus();
    probing = false;
  };
};

// A listener installed after the page loads cannot stop earlier capture listeners.
export const prepareFocusProbe = (context: BrowserContext): Promise<unknown> => context.addInitScript(installFocusProbe);

export const moveProbeFocus = (element: PageElement, focused: boolean): boolean => {
  const view = element.ownerDocument.defaultView;
  if (view.checksFocusProbe === undefined) return false;
  view.checksFocusProbe(() => {
    if (focused) element.focus({ preventScroll: true });
    else element.blur();
  });
  return true;
};
