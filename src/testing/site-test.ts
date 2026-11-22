import { BunServices } from "@effect/platform-bun";
import { afterAll, test } from "bun:test";
import { Effect } from "effect";
import { chromium, webkit, type Browser, type BrowserServer, type BrowserType, type LaunchOptions } from "playwright-core";
import { Usage } from "../core/main.ts";
import { listenSite, readSite, sitePages } from "../quality/browser/serve.ts";
import { type ScreenEngine } from "./block-screens.ts";

export type ServedSite = {
  readonly url: string;
  readonly pages: readonly string[];
  readonly browser: Browser;
};

export type SiteTest = {
  readonly site: string | (() => Promise<string>);
  readonly engine?: ScreenEngine;
  readonly launch?: LaunchOptions;
  readonly timeoutMs?: number;
};

type OpenBrowser = { readonly browser: Browser; readonly server: BrowserServer };

const browsers = new Map<string, Promise<OpenBrowser>>();

function connectLocalBrowser(browserType: BrowserType, server: BrowserServer): Promise<Browser> {
  return browserType.connect(server.wsEndpoint()).then((browser) => {
    const connection = (browser as unknown as { _connection?: { _isRemote: boolean; isRemote(): boolean } })._connection;
    if (connection === undefined) throw new Error("site-test cannot use a remotely connected browser");
    connection._isRemote = false;
    if (connection.isRemote()) throw new Error("site-test cannot use a remotely connected browser");
    return browser;
  });
}

function launchSiteBrowser(engine: ScreenEngine, launch: LaunchOptions | undefined): Promise<OpenBrowser> {
  const browserType = engine === "webkit" ? webkit : chromium;
  const options = engine === "webkit" ? launch : { ...launch, args: ["--font-render-hinting=none", ...(launch?.args ?? [])] };
  return browserType.launchServer(options).then((server) =>
    connectLocalBrowser(browserType, server).then(
      (browser) => ({ browser, server }),
      (error: unknown) => server.kill().then(() => Promise.reject(error)),
    ),
  );
}

function openBrowser(engine: ScreenEngine, launch: LaunchOptions | undefined): Promise<Browser> {
  const key = `${engine} ${JSON.stringify(launch ?? {})}`;
  const open = browsers.get(key)?.catch(() => undefined) ?? Promise.resolve(undefined);
  return open.then((opened) => {
    if (opened?.browser.isConnected() === true) return opened.browser;
    const launched = (opened === undefined ? Promise.resolve() : opened.server.kill()).then(() => launchSiteBrowser(engine, launch));
    browsers.set(key, launched);
    return launched.then(({ browser }) => browser);
  });
}

function closeBrowsers(): Promise<unknown> {
  const open = [...browsers.values()];
  browsers.clear();
  return Promise.all(open.map((launched) => launched.then(({ server }) => server.kill(), () => undefined)));
}

const builtSite = Effect.fn("builtSite")(function* (dir: string) {
  const site = yield* readSite(process.cwd(), dir).pipe(
    Effect.catchTag("Usage", () => Effect.fail(new Usage({ message: `the site ${dir} is not a directory, so build the site before its tests run` }))),
  );
  const pages = sitePages(site);
  if (pages.length === 0) return yield* new Usage({ message: `the built site at ${dir} holds no .html page` });
  return { site, pages };
});

export const pageUrl = (site: ServedSite, page: string): string => new URL(page, site.url).href;

const siteDir = (site: SiteTest["site"]): Promise<string> => (typeof site === "string" ? Promise.resolve(site) : site());

function servedRun(options: SiteTest, fn: (site: ServedSite) => Promise<unknown>): Promise<unknown> {
  return siteDir(options.site)
    .then((dir) => Effect.runPromise(builtSite(dir).pipe(Effect.provide(BunServices.layer))))
    .then(({ site, pages }) =>
      openBrowser(options.engine ?? "chromium", options.launch).then((browser) => {
        const listening = listenSite(site);
        return fn({ url: listening.url, pages, browser }).finally(() =>
          listening.stop().then(() => Promise.all(browser.contexts().map((context) => context.close()))),
        );
      }),
    );
}

export function siteTest(name: string, options: SiteTest, fn: (site: ServedSite) => Promise<unknown>): void {
  // Registered per test: one registered at module load would close the browsers only after the first file that loads this module.
  afterAll(closeBrowsers);
  test(name, () => servedRun(options, fn), options.timeoutMs ?? 120_000);
}
