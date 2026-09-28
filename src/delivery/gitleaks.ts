import { Effect, Option, Path, Schema } from "effect";
import { collect } from "../core/git.ts";
import { installPinned } from "../dependencies/pinned-binary.ts";

const GITLEAKS_VERSION = "8.30.1";
const RELEASES = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`;
const MEMBER = "gitleaks";

type Build = { readonly archive: string; readonly sha256: string; readonly binarySha256: string };

// The archive's SHA-256 as gitleaks_<version>_checksums.txt of the release lists it, and the SHA-256 of the binary inside.
const BUILDS: Readonly<Record<string, Build>> = {
  "darwin-arm64": {
    archive: `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`,
    sha256: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    binarySha256: "ba52fb1bfabbcde42f032afad3d6e0b19dff8ed105229a16e7caa338bbc0e84f",
  },
  "darwin-x64": {
    archive: `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`,
    sha256: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
    binarySha256: "cee01fea7173f1b779dff188e1c26ecbcb4027d394acc573b23aaf0be260e291",
  },
  "linux-arm64": {
    archive: `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`,
    sha256: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
    binarySha256: "00e91bbe655bd7c47753e8cfe61cb76ea1a5d7e7702fe161ee40102b46b3823b",
  },
  "linux-x64": {
    archive: `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
    sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    binarySha256: "88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509",
  },
};

class GitleaksError extends Schema.TaggedError<GitleaksError>()("GitleaksError", {
  message: Schema.String,
}) {}

export function gitleaksBuildFor(platform: string, arch: string): Option.Option<Build> {
  return Option.fromNullishOr(BUILDS[`${platform}-${arch}`]);
}

export const pinnedGitleaks = Effect.fn("pinnedGitleaks")(function* (cache: string) {
  const build = gitleaksBuildFor(process.platform, process.arch);
  if (Option.isNone(build)) {
    return yield* new GitleaksError({ message: `no pinned gitleaks build runs on ${process.platform}-${process.arch}` });
  }
  const path = yield* Path.Path;
  const { archive, sha256, binarySha256 } = build.value;
  return yield* installPinned(
    { kind: "tar.gz", url: `${RELEASES}/${archive}`, sha256, member: MEMBER, memberSha256: binarySha256 },
    path.join(cache, "gitleaks", GITLEAKS_VERSION, MEMBER),
  );
});

const Leak = Schema.Struct({
  RuleID: Schema.String,
  Description: Schema.String,
  File: Schema.String,
  StartLine: Schema.Int,
  StartColumn: Schema.Int,
  Commit: Schema.String,
});

export type Leak = typeof Leak.Type;

const decodeGitleaksReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Leak)));

export type Scan = {
  readonly binary: string;
  readonly gitDir: string;
  readonly commits: string;
  readonly config: string;
  readonly ignoreDir: string;
};

// gitleaks exits 1 both on a leak and on a fatal error, so it exits 0 on a leak here and the report alone tells them apart.
// It reads a .gitleaksignore at its source whatever --gitleaks-ignore-path says, so the source is the git directory, where no tracked file lands.
export const scanCommits = Effect.fn("scanCommits")(function* ({ binary, gitDir, commits, config, ignoreDir }: Scan) {
  const args = [
    "git",
    gitDir,
    "--log-opts",
    commits,
    "--config",
    config,
    "--gitleaks-ignore-path",
    ignoreDir,
    "--ignore-gitleaks-allow",
    "--redact",
    "--no-banner",
    "--log-level",
    "error",
    "--exit-code",
    "0",
    "--report-format",
    "json",
    "--report-path",
    "-",
  ];
  const { stdout, stderr, exitCode } = yield* collect(binary, args, ignoreDir).pipe(
    Effect.mapError((cause) => new GitleaksError({ message: `cannot run ${binary}: ${cause.message}` })),
  );
  if (exitCode !== 0) return yield* new GitleaksError({ message: `${binary} exited ${exitCode}: ${stderr.trim()}` });
  return yield* decodeGitleaksReport(stdout).pipe(
    Effect.mapError((cause) => new GitleaksError({ message: `cannot read the report gitleaks wrote: ${cause.message}` })),
  );
});
