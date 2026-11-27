import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { collect } from "../core/git.ts";
import { installPinned, releaseAssetApi } from "./pinned-binary.ts";

export const OSV_SCANNER_VERSION = "2.7.1";
const REPOSITORY = "google/osv-scanner";
const RELEASES = `https://github.com/${REPOSITORY}/releases/download/v${OSV_SCANNER_VERSION}`;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const REFRESH_HOURS = 24;
export const USABLE_DAYS = 7;
const FOUND_NOTHING = 0;
const FOUND_ADVISORIES = 1;
const FOUND_NO_PACKAGE = 128;
const NO_RESULTS = JSON.stringify({ results: [] });

type Build = { readonly asset: string; readonly assetId: number; readonly sha256: string };

const BUILDS: Readonly<Record<string, Build>> = {
  "darwin-arm64": { asset: "osv-scanner_darwin_arm64", assetId: 726_165_290, sha256: "b22c02877a811c8f78956e8643efa554932b7378f590d13f8e97d4e9448a29f3" },
  "darwin-x64": { asset: "osv-scanner_darwin_amd64", assetId: 726_165_293, sha256: "b8420d5485ba792626315f1bf9a5a2046e971d38eea75bf9090c38852dbc3b1b" },
  "linux-arm64": { asset: "osv-scanner_linux_arm64", assetId: 726_165_576, sha256: "983d22fbad9724514e3fcc6acc83b5fa64c5ffa6b0d9f510028f22c1b223ff81" },
  "linux-x64": { asset: "osv-scanner_linux_amd64", assetId: 726_165_286, sha256: "fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8" },
};

class OsvScannerError extends Schema.TaggedError<OsvScannerError>()("OsvScannerError", {
  message: Schema.String,
}) {}

export function buildFor(platform: string, arch: string): Option.Option<Build> {
  return Option.fromNullishOr(BUILDS[`${platform}-${arch}`]);
}

const pinnedBinary = Effect.fn("pinnedBinary")(function* (cache: string) {
  const build = buildFor(process.platform, process.arch);
  if (Option.isNone(build)) {
    return yield* new OsvScannerError({ message: `no pinned OSV-Scanner build runs on ${process.platform}-${process.arch}` });
  }
  const path = yield* Path.Path;
  const { asset, assetId, sha256 } = build.value;
  return yield* installPinned(
    { kind: "binary", url: `${RELEASES}/${asset}`, mirror: releaseAssetApi(REPOSITORY, assetId), sha256 },
    path.join(cache, "osv-scanner", OSV_SCANNER_VERSION, asset),
  );
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
