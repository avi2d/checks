import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { BUN_VERSION, INSTALL, kitFacts, MANIFEST, splice, TARGETS } from "../scripts/doc-blocks.ts";

const CHECKOUT = resolve(import.meta.dir, "..");

function read(file: string): string {
  return readFileSync(resolve(CHECKOUT, file), "utf8");
}

test("each committed doc carries the blocks bun run build writes from package.json, .bun-version and the code they copy", () => {
  const facts = Effect.runSync(kitFacts(read(MANIFEST), read(BUN_VERSION)));
  const written = TARGETS.map(({ file, blocks }) => ({ file, spliced: splice(read(file), blocks, facts) }));
  expect(written).toEqual(TARGETS.map(({ file }) => ({ file, spliced: { type: "spliced", text: read(file) } })));
});

const FACTS = {
  manifest: { name: "@acme/kit", peerDependencies: { zod: "4.0.0", "@acme/peer": "1.2.3" }, devDependencies: { typescript: "7.0.0" } },
  bun: "1.3.0",
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
      "   bun add -d @acme/kit @acme/peer@1.2.3 zod@4.0.0 typescript@7.0.0",
      "   ```",
      "",
      "   <!-- end generated install -->",
      "",
      "1. Next.",
    ].join("\n"),
  });
});

test("a doc missing a block's markers is refused naming the block, rather than written without it", () => {
  const blocks = TARGETS.flatMap((target) => target.blocks);
  expect(splice("# checks\n\n<!-- generated install: by hand -->\n", blocks, FACTS)).toEqual({
    type: "unmarked",
    blocks: blocks.map(({ name }) => name),
  });
});

test("a .bun-version that is not a version is refused rather than written into the prerequisites", () => {
  const refused = Effect.runSync(Effect.flip(kitFacts(read(MANIFEST), "latest\n")));
  expect(refused.message).toStartWith(".bun-version: ");
});
