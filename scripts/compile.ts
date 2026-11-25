import { Effect, FileSystem, Path } from "effect";
import manifest from "../package.json";
import { runMain, Usage } from "../src/core/main.ts";
import { commands } from "./cli-sources.ts";

const dispatcher = [
  'import { selectSource } from "./native-meta.ts";',
  'import { defineConfig } from "../src/quality/config.ts";',
  `Bun.plugin({ name: "compiled checks config", setup(build) { build.module("${manifest.name}/config", () => ({ exports: { defineConfig }, loader: "object" })); } });`,
  'const [command, root, bun] = process.argv.slice(2);',
  'switch (command) {',
  `case "--version": console.log(${JSON.stringify(manifest.version)}); break;`,
  ...commands.map(({ name, source }) => `case "${name}": selectSource(root, "${source}", bun); await import("../${source}"); break;`),
  'default: console.error(`checks: no compiled check is named ${command}`); process.exitCode = 2;',
  '}',
].join("\n");

const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", define: { "import.meta": "kitMeta", "process.execPath": "kitMeta.bun" } });

const virtualSources = Effect.fn("virtualSources")(function* (root: string, entry: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sources: Record<string, string> = { [entry]: dispatcher };
  const directory = path.join(root, "src");
  for (const file of yield* fs.readDirectory(directory, { recursive: true })) {
    if (!file.endsWith(".ts")) continue;
    const full = path.join(directory, file);
    const text = yield* fs.readFileString(full);
    if (!text.includes("import.meta") && !text.includes("process.execPath")) continue;
    const helper = path.relative(path.dirname(full), path.join(root, "scripts/native-meta.ts"));
    const prelude = `import { packageMeta } from "${helper}"; const kitMeta = packageMeta(${JSON.stringify("src/" + file)});`;
    const js = yield* Effect.tryPromise({ try: () => transpiler.transform(text.replace(/^#![^\n]*\n/, "")), catch: (cause) => new Usage({ message: `${file}: ${String(cause)}` }) });
    sources[full] = prelude + "\n" + js;
  }
  return sources;
});

function installedPeers(root: string): Bun.BunPlugin {
  const peers = new Set(Object.keys(manifest.peerDependenciesMeta));
  return {
    name: "installed optional peers",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, ({ path }) => peers.has(path) ? { path, namespace: "installed-peer" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "installed-peer" }, ({ path }) => ({
        contents: `const { packageMeta } = require(${JSON.stringify(root + "/scripts/native-meta.ts")}); module.exports = require(Bun.fileURLToPath(packageMeta("package.json").resolve(${JSON.stringify(path)})));`,
        loader: "js",
      }));
    },
  };
}

const compile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dir, "..");
  const entry = path.join(root, "scripts/compiled-entry.ts");
  const directory = process.argv[2] ?? path.join(root, "release-assets");
  const name = `checks-${process.platform}-${process.arch}`;
  const outfile = path.join(directory, name);
  yield* fs.makeDirectory(directory, { recursive: true });
  const files = yield* virtualSources(root, entry);
  yield* Effect.tryPromise({
    try: () => Bun.build({ entrypoints: [entry], compile: { outfile, autoloadPackageJson: true }, bytecode: true, format: "esm", plugins: [installedPeers(root)], files }),
    catch: (cause) => new Usage({ message: cause instanceof AggregateError ? cause.errors.map(String).join("\n") : String(cause) }),
  });
  const digest = new Bun.CryptoHasher("sha256").update(yield* fs.readFile(outfile)).digest("hex");
  yield* fs.writeFileString(outfile + ".sha256", `${digest}  ${name}\n`);
  return true;
});

if (import.meta.main) runMain("compile", compile);
