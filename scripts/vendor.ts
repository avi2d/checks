#!/usr/bin/env bun
import { Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { QUALITY_FILE } from "./gates.ts";
import { git } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { readQuality, type Library } from "./quality-file.ts";

const NAME = "checks-vendor";
const USAGE = `usage: ${NAME} takes no arguments, since quality.json names the libraries`;
const CACHE_HOME = ".cache/avi2dg-checks";
const RECORD = ".checks-vendor-commit";
const LINKS = "repos";
const VERSION_TOKEN = "{version}";

export class VendorError extends Schema.TaggedError<VendorError>()("VendorError", {
  message: Schema.String,
}) {}

export function tagFor(template: string, version: string): string {
  return template.replaceAll(VERSION_TOKEN, version);
}

const SCHEMED = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/(.+)$/i;
const SCP_LIKE = /^(?:[^@/:]+@)?([^:/]+):(.+)$/;

function urlSegments(host: string, rest: string): readonly string[] {
  const parts = rest.split("/").filter((part) => part !== "");
  return [host, ...parts.slice(0, -1), (parts[parts.length - 1] ?? "").replace(/\.git$/, "")];
}

export function remoteSegments(remote: string): readonly string[] {
  const cleaned = remote.replace(/\/+$/, "");
  const schemed = SCHEMED.exec(cleaned);
  if (schemed !== null) {
    const [, , host, rest] = schemed;
    if (host !== undefined && rest !== undefined) return urlSegments(host, rest);
  }
  const scp = SCP_LIKE.exec(cleaned);
  if (scp !== null) {
    const [, host, rest] = scp;
    if (host !== undefined && rest !== undefined) return urlSegments(host, rest);
  }
  const escaped = cleaned
    .replaceAll("_", "__")
    .replaceAll("/", "_")
    .replaceAll(":", "_")
    .replace(/^\.+/, (dots) => "_".repeat(dots.length));
  return ["local", escaped];
}

export function resolveTag(output: string, tag: string): string | undefined {
  let plain: string | undefined;
  for (const line of output.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (sha === undefined || ref === undefined) continue;
    if (ref === `refs/tags/${tag}^{}`) return sha;
    if (ref === `refs/tags/${tag}`) plain = sha;
  }
  return plain;
}

const PackageManifest = Schema.Struct({ version: Schema.NonEmptyString });
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(PackageManifest));

const manifestVersion = Effect.fn("manifestVersion")(function* (file: string, missing: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file))) return yield* new VendorError({ message: missing });
  const { version } = yield* fs.readFileString(file).pipe(
    Effect.flatMap(decodeManifest),
    Effect.mapError((cause) => new VendorError({ message: `${file} carries no version: ${cause.message}` })),
  );
  return version;
});

const headOf = Effect.fn("headOf")(function* (dir: string) {
  return (yield* git(["rev-parse", "HEAD"], dir).pipe(
    Effect.mapError((cause) => new VendorError({ message: `${dir} names no commit: ${cause.message}` })),
  )).trim();
});

const remoteTag = Effect.fn("remoteTag")(function* (remote: string, tag: string) {
  const output = yield* git(["ls-remote", remote, `refs/tags/${tag}*`]).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot list ${tag} on ${remote}: ${cause.message}` })),
  );
  const sha = resolveTag(output, tag);
  if (sha === undefined) return yield* new VendorError({ message: `${remote} holds no tag ${tag}, so the installed version points nowhere` });
  return sha;
});

const listed = Effect.fn("listed")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs.readDirectory(dir, { recursive: true }).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot list ${dir}: ${cause.message}` })),
  );
  return entries.map((entry) => (path.isAbsolute(entry) ? entry : path.join(dir, entry)));
});

const isLink = Effect.fn("isLink")(function* (entry: string) {
  const fs = yield* FileSystem.FileSystem;
  return Option.isSome(yield* fs.readLink(entry).pipe(Effect.option));
});

type EntryMode = {
  readonly entry: string;
  readonly mode: number;
};

const modes = Effect.fn("modes")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const found: EntryMode[] = [];
  for (const entry of [dir, ...(yield* listed(dir))]) {
    if (yield* isLink(entry)) continue;
    const info = yield* fs.stat(entry).pipe(
      Effect.mapError((cause) => new VendorError({ message: `cannot stat ${entry}: ${cause.message}` })),
    );
    found.push({ entry, mode: info.mode });
  }
  return found;
});

const WRITE_BITS = 0o222;
const OWNER_WRITE = 0o200;

function clearing(dir: string): string {
  return `clear it with \`chmod -R u+w ${dir} && rm -rf ${dir}\` and rerun ${NAME}`;
}

const freeze = Effect.fn("freeze")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const { entry, mode } of yield* modes(dir)) {
    yield* fs.chmod(entry, mode & ~WRITE_BITS).pipe(
      Effect.mapError((cause) => new VendorError({ message: `cannot freeze ${entry}: ${cause.message}` })),
    );
  }
});

function discard(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(dir))) return;
    for (const { entry, mode } of yield* modes(dir)) yield* fs.chmod(entry, mode | OWNER_WRITE);
    yield* fs.remove(dir, { recursive: true });
  }).pipe(Effect.catch((cause) => Console.error(`${NAME}: cannot clear the staging tree ${dir}: ${cause.message}`)));
}

const checkVersion = Effect.fn("checkVersion")(function* (dir: string, library: Library, installed: string, tag: string) {
  const path = yield* Path.Path;
  const manifest = path.join(dir, library.path ?? "package.json");
  const landed = yield* manifestVersion(manifest, `${manifest} is missing, so ${tag} cannot prove it holds ${installed}`);
  if (landed !== installed) {
    return yield* new VendorError({ message: `${tag} holds version ${landed}, not the installed ${installed}` });
  }
});

const verify = Effect.fn("verify")(function* (dir: string, library: Library, installed: string, tag: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const record = (yield* fs.readFileString(path.join(dir, RECORD)).pipe(
    Effect.mapError(() => new VendorError({ message: `${dir} holds no fetch record; ${clearing(dir)}` })),
  )).trim();
  const remote = yield* remoteTag(library.repository, tag);
  if (remote !== record) {
    return yield* new VendorError({
      message: `${tag} on ${library.repository} lands on ${remote}, not the recorded ${record}; ${clearing(dir)} to pin the move deliberately`,
    });
  }
  const head = yield* headOf(dir);
  if (head !== record) {
    return yield* new VendorError({ message: `${dir} sits on ${head}, not the recorded ${record}; ${clearing(dir)}` });
  }
  yield* checkVersion(dir, library, installed, tag);
  const tampered = (yield* modes(dir)).filter(({ mode }) => (mode & WRITE_BITS) !== 0).map(({ entry }) => entry);
  if (tampered.length > 0) {
    const [first = dir] = tampered;
    return yield* new VendorError({
      message: `${dir} leaves ${tampered.length} paths writable, starting with ${first}; ${clearing(dir)}`,
    });
  }
  const status = yield* git(["status", "--porcelain", "--", ".", `:!${RECORD}`], dir).pipe(
    Effect.mapError((cause) => new VendorError({ message: `${dir} reports no status: ${cause.message}` })),
  );
  if (status.trim() !== "") {
    const [first = ""] = status.trim().split("\n");
    return yield* new VendorError({ message: `${dir} holds writes outside the recorded commit, starting with ${first}; ${clearing(dir)}` });
  }
});

const ensureLink = Effect.fn("ensureLink")(function* (root: string, library: Library, dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const parent = path.join(root, LINKS);
  yield* fs.makeDirectory(parent, { recursive: true }).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot hold ${parent}: ${cause.message}` })),
  );
  const at = path.join(parent, library.name);
  const current = yield* fs.readLink(at).pipe(Effect.option);
  if (Option.isSome(current)) {
    if (current.value === dir) return;
    yield* fs.remove(at).pipe(
      Effect.mapError((cause) => new VendorError({ message: `cannot move ${at} aside: ${cause.message}` })),
    );
  } else if (yield* fs.exists(at)) {
    return yield* new VendorError({ message: `${at} is not a link, so ${NAME} leaves it alone; move it away and rerun` });
  }
  yield* fs.symlink(dir, at).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot link ${at} to ${dir}: ${cause.message}` })),
  );
});

const stage = Effect.fn("stage")(function* (staging: string, library: Library, installed: string, tag: string, dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* git(["clone", "--no-local", "--branch", tag, "--depth", "1", "--", library.repository, staging]).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot clone ${tag} from ${library.repository}: ${cause.message}` })),
  );
  const head = yield* headOf(staging);
  yield* fs.writeFileString(path.join(staging, RECORD), `${head}\n`).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot record the fetch in ${staging}: ${cause.message}` })),
  );
  yield* checkVersion(staging, library, installed, tag);
  yield* freeze(staging);
  return yield* fs.rename(staging, dir).pipe(
    Effect.as(true),
    Effect.catchTag("PlatformError", (cause) =>
      Effect.flatMap(fs.exists(dir), (raced) =>
        raced ? Effect.succeed(false) : Effect.fail(new VendorError({ message: `cannot move ${staging} into ${dir}: ${cause.message}` })),
      ),
    ),
  );
});

const land = Effect.fn("land")(function* (library: Library, installed: string, tag: string, dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const parent = path.dirname(dir);
  yield* fs.makeDirectory(parent, { recursive: true }).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot hold ${dir}: ${cause.message}` })),
  );
  const staging = yield* fs.makeTempDirectory({ directory: parent, prefix: `.${path.basename(dir)}-` }).pipe(
    Effect.mapError((cause) => new VendorError({ message: `cannot stage ${dir}: ${cause.message}` })),
  );
  return yield* stage(staging, library, installed, tag, dir).pipe(Effect.ensuring(discard(staging)));
});

const vend = Effect.fn("vend")(function* (root: string, cache: string, library: Library) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const installed = yield* manifestVersion(
    path.join(root, "node_modules", ...library.package.split("/"), "package.json"),
    `node_modules/${library.package}/package.json is missing, so the installed version of ${library.package} is unknown; install first`,
  );
  const tag = tagFor(library.tag, installed);
  const dir = path.join(cache, LINKS, ...remoteSegments(library.repository), tag);
  if (!(yield* fs.exists(dir)) && (yield* land(library, installed, tag, dir))) {
    yield* Console.log(`${NAME}: cloned ${tag} from ${library.repository} and linked ${LINKS}/${library.name}`);
  } else {
    yield* verify(dir, library, installed, tag);
    yield* Console.log(`${NAME}: ${LINKS}/${library.name} still holds ${tag}, verified against ${library.repository}`);
  }
  yield* ensureLink(root, library, dir);
});

const cacheRoot = Effect.fn("cacheRoot")(function* () {
  const path = yield* Path.Path;
  const home = process.env.HOME;
  if (home === undefined || home === "") {
    return yield* new VendorError({ message: "HOME is missing, so the shared cache has no root" });
  }
  return path.join(home, CACHE_HOME);
});

const main = Effect.gen(function* () {
  const [extra] = process.argv.slice(2);
  if (extra !== undefined) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const { quality } = yield* readQuality(root);
  const libraries = quality.sources?.libraries ?? [];
  if (libraries.length === 0) {
    yield* Console.log(`${NAME}: ${QUALITY_FILE} declares no libraries, so nothing is pinned`);
    return true;
  }
  const cache = yield* cacheRoot();
  let passed = true;
  for (const library of libraries) {
    const vended = yield* vend(root, cache, library).pipe(
      Effect.as(true),
      Effect.catchTag("VendorError", (failure) => Console.error(`${NAME}: ${failure.message}`).pipe(Effect.as(false))),
    );
    passed = passed && vended;
  }
  return passed;
});

if (import.meta.main) runMain(NAME, main);
