import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { judge } from "../scripts/doc-rules.ts";
import { ADR_STATUSES, KINDS, renderTemplate, TEMPLATE_DIRECTORY, TEMPLATES, templateFile } from "../scripts/doc-templates.ts";

const CHECKOUT = resolve(import.meta.dir, "..");
const PLACEHOLDER = /<(?!!--)[^>\s][^>]*>/g;
const SAMPLES = new Map([
  ["<number>", "1"],
  ["<version>", "1.0.0"],
  ["<YYYY-MM-DD>", "2026-09-24"],
  ["<YYYY-MM-DD, the day the record was written>", "2026-09-24"],
]);

function sample(placeholder: string): string {
  if (placeholder.startsWith(`<${ADR_STATUSES[0]},`)) return `${ADR_STATUSES[1]}.`;
  return SAMPLES.get(placeholder) ?? "Run it";
}

test("each committed template is what its spec renders, so the file a writer copies and the check agree", () => {
  const committed = KINDS.map((kind) => readFileSync(resolve(CHECKOUT, templateFile(kind)), "utf8"));
  expect(committed).toEqual(KINDS.map((kind) => renderTemplate(TEMPLATES[kind])));
});

test("the template directory holds a template for each kind and nothing else", () => {
  expect(readdirSync(resolve(CHECKOUT, TEMPLATE_DIRECTORY)).toSorted()).toEqual(
    KINDS.map((kind) => templateFile(kind).slice(`${TEMPLATE_DIRECTORY}/`.length)).toSorted(),
  );
});

test("each template ships in the package under its own export, where a consuming repository copies it from", () => {
  const manifest: unknown = JSON.parse(readFileSync(resolve(CHECKOUT, "package.json"), "utf8"));
  const exported = Object.fromEntries(KINDS.map((kind) => [`./${templateFile(kind)}`, `./${templateFile(kind)}`]));
  expect(manifest).toHaveProperty("files", expect.arrayContaining([`${TEMPLATE_DIRECTORY}/`]));
  expect(manifest).toHaveProperty("exports", expect.objectContaining(exported));
});

test("a template with each placeholder filled in holds to its own kind", () => {
  const refused = KINDS.flatMap((kind) => {
    const text = renderTemplate(TEMPLATES[kind]).replace(PLACEHOLDER, sample);
    const path = kind === "adr" ? "docs/adr/0001-template.md" : `docs/${kind}.md`;
    return judge(kind, { path, text }, [path]).map(({ line, message }) => `${templateFile(kind)}:${line}: ${message}`);
  });
  expect(refused).toEqual([]);
});
