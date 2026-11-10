import { BunServices } from "@effect/platform-bun";
import { afterAll, test } from "bun:test";
import { Effect } from "effect";
import type { Browser, LaunchOptions } from "playwright-core";
import { Usage } from "../core/main.ts";
import { listenSite, readSite, sitePages } from "../quality/browser/serve.ts";
import { launchBrowser, type ScreenEngine } from "./block-screens.ts";

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

const browsers = new Map<string, Promise<Browser>>();

function openBrowser(engine: ScreenEngine, launch: LaunchOptions | undefined): Promise<Browser> {
  const key = `${engine} ${JSON.stringify(launch ?? {})}`;
  const open = browsers.get(key)?.catch(() => undefined) ?? Promise.resolve(undefined);
  return open.then((browser) => {
    if (browser?.isConnected() === true) return browser;
    const launched = launchBrowser(engine, launch);
    browsers.set(key, launched);
    return launched;
  });
}

function closeBrowsers(): Promise<unknown> {
  const open = [...browsers.values()];
  browsers.clear();
  return Promise.all(open.map((launched) => launched.then((browser) => browser.close(), () => undefined)));
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
