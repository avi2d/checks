import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { MANIFEST } from "../core/release-names.ts";
import { assetNameOf, packagedBinaryOf, platformPackageOf, type PlatformTarget } from "../core/native-platforms.ts";
import { decodeSetting, loadSettings, PlatformPackages, SETTINGS_FILE, type PlatformName } from "../core/settings.ts";
import { publishPackage } from "./release-publish.ts";

export const PLATFORM_BINARIES_ENV = "CHECKS_PLATFORM_BINARIES";

type HostedPlatform = PlatformTarget & { readonly runner: string };

export const HOSTED_PLATFORMS = {
  "darwin-arm64": { os: "darwin", cpu: "arm64", runner: "macos-latest" },
  "darwin-x64": { os: "darwin", cpu: "x64", runner: "macos-15-intel" },
  "linux-arm64": { os: "linux", cpu: "arm64", libc: "glibc", runner: "ubuntu-24.04-arm" },
  "linux-x64": { os: "linux", cpu: "x64", libc: "glibc", runner: "ubuntu-latest" },
} as const satisfies Readonly<Record<PlatformName, HostedPlatform>>;

class PlatformPackageFault extends Schema.TaggedError<PlatformPackageFault>()("PlatformPackageFault", {
  message: Schema.String,
}) {}

const MainManifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  license: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.Unknown),
  publishConfig: Schema.optionalKey(Schema.Unknown),
});

type MainManifest = typeof MainManifest.Type;

const decodeMainManifest = Schema.decodeUnknownEffect(MainManifest);
const decodeManifestRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

export type PlatformRelease = {
  readonly directory: string;
  readonly binary: string;
  readonly manifest: MainManifest;
  readonly platforms: readonly PlatformTarget[];
};

export const npmManifest = (value: object): string => JSON.stringify(value, null, 2) + "\n";

const packageDirectory = (release: PlatformRelease, platform: PlatformTarget) =>
  Path.Path.use((path) => Effect.succeed(path.resolve(release.directory, "npm", platformPackageOf(release.manifest.name, platform))));

const optionalFields = ({ license, repository, publishConfig }: MainManifest) => ({
  ...(license === undefined ? {} : { license }),
  ...(repository === undefined ? {} : { repository }),
  ...(publishConfig === undefined ? {} : { publishConfig }),
});

const assetOf = (release: PlatformRelease, platform: PlatformTarget) => Path.Path.use((path) => Effect.succeed(path.join(release.directory, assetNameOf(release.binary, platform))));

const missingBinary = Effect.fn("missingBinary")(function* (release: PlatformRelease) {
  const fs = yield* FileSystem.FileSystem;
  for (const platform of release.platforms) {
    const asset = yield* assetOf(release, platform);
    if (!(yield* fs.exists(asset))) return `${asset} is missing, so the ${platformPackageOf(release.manifest.name, platform)} package has no binary to hold`;
  }
  return undefined;
});

const stagePlatform = Effect.fn("stagePlatform")(function* (release: PlatformRelease, platform: PlatformTarget) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const destination = yield* packageDirectory(release, platform);
  const file = packagedBinaryOf(release.binary, release.manifest.version);
  yield* fs.makeDirectory(destination, { recursive: true });
  yield* fs.copyFile(yield* assetOf(release, platform), path.join(destination, file));
  yield* fs.chmod(path.join(destination, file), 0o755);
  yield* fs.writeFileString(path.join(destination, MANIFEST), npmManifest({
    name: platformPackageOf(release.manifest.name, platform),
    version: release.manifest.version,
    os: [platform.os],
    cpu: [platform.cpu],
    ...(platform.libc === undefined ? {} : { libc: [platform.libc] }),
    files: [file],
    ...optionalFields(release.manifest),
  }));
});

const stageEach = Effect.fn("stageEach")(function* (release: PlatformRelease) {
  for (const platform of release.platforms) yield* stagePlatform(release, platform);
});

export const stagePlatformPackages = Effect.fn("stagePlatformPackages")(function* (release: PlatformRelease) {
  const missing = yield* missingBinary(release);
  if (missing !== undefined) return yield* new PlatformPackageFault({ message: missing });
  yield* stageEach(release);
});

export const publishPlatformPackages = Effect.fn("publishPlatformPackages")(function* (release: PlatformRelease) {
  for (const platform of release.platforms) yield* publishPackage(yield* packageDirectory(release, platform));
});

export const withOptionalDependencies = (manifest: Readonly<Record<string, unknown>>, release: PlatformRelease): Readonly<Record<string, unknown>> => {
  const held = manifest["optionalDependencies"];
  const kept = typeof held === "object" && held !== null ? held : {};
  const added = Object.fromEntries(release.platforms.map((platform) => [platformPackageOf(release.manifest.name, platform), release.manifest.version]));
  return { ...manifest, optionalDependencies: { ...kept, ...added } };
};

const configuredPackages = Effect.fn("configuredPackages")(function* (root: string) {
  const configured = (yield* loadSettings(root))["platformPackages"];
  return configured === undefined ? undefined : yield* decodeSetting("platformPackages", PlatformPackages, configured);
});

export type ConfiguredRelease = { readonly release: PlatformRelease; readonly record: Readonly<Record<string, unknown>> };

export const configuredPlatformRelease = Effect.fn("configuredPlatformRelease")(function* (root: string, head: string) {
  const packages = yield* configuredPackages(root);
  if (packages === undefined) return undefined;
  const directory = yield* Config.String(PLATFORM_BINARIES_ENV).pipe(Config.withDefault(""));
  if (directory === "") {
    return yield* new PlatformPackageFault({ message: `${SETTINGS_FILE} sets platformPackages, but ${PLATFORM_BINARIES_ENV} names no directory of built binaries, so run checks-workflows --write` });
  }
  const file = (yield* Path.Path).join(root, MANIFEST);
  const record = yield* (yield* FileSystem.FileSystem).readFileString(file).pipe(Effect.flatMap(decodeManifestRecord));
  const manifest = yield* decodeMainManifest(record).pipe(Effect.mapError((cause) => new PlatformPackageFault({ message: `${MANIFEST}: ${cause.message}` })));
  const release: PlatformRelease = { directory, binary: packages.binary, manifest, platforms: packages.platforms.map((name) => HOSTED_PLATFORMS[name]) };
  const missing = yield* missingBinary(release);
  if (missing !== undefined) {
    return yield* new PlatformPackageFault({ message: `${missing}; this run tags and publishes nothing, so rerun the main run of the release commit ${head.slice(0, 12)}, whose binaries job builds every platform` });
  }
  return { release, record } satisfies ConfiguredRelease;
});

// The main package names the platform packages, so npm must hold each of them before the main package is published.
export const publishPlatformRelease = Effect.fn("publishPlatformRelease")(function* (root: string, { release, record }: ConfiguredRelease) {
  yield* stageEach(release);
  yield* publishPlatformPackages(release);
  yield* (yield* FileSystem.FileSystem).writeFileString((yield* Path.Path).join(root, MANIFEST), npmManifest(withOptionalDependencies(record, release)));
});
