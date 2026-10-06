import { Effect, FileSystem, Path } from "effect";
import { Usage } from "../../core/main.ts";

const INDEX = "index.html";

export type Site = {
  readonly files: ReadonlyMap<string, string>;
  readonly pages: readonly string[];
};

export const readSite = Effect.fn("readSite")(function* (root: string, site: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.resolve(root, site);
  const isDirectory = yield* fs.stat(dir).pipe(
    Effect.map(({ type }) => type === "Directory"),
    Effect.orElseSucceed(() => false),
  );
  if (!isDirectory) return yield* new Usage({ message: `the declared site ${site} is not a directory, so build the site before the browser checks run` });
  const files = new Map<string, string>();
  for (const entry of yield* fs.readDirectory(dir, { recursive: true })) {
    const file = path.join(dir, entry);
    if ((yield* fs.stat(file)).type !== "File") continue;
    const url = `/${entry.split(path.sep).join("/")}`;
    files.set(url, file);
    if (url.endsWith(`/${INDEX}`)) files.set(url.slice(0, -INDEX.length), file);
  }
  const pages = [...files.keys()].filter((url) => url.endsWith("/") || (url.endsWith(".html") && !url.endsWith(`/${INDEX}`))).toSorted();
  return { files, pages } satisfies Site;
});

function answer(site: Site, request: Request): Response {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const file = site.files.get(pathname);
  if (file !== undefined) return new Response(Bun.file(file));
  if (site.files.has(`${pathname}/`)) {
    url.pathname = `${url.pathname}/`;
    return Response.redirect(url.href, 301);
  }
  return new Response("not found", { status: 404 });
}

export const serveSite = Effect.fn("serveSite")(function* (site: Site) {
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => answer(site, request) })),
    (served) => Effect.promise(() => served.stop()),
  );
  return `http://127.0.0.1:${server.port}/`;
});
