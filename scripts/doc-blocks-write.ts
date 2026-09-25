#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { BUN_VERSION, DocBlocksUnwritable, kitFacts, MANIFEST, splice, TARGETS } from "./doc-blocks.ts";
import { kitCheckout } from "./kit-checkout.ts";
import { runMain } from "./main.ts";

const write = Effect.gen(function* () {
  const checkout = yield* kitCheckout;
  const facts = yield* kitFacts(yield* checkout.read(MANIFEST), yield* checkout.read(BUN_VERSION));
  yield* Effect.forEach(TARGETS, ({ file, blocks }) =>
    Effect.gen(function* () {
      const spliced = splice(yield* checkout.read(file), blocks, facts);
      if (spliced.type === "unmarked") {
        return yield* new DocBlocksUnwritable({ message: `${file} lacks the markers of its generated ${spliced.blocks.join(", ")} block(s)` });
      }
      yield* checkout.write(file, spliced.text);
    }),
  );
  yield* Console.log(`doc-blocks: wrote the generated blocks of ${TARGETS.map(({ file }) => file).join(", ")}`);
  return true;
});

if (import.meta.main) runMain("doc-blocks", write);
