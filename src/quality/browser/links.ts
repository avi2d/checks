import { Effect, Result, Schema } from "effect";
import type { Page } from "playwright-core";
import { attempt, BrowserFailure, load } from "./page.ts";

const BROKEN_FROM = 400;

export type SameSiteLink = {
  readonly shown: string;
  readonly document: string;
  readonly fragment: string | undefined;
};

const Anchors = Schema.Struct({ names: Schema.Array(Schema.String), links: Schema.Array(Schema.String) });

const decodeAnchors = Schema.decodeUnknownEffect(Anchors);

const ANCHORS = `({
  names: [
    ...Array.from(document.querySelectorAll("[id]"), (element) => element.id),
    ...Array.from(document.querySelectorAll("a[name]"), (anchor) => anchor.getAttribute("name") ?? ""),
  ],
  links: Array.from(document.querySelectorAll("a[href], area[href]"), (link) => typeof link.href === "string" ? link.href : new URL(link.getAttribute("href") ?? "", link.baseURI).href),
})`;

// The HTML standard sends a fragment of "top" in any case to the start of the document, with no element named so.
const namesTop = (fragment: string): boolean => fragment.toLowerCase() === "top";

const decoded = (text: string): string => Result.getOrElse(Result.try(() => decodeURIComponent(text)), () => text);

function documentOf(url: URL): string {
  const document = new URL(url);
  document.hash = "";
  return document.href;
}

export function sameSiteLinks(origin: string, hrefs: readonly string[]): readonly SameSiteLink[] {
  return [...new Set(hrefs)].flatMap((href) => {
    const url = new URL(href);
    if (url.origin !== origin) return [];
    const fragment = url.hash === "" ? undefined : decoded(url.hash.slice(1));
    return [
      {
        shown: `${url.pathname}${url.search}${url.hash}`,
        document: documentOf(url),
        fragment: fragment === undefined || namesTop(fragment) ? undefined : fragment,
      },
    ];
  });
}

const anchorsOn = Effect.fn("anchorsOn")(function* (page: Page) {
  const anchors: unknown = yield* attempt("cannot read the links of the page", () => page.evaluate(ANCHORS));
  return yield* decodeAnchors(anchors).pipe(Effect.mapError(() => new BrowserFailure({ message: "the page gave links that are not a list of addresses" })));
});

const statusOf = (document: string): Effect.Effect<number, BrowserFailure> =>
  attempt(`cannot fetch ${document}`, () =>
    fetch(document).then((response) => Promise.resolve(response.body?.cancel()).then(() => response.status)),
  );

const namesAt = Effect.fn("namesAt")(function* (page: Page, document: string) {
  yield* load(page, document);
  return (yield* anchorsOn(page)).names;
});

type LinksReport = {
  readonly found: readonly string[];
  readonly links: number;
};

export const judgeLinks = Effect.fn("judgeLinks")(function* (page: Page, url: string) {
  yield* load(page, url);
  const route = yield* anchorsOn(page);
  const links = sameSiteLinks(new URL(url).origin, route.links);
  const statuses = new Map<string, number>();
  const namesOf = new Map<string, readonly string[]>([[documentOf(new URL(url)), route.names]]);
  const found: string[] = [];
  for (const { shown, document, fragment } of links) {
    const status = statuses.get(document) ?? (yield* statusOf(document));
    statuses.set(document, status);
    if (status >= BROKEN_FROM) found.push(`${shown} answers ${String(status)}`);
    else if (fragment !== undefined) {
      const names = namesOf.get(document) ?? (yield* namesAt(page, document));
      namesOf.set(document, names);
      if (!names.includes(fragment)) found.push(`${shown} names no element on its page`);
    }
  }
  return { found, links: links.length } satisfies LinksReport;
});
