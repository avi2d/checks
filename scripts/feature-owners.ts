#!/usr/bin/env bun
import { parse } from "@swc/core";
import { Console, Effect, Path, Schema } from "effect";
import { changedPaths, git, pathsAt, rangeEnds, type Change } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { PROOF_DIRECTORY, readQuality, type Feature } from "./quality-file.ts";

type Unproven = {
  readonly feature: string;
  readonly reason: string;
};

type Touch = {
  readonly feature: string;
  readonly paths: readonly string[];
};

class ProofUnparsed extends Schema.TaggedError<ProofUnparsed>()("ProofUnparsed", {
  message: Schema.String,
}) {}

const NAME = "feature-owners";
const USAGE = "usage: feature-owners.ts <ref> | <base-ref> <head-ref>";
const RELATIVE = /^\.\.?\//;
const SCRIPT_EXTENSIONS = new Map([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
]);

const runtimeSpecifiers = Effect.fn("runtimeSpecifiers")(function* (file: string, source: string) {
  const module = yield* Effect.tryPromise({
    try: () => parse(source, { syntax: "typescript", tsx: file.endsWith(".tsx"), target: "esnext" }),
    catch: (error) => new ProofUnparsed({ message: `${file} does not parse: ${String(error)}` }),
  });
  return module.body.flatMap((item) => {
    if (item.type === "ImportDeclaration" && !item.typeOnly) return [item.source.value];
    if (item.type === "ExportNamedDeclaration" && !item.typeOnly && item.source !== undefined) return [item.source.value];
    if (item.type === "ExportAllDeclaration") return [item.source.value];
    return [];
  });
});

const candidatesFor = Effect.fn("candidatesFor")(function* (importer: string, specifier: string) {
  if (!RELATIVE.test(specifier)) return [];
  const path = yield* Path.Path;
  const target = path.join(path.dirname(importer), specifier);
  const extension = path.extname(target);
  const sources = SCRIPT_EXTENSIONS.get(extension);
  if (sources !== undefined) return [target, ...sources.map((source) => `${target.slice(0, -extension.length)}${source}`)];
  if (extension !== "") return [target];
  return [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`];
});

const proofImportsAnEntry = Effect.fn("proofImportsAnEntry")(function* (root: string, head: string, feature: Feature) {
  const source = yield* git(["cat-file", "blob", `${head}:${feature.proof}`], root);
  const specifiers = yield* runtimeSpecifiers(feature.proof, source);
  const reached = yield* Effect.forEach(specifiers, (specifier) => candidatesFor(feature.proof, specifier));
  return reached.flat().some((path) => feature.entries.includes(path));
});

const unproven = Effect.fn("unproven")(function* (root: string, head: string, features: readonly Feature[]) {
  const declared = features.flatMap((feature) => [feature.proof, ...feature.entries]);
  const present = new Set(yield* pathsAt(head, declared.map((path) => `:(literal)${path}`), root));
  const found: Unproven[] = [];
  for (const feature of features) {
    const refuse = (reason: string) => found.push({ feature: feature.name, reason });
    for (const entry of feature.entries.filter((path) => !present.has(path))) refuse(`entry ${entry} is not in the head commit`);
    if (!present.has(feature.proof)) {
      refuse(`proof ${feature.proof} is not in the head commit`);
      continue;
    }
    const reason = yield* proofImportsAnEntry(root, head, feature).pipe(
      Effect.map((imports) => (imports ? undefined : `proof ${feature.proof} imports none of its entries, ${feature.entries.join(", ")}`)),
      Effect.catchTag("ProofUnparsed", (error) => Effect.succeed(`proof ${error.message}`)),
    );
    if (reason !== undefined) refuse(reason);
  }
  return found;
});

function ownerOf(features: readonly Feature[], path: string): string | undefined {
  return features.find((feature) => path.startsWith(`${feature.root}/`) || path === feature.proof)?.name;
}

function touches(features: readonly Feature[], changes: readonly Change[]): readonly Touch[] {
  const byOwner = new Map<string, string[]>();
  for (const change of changes) {
    for (const path of change.kind === "renamed" ? [change.from, change.path] : [change.path]) {
      const owner = ownerOf(features, path);
      if (owner === undefined) continue;
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), path]);
    }
  }
  return features.flatMap((feature) => {
    const paths = byOwner.get(feature.name);
    return paths === undefined ? [] : [{ feature: feature.name, paths }];
  });
}

function proofReport(features: readonly Feature[], found: readonly Unproven[]): string {
  if (found.length === 0) {
    return `${NAME}: ${features.length} feature(s) keep a proof under ${PROOF_DIRECTORY} that imports an entry`;
  }
  return [
    `${NAME}: ${found.length} problem(s) with the features' runnable proofs:`,
    ...found.map(({ feature, reason }) => `  ${feature}: ${reason}`),
  ].join("\n");
}

function signalReport(touched: readonly Touch[]): string {
  if (touched.length === 0) return `${NAME}: advisory, the range touches no feature owner`;
  const judge = touched.length > 1 ? "; a reviewer judges whether they make one slice" : "";
  return [
    `${NAME}: advisory, the range touches ${touched.length} feature owner(s)${judge}:`,
    ...touched.map(({ feature, paths }) => `  ${feature}: ${paths.join(", ")}`),
  ].join("\n");
}

const owners = Effect.gen(function* () {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });

  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const { source, quality } = yield* readQuality(root);
  const features = quality.features ?? [];
  if (features.length === 0) {
    yield* Console.log(`${NAME}: ${source} declares no feature`);
    return true;
  }
  const { base, head } = yield* rangeEnds(first, second, root);
  const found = yield* unproven(root, head, features);
  yield* Console.log(proofReport(features, found));
  if (quality.changeSignal === "advisory") {
    yield* Console.log(signalReport(touches(features, yield* changedPaths(base, head, [], root))));
  }
  return found.length === 0;
});

if (import.meta.main) runMain(NAME, owners);
