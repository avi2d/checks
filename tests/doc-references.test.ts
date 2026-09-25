import { expect, test } from "bun:test";
import { anchoredTargets, anchorsOf, snapshotOf, unresolvedIn, type Snapshot } from "../scripts/doc-references.ts";

const FILES = [
  "README.md",
  "package.json",
  "docs/guide.md",
  "docs/gates/checks-lint.md",
  "scripts/lint.ts",
  ".pi/extensions/guard.ts",
  "tools/package.json",
  "tools/README.md",
];

const LINT_PAGE = "# checks-lint\n\n## Gate selection\n\n## Keys moved from `package.json`\n\n## Gate selection\n\n<a id=\"pinned\"></a>\n";

function snapshot(scripts: Readonly<Record<string, readonly string[]>> = { "": ["build", "lint"], tools: ["bundle"] }): Snapshot {
  return snapshotOf(
    FILES,
    new Map([["docs/gates/checks-lint.md", anchorsOf(LINT_PAGE)]]),
    new Map(Object.entries(scripts).map(([directory, names]) => [directory, new Set(names)])),
  );
}

function messages(doc: string, text: string, commands = true): readonly string[] {
  return unresolvedIn(doc, text, snapshot(), { commands }).map(({ line, message }) => `${line}: ${message}`);
}

test("a path in code resolves from the root or from the doc, and one that resolves nowhere is named", () => {
  const text = [
    "Lint lives in `scripts/lint.ts`, and `scripts/lint.ts:12` is its entry.",
    "The guard is `.pi/extensions/guard.ts`, and the gate page is `gates/checks-lint.md` and `../README.md`.",
    "The old entry was `scripts/old-lint.ts`.",
  ].join("\n");
  expect(messages("docs/guide.md", text)).toEqual(["3: names `scripts/old-lint.ts`, which is not in the repository"]);
});

test("a path whose top directory the repository lacks names another repository's file, and a path in fenced code is an example", () => {
  const text = "A consumer writes `reports/mutation/mutation.json` and `src/billing/parts.ts`.\n\n```sh\ncat scripts/missing.ts\n```\n";
  expect(messages("README.md", text)).toEqual([]);
});

test("a relative link resolves to a file or a directory, and its anchor to a heading or an explicit anchor", () => {
  const text = [
    "See [the gate](gates/checks-lint.md#gate-selection), [the second](gates/checks-lint.md#gate-selection-1) and [the keys](gates/checks-lint.md#keys-moved-from-packagejson).",
    "See [pinned](/docs/gates/checks-lint.md#pinned), [the docs](../docs/), [npm](https://www.npmjs.com/) and [mail](mailto:a@b.c).",
    "See [a missing page](gates/checks-gone.md) and [a missing heading](gates/checks-lint.md#options).",
  ].join("\n");
  expect(messages("docs/guide.md", text)).toEqual([
    "3: links to `gates/checks-gone.md`, which is not in the repository",
    "3: links to `gates/checks-lint.md#options`, and `docs/gates/checks-lint.md` has no heading with that anchor",
  ]);
});

test("a reference-style definition and a same-page anchor are links too", () => {
  const page = "# Guide\n\n## Set up\n\nSee [set up](#set-up) and [down](#tear-down).\n\n[gone]: ../missing.md\n";
  const found = unresolvedIn("docs/guide.md", page, snapshotOf(FILES, new Map([["docs/guide.md", anchorsOf(page)]]), new Map()), { commands: false });
  expect(found.map(({ line, message }) => `${line}: ${message}`)).toEqual([
    "5: links to `#tear-down`, and `docs/guide.md` has no heading with that anchor",
    "7: links to `../missing.md`, which is not in the repository",
  ]);
  expect(anchoredTargets("docs/guide.md", page)).toEqual(["docs/guide.md", "docs/guide.md"]);
});

test("a bun run command names a script of the nearest package.json, or a file that exists", () => {
  const text = ["Run `bun run build`, then `bun run lnt`.", "", "```sh", "bun run scripts/lint.ts", "bun run scripts/gone.ts", "bun run --filter x build", "```"].join("\n");
  expect(messages("README.md", text)).toEqual([
    "1: runs `bun run lnt`, and `lnt` is not a script in `package.json`",
    "5: runs `bun run scripts/gone.ts`, and `scripts/gone.ts` is not in the repository",
  ]);
  expect(messages("tools/README.md", "Run `bun run bundle` and `bun run build`.")).toEqual([
    "1: runs `bun run build`, and `build` is not a script in `tools/package.json`",
  ]);
});

test("a doc that speaks to a consumer holds no command to this package.json", () => {
  expect(messages("README.md", "Run `bun run lint:deps`.", false)).toEqual([]);
});

test("anchors follow GitHub: lowercased, punctuation dropped, spaces to hyphens, and a repeat numbered", () => {
  expect([...anchorsOf(LINT_PAGE)]).toEqual(["checks-lint", "gate-selection", "keys-moved-from-packagejson", "gate-selection-1", "pinned"]);
  expect([...anchorsOf("Setext title\n===\n\n```md\n# Not a heading\n```\n")]).toEqual(["setext-title"]);
});
