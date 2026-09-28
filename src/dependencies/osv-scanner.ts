import { Clock, Context, Crypto, Effect, Encoding, FileSystem, Layer, Option, Path, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { collect } from "../core/git.ts";

export const OSV_SCANNER_VERSION = "2.6.0";
const RELEASES = `https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}`;
const EXECUTABLE_MODE = 0o755;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const REFRESH_HOURS = 24;
export const USABLE_DAYS = 7;
const FOUND_NOTHING = 0;
const FOUND_ADVISORIES = 1;
const FOUND_NO_PACKAGE = 128;
const NO_RESULTS = JSON.stringify({ results: [] });

type Build = { readonly asset: string; readonly sha256: string };

// The SHA-256 of each asset as osv-scanner_SHA256SUMS of the release lists it.
const BUILDS: Readonly<Record<string, Build>> = {
  "darwin-arm64": { asset: "osv-scanner_darwin_arm64", sha256: "98c460dcd37de25819babd757d04542045b6243113e209edcd4d89fedb0256b4" },
  "darwin-x64": { asset: "osv-scanner_darwin_amd64", sha256: "60c5296637e977b28eeda5c7f13573e447659a632922737f94d11fa7e30ad6ca" },
  "linux-arm64": { asset: "osv-scanner_linux_arm64", sha256: "2c71403eb443d05891c4f268c3ad771cf4f16e5443463fd7851ef8f454d3c7e4" },
  "linux-x64": { asset: "osv-scanner_linux_amd64", sha256: "ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108" },
};

class OsvScannerError extends Schema.TaggedError<OsvScannerError>()("OsvScannerError", {
  message: Schema.String,
}) {}

export function buildFor(platform: string, arch: string): Option.Option<Build> {
  return Option.fromNullishOr(BUILDS[`${platform}-${arch}`]);
}

const sha256Of = Effect.fn("sha256Of")(function* (bytes: Uint8Array) {
  const crypto = yield* Crypto.Crypto;
  return Encoding.encodeHex(yield* crypto.digest("SHA-256", bytes));
});

const verified = Effect.fn("verified")(function* (binary: string, sha256: string) {
  const fs = yield* FileSystem.FileSystem;
  const found = yield* sha256Of(yield* fs.readFile(binary));
  if (found !== sha256) {
    return yield* new OsvScannerError({ message: `${binary} has SHA-256 ${found}, not the pinned ${sha256}; delete it and rerun` });
  }
  return binary;
});

const download = Effect.fn("download")(function* (url: string) {
  const response = yield* HttpClient.get(url).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
  return new Uint8Array(yield* response.arrayBuffer);
}, Effect.provide(FetchHttpClient.layer));

// The binary lands through a rename in its own directory, so a concurrent run sees it whole or not at all.
export const installPinned = Effect.fn("installPinned")(function* (url: string, sha256: string, binary: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (yield* fs.exists(binary)) return yield* verified(binary, sha256);
  const bytes = yield* download(url).pipe(
    Effect.mapError((cause) => new OsvScannerError({ message: `cannot download ${url}: ${cause.message}` })),
  );
  const found = yield* sha256Of(bytes);
  if (found !== sha256) {
    return yield* new OsvScannerError({ message: `${url} has SHA-256 ${found}, not the pinned ${sha256}, so nothing was installed` });
  }
  yield* fs.makeDirectory(path.dirname(binary), { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: path.dirname(binary), prefix: `.${path.basename(binary)}-` });
  const staged = path.join(staging, path.basename(binary));
  yield* fs.writeFile(staged, bytes);
  yield* fs.chmod(staged, EXECUTABLE_MODE);
  yield* fs.rename(staged, binary);
  return binary;
}, Effect.scoped);

const pinnedBinary = Effect.fn("pinnedBinary")(function* (cache: string) {
  const build = buildFor(process.platform, process.arch);
  if (Option.isNone(build)) {
    return yield* new OsvScannerError({ message: `no pinned OSV-Scanner build runs on ${process.platform}-${process.arch}` });
  }
  const path = yield* Path.Path;
  const { asset, sha256 } = build.value;
  return yield* installPinned(`${RELEASES}/${asset}`, sha256, path.join(cache, "osv-scanner", OSV_SCANNER_VERSION, asset));
});

type PinnedBinary = ReturnType<typeof pinnedBinary>;

export class Scanner extends Context.Service<
  Scanner,
  { readonly binary: (cache: string) => Effect.Effect<string, Effect.Error<PinnedBinary>> }
>()("@avi2dg/checks/dependencies/Scanner") {
  static readonly pinned = Layer.effect(
    Scanner,
    Effect.gen(function* () {
      const services = yield* Effect.context<Effect.Services<PinnedBinary>>();
      return Scanner.of({ binary: (cache) => pinnedBinary(cache).pipe(Effect.provideContext(services)) });
    }),
  );
}

type RefreshPlan = "refresh" | "offline";

export function refreshPlan(refreshedAgo: Option.Option<number>): RefreshPlan {
  return Option.isSome(refreshedAgo) && refreshedAgo.value <= REFRESH_HOURS * HOUR_MS ? "offline" : "refresh";
}

export function usableWithoutRefresh(refreshedAgo: Option.Option<number>): boolean {
  return Option.isSome(refreshedAgo) && refreshedAgo.value <= USABLE_DAYS * DAY_MS;
}

type Database = { readonly dir: string; readonly marker: string };

// An unparsable marker gives NaN and one dated ahead of the clock a negative age, and neither says how old the database is.
export function refreshAge(recorded: Option.Option<string>, now: number): Option.Option<number> {
  return Option.filter(Option.map(recorded, (text) => now - Date.parse(text.trim())), (ago) => ago >= 0);
}

const refreshedAgo = Effect.fn("refreshedAgo")(function* ({ marker }: Database) {
  const fs = yield* FileSystem.FileSystem;
  const recorded = yield* fs.readFileString(marker).pipe(Effect.option);
  return refreshAge(recorded, yield* Clock.currentTimeMillis);
});

const FLAGS: Readonly<Record<RefreshPlan, readonly string[]>> = {
  refresh: ["--offline-vulnerabilities", "--download-offline-databases", "--no-resolve"],
  offline: ["--offline"],
};

type Scanned =
  | { readonly kind: "scanned"; readonly stdout: string }
  | { readonly kind: "no-package" }
  | { readonly kind: "failed"; readonly reason: string };

const scanOnce = Effect.fn("scanOnce")(function* (binary: string, database: Database, config: string, lockfiles: readonly string[], plan: RefreshPlan) {
  const args = ["scan", "source", ...FLAGS[plan], "--format", "json", "--config", config, ...lockfiles.flatMap((file) => ["-L", file])];
  const { stdout, stderr, exitCode } = yield* collect(binary, args, undefined, { env: { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: database.dir } }).pipe(
    Effect.mapError((cause) => new OsvScannerError({ message: `cannot run ${binary}: ${cause.message}` })),
  );
  if (exitCode === FOUND_NOTHING || exitCode === FOUND_ADVISORIES) return { kind: "scanned", stdout } satisfies Scanned;
  if (exitCode === FOUND_NO_PACKAGE) return { kind: "no-package" } satisfies Scanned;
  const reason = stderr.trim().split("\n").at(-1) ?? "";
  return { kind: "failed", reason: `${binary} exited ${exitCode}: ${reason}` } satisfies Scanned;
});

type ScanResult = { readonly stdout: string; readonly note: Option.Option<string> };

// A failed refresh leaves the cached database in place, which still serves until USABLE_DAYS pass without a refresh.
export const scanLockfiles = Effect.fn("scanLockfiles")(function* (binary: string, cache: string, config: string, lockfiles: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(cache, "osv-scanner", "db");
  const database = { dir, marker: path.join(dir, "refreshed") };
  const ago = yield* refreshedAgo(database);
  const plan = refreshPlan(ago);
  const first = yield* scanOnce(binary, database, config, lockfiles, plan);
  // A lockfile with no package stops the scanner before it downloads anything, so no refresh is recorded.
  if (first.kind === "no-package") return { stdout: NO_RESULTS, note: Option.none() } satisfies ScanResult;
  if (first.kind === "scanned") {
    if (plan === "refresh") {
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* fs.writeFileString(database.marker, `${new Date(yield* Clock.currentTimeMillis).toISOString()}\n`);
    }
    return { stdout: first.stdout, note: Option.none() } satisfies ScanResult;
  }
  if (plan === "offline") return yield* new OsvScannerError({ message: first.reason });
  if (Option.isNone(ago) || !usableWithoutRefresh(ago)) {
    return yield* new OsvScannerError({
      message: `could not refresh the OSV database, and no copy was refreshed in the last ${USABLE_DAYS} days: ${first.reason}`,
    });
  }
  const fallback = yield* scanOnce(binary, database, config, lockfiles, "offline");
  if (fallback.kind === "failed") return yield* new OsvScannerError({ message: fallback.reason });
  if (fallback.kind === "no-package") return { stdout: NO_RESULTS, note: Option.none() } satisfies ScanResult;
  const days = Math.floor(ago.value / DAY_MS);
  return { stdout: fallback.stdout, note: Option.some(`could not refresh the OSV database, so the scan read the copy refreshed ${days} day(s) ago: ${first.reason}`) } satisfies ScanResult;
});
