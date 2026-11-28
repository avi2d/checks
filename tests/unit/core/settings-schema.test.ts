import { expect, test } from "bun:test";
import { JsonSchema, Schema, SchemaAST } from "effect";
import { Settings } from "../../../src/core/settings.ts";

function regexNodes(ast: SchemaAST.AST): SchemaAST.AST[] {
  const own = (ast.checks ?? []).some((check) => check.annotations?.representation?.id === "effect/schema/isPattern") ? [ast] : [];
  if (SchemaAST.isObjects(ast)) return [...own, ...ast.propertySignatures.flatMap(({ type }) => regexNodes(type)), ...ast.indexSignatures.flatMap(({ parameter, type }) => [...regexNodes(parameter), ...regexNodes(type)])];
  if (SchemaAST.isArrays(ast)) return [...own, ...[...ast.elements, ...ast.rest].flatMap(regexNodes)];
  if (SchemaAST.isUnion(ast)) return [...own, ...ast.types.flatMap(regexNodes)];
  return own;
}

function patterns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(patterns);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === "pattern" && typeof child === "string" ? [child] : []),
    ...(key === "patternProperties" && child !== null && typeof child === "object" ? Object.keys(child) : []),
    ...patterns(child),
  ]);
}

test("settings JSON schema retains every regex-checked string pattern", async () => {
  const { schema, definitions } = Schema.toJsonSchemaDocument(Settings, { onExcessProperty: "error" });
  const document = { $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12, ...schema, $defs: definitions };
  const committed: unknown = await Bun.file("dist/checks.schema.json").json();
  expect(committed).toEqual(document);
  const nodes = regexNodes(Settings.ast);
  expect(nodes.length).toBeGreaterThan(0);
  const emitted = patterns(committed);
  for (const node of nodes) {
    const pattern = Schema.toJsonSchemaDocument(Schema.make(node)).schema["pattern"];
    expect(typeof pattern).toBe("string");
    expect(emitted).toContain(String(pattern));
  }
});
