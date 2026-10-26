import { Effect, Schema } from "effect";
import { ADR_DIRECTORY, ADR_INDEX, ROOT_FILES } from "../src/docs/doc-rules.ts";
import { listed, MODES, templateFile } from "../src/docs/doc-templates.ts";
import { EVERY_REPOSITORY, KIT_GATES, VECTORS, type KitGate } from "../src/core/gates.ts";
import { AGENT_NAMES, DATED_RECORD_EXAMPLES, DOCS_DIRECTORY, HISTORY_NAMES, LIVING_NAMES, PROSE_RULES } from "../src/docs/prose-matchers.ts";
import { SOURCE_LIMITS, SOURCES, TEST_LIMITS, TESTS, type SizeRule } from "../src/quality/presets/oxlint.ts";

export const MANIFEST = "package.json";
export const GATE_PAGES = "docs/gates";
export const BINS_PAGE = "docs/bins.md";
const OXLINT_PRESET = "src/quality/presets/oxlint.ts";

const Manifest = Schema.Struct({
  name: Schema.String,
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependenciesMeta: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) }))),
  files: Schema.Array(Schema.String),
});

const SHIPPED = {
  "CHANGELOG.md": "every release, and what it changed",
  "docs/": "the how-to guides, a reference page per bin and per shared config, and why the kit is shaped this way",
  "bunfig.toml": "the bunfig preset a repository copies",
  ".bun-version": "the fleet bun version the bun pin check reads",
  "commitlint.config.ts": "the shared commitlint config",
  "dependency-cruiser.config.js": "the kit's dependency-cruiser rules as a base a `.dependency-cruiser.cjs` extends by path, which the build writes",
  "knip-base.json": "the Knip `include` setting, for a configuration that spreads it",
  "src/": "every bin, which a package script calls by its `checks-` name, the modules the bins import, and the Effect language service severities under `src/quality/presets/`",
  "oxlintrc.json": "the oxlint `base` as a config a `.oxlintrc.json` extends by path, which the build writes",
  "stryker.preset.js": "the Stryker mutation-testing preset, which refuses a full run outside CI",
  "tsconfig.effect.json": "the tsconfig fragment with the shared compiler options and the Effect language-service block",
  "ts-reset.d.ts": "the two ts-reset rules `tsconfig.effect.json` lists in `files`",
  "dist/": "the compiled oxlint plugins, the config builders `@avi2dg/checks/oxlint`, `@avi2dg/checks/knip`, `@avi2dg/checks/dependency-cruiser` and `@avi2dg/checks/stylelint` resolve to, and the doc templates, one template per kind of doc file",
} as const;

type ShippedPath = keyof typeof SHIPPED;

function isShipped(path: string): path is ShippedPath {
  return Object.hasOwn(SHIPPED, path);
}

const SIZE_RULE_LIMITS = {
  "max-lines": "The most lines a file may hold, blank and comment lines counted",
  "max-lines-per-function": "The most lines a function may span, blank and comment lines counted",
  "max-statements": "The most statements a function may hold",
  "readability/cognitive-complexity": "The highest cognitive complexity a function may reach, a switch counted once",
  "max-depth": "The deepest a block may nest inside a function",
} as const satisfies Readonly<Record<SizeRule, string>>;

function isSizeRule(name: string): name is SizeRule {
  return Object.hasOwn(SIZE_RULE_LIMITS, name);
}

const OPT_IN_PEERS = {
  "checks-browser": ["playwright-core", "@axe-core/playwright", "html-validate"],
  "checks-copy": ["html-validate"],
  "checks-frontend-syntax": ["stylelint", "postcss-html", "stylelint-config-standard", "stylelint-plugin-use-baseline", "postcss-value-parser"],
} as const;

export type KitFacts = {
  readonly manifest: typeof Manifest.Type;
  readonly shipped: readonly ShippedPath[];
};

export class DocBlocksUnwritable extends Schema.TaggedError<DocBlocksUnwritable>()("DocBlocksUnwritable", {
  message: Schema.String,
}) {}

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

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

function optInPeersPinned({ peerDependencies, peerDependenciesMeta = {} }: typeof Manifest.Type): Effect.Effect<void, DocBlocksUnwritable> {
  const optional = Object.keys(peerDependencies).filter((name) => peerDependenciesMeta[name]?.optional === true);
  const named: readonly string[] = Object.values(OPT_IN_PEERS).flat();
  const unpaged = optional.filter((name) => !named.includes(name));
  const unpinned = [...new Set(named)].filter((name) => !optional.includes(name));
  if (unpaged.length === 0 && unpinned.length === 0) return Effect.void;
  const problems = [
    ...unpaged.map((name) => `the optional peer ${name} is in no OPT_IN_PEERS row of scripts/doc-blocks.ts`),
    ...unpinned.map((name) => `OPT_IN_PEERS in scripts/doc-blocks.ts names ${name}, which is no optional peer`),
  ];
  return Effect.fail(new DocBlocksUnwritable({ message: `${MANIFEST}: ${problems.join("; ")}` }));
}

export const kitFacts = (manifest: string): Effect.Effect<KitFacts, DocBlocksUnwritable> =>
  Effect.gen(function* () {
    const decoded = yield* decodeManifest(manifest).pipe(Effect.mapError(({ message }) => new DocBlocksUnwritable({ message: `${MANIFEST}: ${message}` })));
    yield* optInPeersPinned(decoded);
    return { manifest: decoded, shipped: yield* shippedPaths(decoded) };
  });

export type Block = {
  readonly name: string;
  readonly from: readonly string[];
  readonly render: (facts: KitFacts) => readonly string[];
};

function code(text: string): string {
  return `\`${text}\``;
}

export function optInInstall(names: readonly string[]): Block {
  return {
    name: "install",
    from: [MANIFEST],
    render: ({ manifest }) => [
      "```sh",
      ["bun add -d", ...names.toSorted().map((name) => `${name}@${manifest.peerDependencies[name] ?? ""}`)].join(" "),
      "```",
    ],
  };
}

const UPGRADE_INSTALL: Block = {
  name: "install",
  from: [MANIFEST],
  render: ({ manifest }) => [
    "```sh",
    ["bun add -d", ...Object.keys(manifest.peerDependencies).filter((name) => manifest.peerDependenciesMeta?.[name]?.optional !== true).toSorted().map((name) => `${name}@${manifest.peerDependencies[name] ?? ""}`)].join(" "),
    "```",
  ],
};

const READS = { tree: "the working tree", range: "the range" } as const;

const GATES: Block = {
  name: "gates",
  from: ["KIT_GATES in src/core/gates.ts"],
  render: () => [
    "| Vector | Gate | Reads | Runs in |",
    "| --- | --- | --- | --- |",
    ...KIT_GATES.toSorted((a, b) => VECTORS.indexOf(a.vector) - VECTORS.indexOf(b.vector)).map(({ vector, bin, reads, alsoReads, appliesTo }: KitGate) => {
      const runsIn = appliesTo === EVERY_REPOSITORY ? appliesTo : `a repository tracking ${appliesTo.pathspecs.map(code).join(" or ")}`;
      return `| ${vector} | [${code(bin)}](gates/${bin}.md) | ${READS[reads]}${alsoReads === undefined ? "" : `, and ${alsoReads}`} | ${runsIn} |`;
    }),
  ],
};

const DOC_KINDS: Block = {
  name: "doc-kinds",
  from: ["src/docs/doc-rules.ts", "src/docs/doc-templates.ts"],
  render: () => [
    "| File | Kind | Template |",
    "| --- | --- | --- |",
    ...[...ROOT_FILES].map(([path, kind]) => `| ${code(path)} | ${kind} | ${code(templateFile(kind))} |`),
    `| each file in ${code(ADR_DIRECTORY)} but its generated index, ${code(ADR_INDEX.slice(ADR_DIRECTORY.length))} | adr | ${code(templateFile("adr"))} |`,
    `| a page with ${code("kind")} in front matter | ${listed(MODES)} | ${code("dist/templates/<mode>.md")} |`,
  ],
};

const LIVING_DOCS: Block = {
  name: "living-docs",
  from: ["src/docs/prose-matchers.ts"],
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
  from: ["PROSE_RULES in src/docs/prose-matchers.ts"],
  render: () => [
    "| Refused | For example | Write instead | In agent files |",
    "| --- | --- | --- | --- |",
    ...PROSE_RULES.map(({ readers, refuses, example, instead }) => `| ${refuses} | ${example} | ${instead} | ${readers.includes("agents") ? "yes" : "no"} |`),
  ],
};

const SIZE_LIMITS: Block = {
  name: "size-limits",
  from: [`SOURCE_LIMITS, TEST_LIMITS, SOURCES and TESTS in ${OXLINT_PRESET}`],
  render: () => [
    `| Limits | oxlint rule | ${SOURCES.map(code).join(", ")} outside the tests | ${TESTS.map(code).join(", ")} |`,
    "| --- | --- | --- | --- |",
    ...Object.entries(SIZE_RULE_LIMITS).flatMap(([name, limits]) =>
      isSizeRule(name) ? [`| ${limits} | ${code(name)} | ${SOURCE_LIMITS[name]} | ${TEST_LIMITS[name]} |`] : [],
    ),
  ],
};

const LINT_SAMPLE: Block = {
  name: "lint-sample",
  from: ["KIT_GATES in src/core/gates.ts"],
  render: () => [
    "```",
    "checks-lint: range 2504acf098d120e73a8ece3c96f22b934f35c6a8..10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main",
    `checks-lint: 1 of ${KIT_GATES.length} gate(s) failed: checks-comment-gate`,
    "```",
  ],
};

const WHERE: Block = {
  name: "shipped",
  from: [MANIFEST],
  render: ({ shipped }) => ["| Path | What it holds |", "| --- | --- |", ...shipped.map((path) => `| ${code(path)} | ${SHIPPED[path]} |`)],
};

export const TARGETS: readonly { readonly file: string; readonly blocks: readonly Block[] }[] = [
  { file: BINS_PAGE, blocks: [GATES] },
  { file: "docs/shipped-files.md", blocks: [WHERE] },
  { file: "docs/how-to/upgrade-the-kit.md", blocks: [UPGRADE_INSTALL] },
  ...Object.entries(OPT_IN_PEERS).map(([bin, names]) => ({ file: `${GATE_PAGES}/${bin}.md`, blocks: [optInInstall(names)] })),
  { file: `${GATE_PAGES}/checks-docs.md`, blocks: [DOC_KINDS, LIVING_DOCS, PROSE] },
  { file: `${GATE_PAGES}/checks-lint.md`, blocks: [LINT_SAMPLE] },
  { file: "docs/configs/native-settings.md", blocks: [SIZE_LIMITS] },
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
