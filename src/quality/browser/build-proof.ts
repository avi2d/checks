import { Console, Effect, FileSystem, Path } from "effect";
import { checkoutFiles, collect, git, pathsAt } from "../../core/git.ts";
import type { RunScope } from "../../core/pull-request-scope.ts";
import { BrowserBuild, decodeSetting, loadSettings } from "../../core/settings.ts";

type PullRequest = Extract<RunScope, { readonly kind: "pull-request" }>;

function testOnly(changed: readonly string[]): boolean {
  return changed.length > 0 && changed.every((file) => file.startsWith("tests/") || /\.test\.[cm]?[jt]sx?$/.test(file));
}

const outputIsComplete = Effect.fn("outputIsComplete")(function* (directory: string) {
  const links = yield* collect("find", [directory, "-type", "l", "-print", "-quit"]);
  const files = yield* collect("find", [directory, "-type", "f", "-print", "-quit"]);
  return links.exitCode === 0 && links.stdout === "" && files.exitCode === 0 && files.stdout !== "";
});

const sameOutput = Effect.fn("sameOutput")(function* (left: string, right: string) {
  if (!(yield* outputIsComplete(left)) || !(yield* outputIsComplete(right))) return false;
  return (yield* collect("diff", ["-qr", "--no-dereference", left, right])).exitCode === 0;
});

const buildAt = Effect.fn("buildAt")(function* (root: string, revision: string, scratch: string, site: string, command: readonly [string, ...string[]]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tree = yield* checkoutFiles(revision, yield* pathsAt(revision, [], root), scratch, root);
  const links = yield* collect("find", [tree, "-type", "l", "-print", "-quit"]);
  if (links.exitCode !== 0 || links.stdout !== "") return undefined;
  const output = path.join(tree, site);
  yield* fs.remove(output, { recursive: true, force: true });
  const built = yield* collect(command[0], command.slice(1), tree);
  return built.exitCode === 0 ? output : undefined;
});

export const identicalTestBuild = Effect.fn("identicalTestBuild")(function* (root: string, site: string, scope: PullRequest) {
  if (!testOnly(scope.changed) || scope.ends === undefined || !/^[a-zA-Z0-9_-]+$/.test(site)) return false;
  const ends = scope.ends;
  const raw = (yield* loadSettings(root))["browserBuild"];
  if (raw === undefined) return false;
  const command = yield* decodeSetting("browserBuild", BrowserBuild, raw);
  const prove = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { base, head } = ends;
    if ((yield* git(["rev-parse", "HEAD"], root)).trim() !== head) return false;
    if ((yield* collect("git", ["diff", "--quiet", "HEAD", "--"], root)).exitCode !== 0) return false;
    const ancestor = (yield* git(["merge-base", base, head], root)).trim();
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-browser-build-" });
    const baseScratch = path.join(scratch, "base");
    const headScratch = path.join(scratch, "head");
    yield* fs.makeDirectory(baseScratch);
    yield* fs.makeDirectory(headScratch);
    const start = Date.now();
    const baseOutput = yield* buildAt(root, ancestor, baseScratch, site, command);
    const headOutput = yield* buildAt(root, head, headScratch, site, command);
    yield* Console.log(`browser: base and head builds took ${Date.now() - start} ms`);
    if (baseOutput === undefined || headOutput === undefined) return false;
    return (yield* sameOutput(baseOutput, headOutput)) && (yield* sameOutput(headOutput, path.join(root, site)));
  }).pipe(Effect.scoped, Effect.orElseSucceed(() => false));
  return yield* prove;
});
