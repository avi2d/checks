#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import kitOxlint from "../oxlintrc.json" with { type: "json" };
import effectLanguageService from "../presets/effect.language-service.json" with { type: "json" };
import effectOxlint from "../presets/effect.oxlint.json" with { type: "json" };
import { git } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { readQuality, renderJson, type Quality } from "./quality-file.ts";

// oxlint resolves an override's files, and the language service an override's include, against the
// directory of the config that holds it, so a fragment anywhere but the root matches nothing there.
export const OXLINT_FRAGMENT = "oxlintrc.quality.json";
export const TSCONFIG_FRAGMENT = "tsconfig.quality.json";

const NAME = "checks-quality";
const USAGE = `usage: ${NAME} --check | generate`;
const GENERATE = `${NAME} generate`;

type EffectSources = NonNullable<NonNullable<Quality["sources"]>["effect"]>;

export type Fragment = {
  readonly file: typeof OXLINT_FRAGMENT | typeof TSCONFIG_FRAGMENT;
  readonly extendedBy: string;
  readonly reader: string;
  readonly content: unknown;
};

class NativeConfigUnreadable extends Schema.TaggedError<NativeConfigUnreadable>()("NativeConfigUnreadable", {
  message: Schema.String,
}) {}

function oxlintFragment({ paths, exempt = [] }: EffectSources): unknown {
  const override = {
    files: paths,
    ...(exempt.length === 0 ? {} : { excludeFiles: exempt }),
    // An override that leaves out any of the kit's plugins turns on the category rules of the ones it adds.
    plugins: [...kitOxlint.plugins, ...effectOxlint.plugins.filter((plugin) => !kitOxlint.plugins.includes(plugin))],
    rules: effectOxlint.rules,
  };
  return {
    $schema: "./node_modules/oxlint/configuration_schema.json",
    // A config without plugins brings oxlint's default plugins into the one extending it.
    plugins: kitOxlint.plugins,
    overrides: [override],
  };
}

function tsconfigFragment({ paths, exempt = [] }: EffectSources): unknown {
  const override = { include: paths, ...(exempt.length === 0 ? {} : { exclude: exempt }), options: effectLanguageService };
  return { compilerOptions: { plugins: [{ name: "@effect/language-service", overrides: [override] }] } };
}

const FRAGMENTS = [
  { file: OXLINT_FRAGMENT, extendedBy: ".oxlintrc.json", reader: "oxlint", build: oxlintFragment },
  { file: TSCONFIG_FRAGMENT, extendedBy: "tsconfig.json", reader: "the language service", build: tsconfigFragment },
] as const;

export function fragmentsFor(quality: Quality): readonly Fragment[] {
  const effect = quality.sources?.effect;
  if (effect === undefined) return [];
  return FRAGMENTS.map(({ build, ...fragment }) => ({ ...fragment, content: build(effect) }));
}

const NativeConfig = Schema.Struct({
  extends: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
});
const decodeNativeConfig = Schema.decodeUnknownEffect(NativeConfig);

const parseJsonc = (text: string, file: string) =>
  Effect.try({
    try: (): unknown => Bun.JSONC.parse(text),
    catch: (error) => new NativeConfigUnreadable({ message: `cannot parse ${file}: ${String(error)}` }),
  });

const extendsOf = Effect.fn("extendsOf")(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(root, file);
  if (!(yield* fs.exists(target))) return [];
  const config = yield* fs.readFileString(target).pipe(
    Effect.flatMap((text) => parseJsonc(text, file)),
    Effect.flatMap(decodeNativeConfig),
    Effect.mapError((cause) => new NativeConfigUnreadable({ message: `cannot read extends from ${file}: ${cause.message}` })),
  );
  const listed = config.extends ?? [];
  return (typeof listed === "string" ? [listed] : listed).map((entry) => path.normalize(entry));
});

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const sameJson = (text: string, content: unknown): Effect.Effect<boolean> =>
  decodeJson(text).pipe(
    Effect.map((parsed) => Bun.deepEquals(parsed, content, true)),
    Effect.orElseSucceed(() => false),
  );

const fragmentProblems = Effect.fn("fragmentProblems")(function* (root: string, source: string, expected: readonly Fragment[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const problems: string[] = [];
  for (const { file } of FRAGMENTS) {
    const target = path.join(root, file);
    const fragment = expected.find((candidate) => candidate.file === file);
    const present = yield* fs.exists(target);
    if (fragment === undefined) {
      if (present) problems.push(`${file} is left over, since no sources.effect is declared; run ${GENERATE}`);
      continue;
    }
    if (!present) {
      problems.push(`${file} is missing; run ${GENERATE}`);
    } else if (!(yield* sameJson(yield* fs.readFileString(target), fragment.content))) {
      problems.push(`${file} is stale against ${source} and the kit's presets; run ${GENERATE}`);
    }
    if (!(yield* extendsOf(root, fragment.extendedBy)).includes(file)) {
      problems.push(`${fragment.extendedBy} does not extend ./${file}, so ${fragment.reader} never reads it`);
    }
  }
  return problems;
});

const unmatchedPaths = Effect.fn("unmatchedPaths")(function* (root: string, quality: Quality) {
  const declared = [
    ...(quality.sources?.production ?? []).map((glob) => ({
      glob,
      key: "sources.production",
      holds: "no source to checks-size-budget or checks-repetition",
    })),
    ...(quality.sources?.effect?.paths ?? []).map((glob) => ({ glob, key: "sources.effect.paths", holds: "nothing to the Effect rules" })),
  ];
  const problems: string[] = [];
  for (const { glob, key, holds } of declared) {
    const matched = yield* git(["ls-files", "--cached", "--others", "--exclude-standard", "--", `:(glob)${glob}`], root);
    if (matched.trim() === "") problems.push(`${key} ${glob} matches no file, so it holds ${holds}`);
  }
  return problems;
});

const check = Effect.fn("check")(function* (root: string) {
  const { source, quality } = yield* readQuality(root);
  const expected = fragmentsFor(quality);
  const problems = [...(yield* fragmentProblems(root, source, expected)), ...(yield* unmatchedPaths(root, quality))];
  if (problems.length > 0) {
    yield* Console.error([`${NAME}: ${problems.length} problem(s) with what ${source} declares:`, ...problems.map((line) => `  ${line}`)].join("\n"));
    return false;
  }
  yield* Console.log(
    expected.length === 0
      ? `${NAME}: no sources.effect is declared, so nothing is generated`
      : `${NAME}: ${expected.map((fragment) => fragment.file).join(" and ")} hold what ${source} declares`,
  );
  return true;
});

const generate = Effect.fn("generate")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { quality } = yield* readQuality(root);
  const expected = fragmentsFor(quality);
  for (const { file } of FRAGMENTS) {
    const target = path.join(root, file);
    const fragment = expected.find((candidate) => candidate.file === file);
    if (fragment !== undefined) {
      yield* fs.writeFileString(target, renderJson(fragment.content));
      yield* Console.log(`${NAME}: wrote ${file}`);
    } else if (yield* fs.exists(target)) {
      yield* fs.remove(target);
      yield* Console.log(`${NAME}: removed ${file}`);
    }
  }
  return yield* check(root);
});

const main = Effect.gen(function* () {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || (mode !== "--check" && mode !== "generate")) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  return mode === "generate" ? yield* generate(root) : yield* check(root);
});

if (import.meta.main) runMain(NAME, main);
