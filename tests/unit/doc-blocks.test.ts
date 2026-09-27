import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { BUN_VERSION, INSTALL, kitFacts, MANIFEST, OXLINTRC, splice, TARGETS } from "../../scripts/doc-blocks.ts";
import { KIT_GATES } from "../../src/core/gates.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

function read(file: string): string {
  return readFileSync(resolve(CHECKOUT, file), "utf8");
}

const KIT = Effect.runSync(kitFacts(read(MANIFEST), read(BUN_VERSION), read(OXLINTRC)));

test("each committed doc carries the blocks bun run build writes from package.json, .bun-version and the code they copy", () => {
  const written = TARGETS.map(({ file, blocks }) => ({ file, spliced: splice(read(file), blocks, KIT) }));
  expect(written).toEqual(TARGETS.map(({ file }) => ({ file, spliced: { type: "spliced", text: read(file) } })));
});

const FACTS = {
  manifest: { name: "@acme/kit", peerDependencies: { zod: "4.0.0", "@acme/peer": "1.2.3" }, files: [] },
  bun: "1.3.0",
  shipped: [],
  sizeScopes: [],
};

test("a stale block is rewritten at its marker's indent, peers sorted by name, and the text around it is kept", () => {
  const stale = ["1. Add the kit:", "", "   <!-- generated install: by hand -->", "   bun add -d @acme/kit", "   <!-- end generated install -->", "", "1. Next."];
  expect(splice(stale.join("\n"), [INSTALL], FACTS)).toEqual({
    type: "spliced",
    text: [
      "1. Add the kit:",
      "",
      "   <!-- generated install: bun run build writes it from package.json and scripts/doc-blocks.ts -->",
      "",
      "   ```sh",
      "   bun add -d @acme/kit @acme/peer@1.2.3 zod@4.0.0",
      "   ```",
      "",
      "   <!-- end generated install -->",
      "",
      "1. Next.",
    ].join("\n"),
  });
});

test("a stale lint sample count is rewritten from KIT_GATES", () => {
  const target = TARGETS.find(({ file }) => file === "docs/gates/checks-lint.md");
  expect(target).toBeDefined();
  const stale = [
    "## Sample output",
    "",
    "<!-- generated lint-sample: by hand -->",
    "",
    "```",
    "checks-lint: range abc..def from HEAD against origin/main",
    "checks-lint: 1 of 3 gate(s) failed: checks-comment-gate",
    "```",
    "",
    "<!-- end generated lint-sample -->",
  ].join("\n");
  const spliced = splice(stale, target?.blocks ?? [], FACTS);
  expect(spliced.type).toBe("spliced");
  if (spliced.type === "spliced") expect(spliced.text).toContain(`1 of ${KIT_GATES.length} gate(s) failed`);
});

test("a doc missing a block's markers is refused naming the block, rather than written without it", () => {
  const blocks = TARGETS.flatMap((target) => target.blocks);
  expect(splice("# checks\n\n<!-- generated install: by hand -->\n", blocks, FACTS)).toEqual({
    type: "unmarked",
    blocks: blocks.map(({ name }) => name),
  });
});

test("a .bun-version that is not a version is refused rather than written into the prerequisites", () => {
  const refused = Effect.runSync(Effect.flip(kitFacts(read(MANIFEST), "latest\n", read(OXLINTRC))));
  expect(refused.message).toStartWith(".bun-version: ");
});

function shipping(files: readonly string[]): string {
  return JSON.stringify({ ...KIT.manifest, files });
}

test("a package.json that ships a top-level path Where things are has no row for is refused, naming the path", () => {
  const refused = Effect.runSync(Effect.flip(kitFacts(shipping([...KIT.manifest.files, "extras/one.md"]), read(BUN_VERSION), read(OXLINTRC))));
  expect(refused.message).toBe("package.json: files ships extras/, which SHIPPED in scripts/doc-blocks.ts has no row for");
});

test("a Where things are row for a path package.json no longer ships is refused, naming the path", () => {
  const refused = Effect.runSync(Effect.flip(kitFacts(shipping(KIT.manifest.files.filter((file) => file !== "stryker.preset.js")), read(BUN_VERSION), read(OXLINTRC))));
  expect(refused.message).toBe("package.json: SHIPPED in scripts/doc-blocks.ts has a row for stryker.preset.js, which files does not ship");
});
