import { Config, Effect, Schema } from "effect";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import type { Visit } from "./declaration.ts";

export class BrowserFailure extends Schema.TaggedError<BrowserFailure>()("BrowserFailure", {
  message: Schema.String,
}) {}

export const attempt = <A>(doing: string, run: () => Promise<A>): Effect.Effect<A, BrowserFailure> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new BrowserFailure({ message: `${doing}: ${cause instanceof Error ? cause.message : String(cause)}` }),
  });

// Playwright's own Chromium build is a separate download, so the runner drives the Chrome the machine already has.
export const launchChrome = Effect.gen(function* () {
  const { chromium } = yield* attempt("cannot load playwright-core, which a product that runs the browser checks installs beside the kit", () =>
    import("playwright-core"),
  );
  const executablePath = yield* Config.String("CHROME_PATH").pipe(Config.withDefault(""));
  return yield* Effect.acquireRelease(
    attempt("cannot launch Chrome, so set CHROME_PATH to its executable", () =>
      chromium.launch(executablePath === "" ? { channel: "chrome" } : { executablePath }),
    ),
    (browser) => attempt("closing Chrome", () => browser.close()).pipe(Effect.catchTag("BrowserFailure", () => Effect.void)),
  );
});

type Opened = {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly cdp: CDPSession;
};

export type Preparation = (context: BrowserContext) => Promise<unknown>;

const NO_PREPARATION: Preparation = () => Promise.resolve();

export const openVisit = Effect.fn("openVisit")(function* (browser: Browser, { viewport, state }: Visit, prepare: Preparation = NO_PREPARATION) {
  const touch = viewport.touch === true;
  const context = yield* Effect.acquireRelease(
    attempt("cannot open a browser context", () =>
      browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: touch,
        isMobile: touch,
        reducedMotion: state.reducedMotion ?? "no-preference",
      }),
    ),
    (opened) => attempt("closing a browser context", () => opened.close()).pipe(Effect.catchTag("BrowserFailure", () => Effect.void)),
  );
  yield* attempt("cannot prepare the browser context", () => prepare(context));
  const page = yield* attempt("cannot open a page", () => context.newPage());
  const cdp = yield* attempt("cannot open a DevTools session", () => context.newCDPSession(page));
  yield* attempt("cannot enable the DevTools page domain", () => cdp.send("Page.enable"));
  if (state.textPx !== undefined) {
    const standard = state.textPx;
    yield* attempt("cannot enlarge the text", () => cdp.send("Page.setFontSizes", { fontSizes: { standard } }));
  }
  return { context, page, cdp } satisfies Opened;
});

export const load = Effect.fn("load")(function* (page: Page, url: string) {
  yield* attempt(`cannot load ${url}`, () => page.goto(url, { waitUntil: "load" }));
  yield* attempt(`fonts never settle on ${url}`, () => page.evaluate("document.fonts.ready.then(() => undefined)"));
});
