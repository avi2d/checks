import { Effect, Schema } from "effect";
import { ADR_DIRECTORY, ADR_INDEX, ROOT_FILES } from "./doc-rules.ts";
import { listed, templateFile } from "./doc-templates.ts";
import { EVERY_REPOSITORY, KIT_GATES, QUALITY_FILE } from "./gates.ts";
import { AGENT_NAMES, DATED_RECORD_EXAMPLES, DOCS_DIRECTORY, HISTORY_NAMES, LIVING_NAMES, PROSE_RULES } from "./prose-matchers.ts";
import { LegacyManifest, MODES, Quality } from "./quality-file.ts";
import { SIZE_DEFAULTS, SIZE_RULES, qualifiedName, type Budget } from "./size-rules.ts";

export const MANIFEST = "package.json";
export const BUN_VERSION = ".bun-version";
export const GATE_PAGES = "docs/gates";

const Manifest = Schema.Struct({
  name: Schema.String,
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  devDependencies: Schema.Struct({ typescript: Schema.String }),
  files: Schema.Array(Schema.String),
});

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/, { message: "is not a version such as 1.2.3" }));

const SHIPPED = {
  "CHANGELOG.md": "every release, and what it changed",
  "CONTRIBUTING.md": "how this repository is developed and released",
  "docs/": "a reference page per bin and per shared config, and why the kit is shaped this way",
  "bunfig.toml": "the bunfig preset a repository copies",
  "commitlint.config.js": "the shared commitlint config",
  "dependency-cruiser.config.js": "the shared dependency-cruiser base",
  "scripts/": "every bin, which a package script calls by its `checks-` name",
  "templates/": "one template per kind of doc file, which a new doc file starts from",
  "presets/": "the Effect rule blocks `checks-quality generate` writes into the fragments",
  "quality.schema.json": "the schema of `quality.json`, which its `$schema` line names",
  "oxlintrc.json": "the oxlint base config `.oxlintrc.json` extends",
  "stryker.preset.js": "the Stryker mutation-testing preset",
  "tsconfig.effect.json": "the tsconfig fragment with the Effect language-service block",
  "dist/": "the compiled oxlint plugin with the Effect error-channel and cognitive complexity rules, and `featureRules`",
} as const;

type ShippedPath = keyof typeof SHIPPED;

function isShipped(path: string): path is ShippedPath {
  return Object.hasOwn(SHIPPED, path);
}

export type KitFacts = {
  readonly manifest: typeof Manifest.Type;
  readonly bun: string;
  readonly shipped: readonly ShippedPath[];
};

export class DocBlocksUnwritable extends Schema.TaggedError<DocBlocksUnwritable>()("DocBlocksUnwritable", {
  message: Schema.String,
}) {}

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));
const decodeVersion = Schema.decodeUnknownEffect(Version);

function topLevel(file: string): string {
  return file.includes("/") ? file.slice(0, file.indexOf("/") + 1) : file;
}

function shippedPaths({ files }: typeof Manifest.Type): Effect.Effect<readonly ShippedPath[], DocBlocksUnwritable> {
  const paths = [...new Set(files.map(topLevel))];
  const unrowed = paths.filter((path) => !isShipped(path));
  const unshipped = Object.keys(SHIPPED).filter((path) => !paths.includes(path));
  if (unrowed.length === 0 && unshipped.length === 0) return Effect.succeed(paths.filter(isShipped));
  const problems = [
    ...unrowed.map((path) => `files ships ${path}, which SHIPPED in scripts/doc-blocks.ts has no row for`),
    ...unshipped.map((path) => `SHIPPED in scripts/doc-blocks.ts has a row for ${path}, which files does not ship`),
  ];
  return Effect.fail(new DocBlocksUnwritable({ message: `${MANIFEST}: ${problems.join("; ")}` }));
}

export const kitFacts = (manifest: string, bunVersion: string): Effect.Effect<KitFacts, DocBlocksUnwritable> =>
  Effect.gen(function* () {
    const decoded = yield* decodeManifest(manifest).pipe(Effect.mapError(({ message }) => new DocBlocksUnwritable({ message: `${MANIFEST}: ${message}` })));
    const bun = yield* decodeVersion(bunVersion.trim()).pipe(Effect.mapError(({ message }) => new DocBlocksUnwritable({ message: `${BUN_VERSION}: ${message}` })));
    return { manifest: decoded, bun, shipped: yield* shippedPaths(decoded) };
  });

export type Block = {
  readonly name: string;
  readonly from: readonly string[];
  readonly render: (facts: KitFacts) => readonly string[];
};

function code(text: string): string {
  return `\`${text}\``;
}

function peers({ peerDependencies }: KitFacts["manifest"]): readonly (readonly [name: string, version: string])[] {
  return Object.entries(peerDependencies).toSorted(([a], [b]) => (a < b ? -1 : 1));
}

const PREREQUISITES: Block = {
  name: "prerequisites",
  from: [MANIFEST, BUN_VERSION],
  render: ({ manifest, bun }) => [
    "- A git repository, whose history the range gates read.",
    `- Bun ${bun}, which runs every bin.`,
    `- TypeScript ${manifest.devDependencies.typescript}, whose ${code("tsc")} the ${code("typecheck")} script runs.`,
    "- The peer dependencies, at the exact versions the kit pins:",
    ...peers(manifest).map(([name, version]) => `  - ${code(name)} ${version}`),
  ],
};

// typescript is not a peer, since no bin imports it, yet the typecheck script the install adds runs its tsc.
export const INSTALL: Block = {
  name: "install",
  from: [MANIFEST],
  render: ({ manifest }) => [
    "```sh",
    [
      "bun add -d",
      manifest.name,
      ...peers(manifest).map(([name, version]) => `${name}@${version}`),
      `typescript@${manifest.devDependencies.typescript}`,
    ].join(" "),
    "```",
  ],
};

const READS = { tree: "the working tree", range: "the range" } as const;

const GATES: Block = {
  name: "gates",
  from: ["KIT_GATES in scripts/gates.ts"],
  render: () => [
    "| Gate | Reads | Runs in |",
    "| --- | --- | --- |",
    ...KIT_GATES.map(({ bin, reads, appliesTo }) => {
      const runsIn = appliesTo === EVERY_REPOSITORY ? appliesTo : `a repository tracking ${appliesTo.pathspecs.map(code).join(" or ")}`;
      return `| [${code(bin)}](${GATE_PAGES}/${bin}.md) | ${READS[reads]} | ${runsIn} |`;
    }),
  ],
};

const DOC_KINDS: Block = {
  name: "doc-kinds",
  from: ["scripts/doc-rules.ts", "scripts/quality-file.ts", "scripts/doc-templates.ts"],
  render: () => [
    "| File | Kind | Template |",
    "| --- | --- | --- |",
    ...[...ROOT_FILES].map(([path, kind]) => `| ${code(path)} | ${kind} | ${code(templateFile(kind))} |`),
    `| each file in ${code(ADR_DIRECTORY)} but its generated index, ${code(ADR_INDEX.slice(ADR_DIRECTORY.length))} | adr | ${code(templateFile("adr"))} |`,
    `| a page ${code("docs.pages")} declares | ${listed(MODES)} | ${code("templates/<mode>.md")} |`,
  ],
};

const LIVING_DOCS: Block = {
  name: "living-docs",
  from: ["scripts/prose-matchers.ts"],
  render: () => [
    "A living doc is one of these:",
    "",
    `- a ${listed(LIVING_NAMES.map(code))} in any directory`,
    `- a Markdown page under ${code(DOCS_DIRECTORY)}`,
    "",
    `An agent file is a ${listed(AGENT_NAMES.map(code))} in any directory, and takes only the rules the table below marks for agent files.`,
    "",
    "These are records, and take no prose rule:",
    "",
    `- a file in ${code(ADR_DIRECTORY)}`,
    `- a file whose name opens with four digits, as in ${listed(DATED_RECORD_EXAMPLES.map(code))}`,
    `- a ${listed(HISTORY_NAMES.map(code))}`,
  ],
};

const PROSE: Block = {
  name: "prose-rules",
  from: ["PROSE_RULES in scripts/prose-matchers.ts"],
  render: () => [
    "| Refused | For example | Write instead | In agent files |",
    "| --- | --- | --- | --- |",
    ...PROSE_RULES.map(({ readers, refuses, example, instead }) => `| ${refuses} | ${example} | ${instead} | ${readers.includes("agents") ? "yes" : "no"} |`),
  ],
};

type Subkeys<Field> = Field extends { readonly schema: { readonly fields: infer Sub } } ? keyof Sub & string : never;

type Described<Fields, Cell> = {
  readonly [K in keyof Fields & string]-?: [Subkeys<Fields[K]>] extends [never] ? Cell : Cell | { readonly [S in Subkeys<Fields[K]>]-?: Cell };
};

type Dotted<Fields> = { readonly [K in keyof Fields & string]: K | `${K}.${Subkeys<Fields[K]>}` }[keyof Fields & string];

type Nested<Cell> = { readonly [key: string]: Cell | { readonly [sub: string]: Cell } };

function flatten<Cell>(described: Nested<Cell>, isCell: (entry: Nested<Cell>[string]) => entry is Cell): readonly (readonly [key: string, cell: Cell])[] {
  return Object.entries(described).flatMap(([key, entry]) =>
    isCell(entry) ? [[key, entry] as const] : Object.entries(entry).map(([sub, cell]) => [`${key}.${sub}`, cell] as const),
  );
}

type QualityFields = Omit<typeof Quality.fields, "$schema">;

type KeyRow = { readonly readBy: string; readonly holds: string };

const QUALITY_ROWS: Described<QualityFields, KeyRow> = {
  defaultBranch: { readBy: "`checks-lint`, `checks-ci-wiring`, `checks-quality`", holds: "the branch pull requests merge into, `main` when absent" },
  gates: {
    ci: { readBy: "`checks-ci-wiring`, `checks-quality`", holds: "the commands CI runs on every pull request, as [checks-ci-wiring](../gates/checks-ci-wiring.md) says" },
    scheduled: { readBy: "`checks-ci-wiring`", holds: "the commands a schedule runs" },
    lint: {
      readBy: "`checks-lint`, `checks-ci-wiring`",
      holds: "the gates `checks-lint` runs when not all apply, as [Gate selection](../gates/checks-lint.md#gate-selection) says",
    },
  },
  runsOn: {
    readBy: "`checks-quality`",
    holds: "the runner labels every job the ci and commitlint workflows run on, `ubuntu-latest` when absent",
  },
  commitIdentity: {
    authors: {
      readBy: "`checks-commit-identity`",
      holds: "the identities allowed to author and commit, as [checks-commit-identity](../gates/checks-commit-identity.md) says",
    },
  },
  sources: {
    production: {
      readBy: "`checks-size-budget`, `checks-repetition`, `checks-quality`",
      holds:
        "the source the repository ships, as [checks-size-budget](../gates/checks-size-budget.md) and [checks-repetition](../gates/checks-repetition.md) say",
    },
    effect: {
      readBy: "`checks-quality`",
      holds: "the paths held to the Effect rules, and the files under them that are not, as [The Effect rules](effect-rules.md) says",
    },
    libraries: {
      readBy: "`checks-vendor`, `checks-test-layout`",
      holds: "the libraries pinned to a shared read-only clone, as [checks-vendor](../gates/checks-vendor.md) says",
    },
  },
  size: {
    readBy: "`checks-size-budget`",
    holds: "the size budget of production and test files, and how a change is held to it, as [checks-size-budget](../gates/checks-size-budget.md) says",
  },
  features: {
    readBy: "`featureRules`, `checks-feature-owners`",
    holds: "each feature's root, entries, exempt importers and proof, as [checks-feature-owners](../gates/checks-feature-owners.md) says",
  },
  changeSignal: { readBy: "`checks-feature-owners`", holds: "`advisory` to list the feature owners a change touches" },
  agentRules: {
    on: { readBy: "agent Rule selection, not the kit", holds: "catalogued Rules switched on for this repository" },
    off: { readBy: "agent Rule selection, not the kit", holds: "catalogued Rules switched off for this repository" },
  },
  docs: {
    pages: { readBy: "`checks-docs`", holds: "the Diátaxis mode of each page, by glob, as [checks-docs](../gates/checks-docs.md) says" },
    forConsumers: {
      readBy: "`checks-docs`",
      holds: "the living docs that speak to a repository installing this one, by glob, whose `bun run` commands name that repository's scripts",
    },
  },
};

const QUALITY_KEYS: Block = {
  name: "quality-keys",
  from: ["Quality in scripts/quality-file.ts"],
  render: () => [
    "| Key | Read by | Holds |",
    "| --- | --- | --- |",
    ...flatten<KeyRow>(QUALITY_ROWS, (entry): entry is KeyRow => "holds" in entry).map(([key, { readBy, holds }]) => `| ${code(key)} | ${readBy} | ${holds} |`),
  ],
};

const MOVED_KEYS: Described<typeof LegacyManifest.fields, Dotted<QualityFields>> = {
  ciWiring: { gates: "gates.ci", scheduled: "gates.scheduled", lintGates: "gates.lint", defaultBranch: "defaultBranch" },
  commitIdentity: "commitIdentity",
};

const LEGACY_KEYS: Block = {
  name: "legacy-keys",
  from: ["LegacyManifest in scripts/quality-file.ts", "QUALITY_FILE in scripts/gates.ts"],
  render: () => [
    `| ${code(MANIFEST)} | ${code(QUALITY_FILE)} |`,
    "| --- | --- |",
    ...flatten<Dotted<QualityFields>>(MOVED_KEYS, (entry) => typeof entry === "string").map(([legacy, key]) => `| ${code(legacy)} | ${code(key)} |`),
  ],
};

function limitOf(budget: Budget, key: keyof Budget): string {
  return String(budget[key] ?? "none");
}

const SIZE_LIMITS: Block = {
  name: "size-limits",
  from: ["SIZE_RULES and SIZE_DEFAULTS in scripts/size-rules.ts"],
  render: () => [
    "| Key | Limits | oxlint rule | Production | Tests |",
    "| --- | --- | --- | --- | --- |",
    ...SIZE_RULES.map(
      (entry) =>
        `| ${code(entry.key)} | ${entry.limits} | ${code(qualifiedName(entry))} | ${limitOf(SIZE_DEFAULTS.production, entry.key)} | ${limitOf(SIZE_DEFAULTS.tests, entry.key)} |`,
    ),
  ],
};

const WHERE: Block = {
  name: "shipped",
  from: [MANIFEST],
  render: ({ shipped }) => ["| Path | What it holds |", "| --- | --- |", ...shipped.map((path) => `| ${code(path)} | ${SHIPPED[path]} |`)],
};

export const TARGETS: readonly { readonly file: string; readonly blocks: readonly Block[] }[] = [
  { file: "README.md", blocks: [PREREQUISITES, INSTALL, GATES, WHERE] },
  { file: `${GATE_PAGES}/checks-docs.md`, blocks: [DOC_KINDS, LIVING_DOCS, PROSE] },
  { file: `${GATE_PAGES}/checks-size-budget.md`, blocks: [SIZE_LIMITS] },
  { file: "docs/configs/quality-file.md", blocks: [QUALITY_KEYS, LEGACY_KEYS] },
];

export type Spliced = { readonly type: "spliced"; readonly text: string } | { readonly type: "unmarked"; readonly blocks: readonly string[] };

function opening(block: Block): string {
  const sources = [...block.from, "scripts/doc-blocks.ts"];
  return `<!-- generated ${block.name}: bun run build writes it from ${sources.slice(0, -1).join(", ")} and ${sources.at(-1) ?? ""} -->`;
}

function closing(block: Block): string {
  return `<!-- end generated ${block.name} -->`;
}

function spliceBlock(lines: readonly string[], block: Block, facts: KitFacts): readonly string[] | undefined {
  const start = lines.findIndex((line) => line.trimStart().startsWith(`<!-- generated ${block.name}:`));
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.trim() === closing(block));
  if (end === -1) return undefined;
  const indent = /^\s*/.exec(lines[start] ?? "")?.[0] ?? "";
  const written = [opening(block), "", ...block.render(facts), "", closing(block)].map((line) => (line === "" ? "" : `${indent}${line}`));
  return [...lines.slice(0, start), ...written, ...lines.slice(end + 1)];
}

export function splice(text: string, blocks: readonly Block[], facts: KitFacts): Spliced {
  const unmarked: string[] = [];
  let lines: readonly string[] = text.split("\n");
  for (const block of blocks) {
    const spliced = spliceBlock(lines, block, facts);
    if (spliced === undefined) unmarked.push(block.name);
    else lines = spliced;
  }
  return unmarked.length === 0 ? { type: "spliced", text: lines.join("\n") } : { type: "unmarked", blocks: unmarked };
}
