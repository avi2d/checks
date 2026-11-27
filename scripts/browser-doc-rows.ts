import { Effect, Schema, SchemaAST } from "effect";
import { BrowserSettings } from "../src/core/browser-settings.ts";
import starter from "../src/quality/browser/browser-checks.json" with { type: "json" };

export const browserConfigRows = Effect.forEach(Object.entries(BrowserSettings.fields), ([key, schema]) => {
  const description = Schema.resolveAnnotations(schema)?.description;
  if (description === undefined) return Effect.fail(`browser-settings-keys: no description for ${key}`);
  const required = SchemaAST.isOptional(schema.ast) ? "No" : "Yes";
  return Effect.succeed(`| \`${key}\` | ${required} | ${description} |`);
}).pipe(Effect.map((rows) => ["| Field | Required | What it holds |", "| --- | --- | --- |", ...rows]));

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (typeof value === "object" && value !== null) return `{ ${Object.entries(value).map(([key, field]) => `${JSON.stringify(key)}: ${inline(field)}`).join(", ")} }`;
  return JSON.stringify(value);
}

function jsonField([key, value]: readonly [string, unknown]): readonly string[] {
  if (!Array.isArray(value) || !value.some((item) => typeof item === "object")) return [`  ${JSON.stringify(key)}: ${inline(value)}`];
  return [`  ${JSON.stringify(key)}: [`, ...value.map((item, index) => `    ${inline(item)}${index < value.length - 1 ? "," : ""}`), "  ]"];
}

function compactJson(value: Readonly<Record<string, unknown>>): readonly string[] {
  const fields = Object.entries(value).map(jsonField);
  return ["{", ...fields.flatMap((lines, index) => (index < fields.length - 1 ? [...lines.slice(0, -1), `${lines.at(-1) ?? ""},`] : lines)), "}"];
}

export const browserStarterLines = ["```json", ...compactJson(starter), "```"];
