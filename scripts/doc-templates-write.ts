#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { KINDS, renderTemplate, TEMPLATE_DIRECTORY, TEMPLATES, templateFile } from "./doc-templates.ts";
import { kitCheckout } from "./kit-checkout.ts";
import { runMain } from "./main.ts";

const write = Effect.gen(function* () {
  const checkout = yield* kitCheckout;
  yield* checkout.makeDirectory(TEMPLATE_DIRECTORY);
  yield* Effect.forEach(KINDS, (kind) => checkout.write(templateFile(kind), renderTemplate(TEMPLATES[kind])));
  yield* Console.log(`doc-templates: wrote ${KINDS.length} template(s) to ${TEMPLATE_DIRECTORY}/`);
  return true;
});

if (import.meta.main) runMain("doc-templates", write);
