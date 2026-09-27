import { parse } from "@swc/core";
import { Effect, Schema } from "effect";

export class TypeScriptParseError extends Schema.TaggedError<TypeScriptParseError>()("TypeScriptParseError", {
  message: Schema.String,
}) {}

export const parseTypeScript = Effect.fn("parseTypeScript")(function* (file: string, source: string) {
  return yield* Effect.tryPromise({
    try: () => parse(source, { syntax: "typescript", tsx: file.endsWith(".tsx"), target: "esnext" }),
    catch: (cause) => new TypeScriptParseError({ message: `cannot parse ${file}: ${String(cause)}` }),
  });
});

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function identifierName(node: unknown): string | undefined {
  if (!isRecord(node) || node["type"] !== "Identifier") return undefined;
  const value = node["value"];
  return typeof value === "string" ? value : undefined;
}

export function stringValue(node: unknown): string | undefined {
  if (!isRecord(node) || node["type"] !== "StringLiteral") return undefined;
  const value = node["value"];
  return typeof value === "string" ? value : undefined;
}

export function spanStart(node: Record<string, unknown>): number {
  const span = node["span"];
  if (!isRecord(span)) return 0;
  const start = span["start"];
  return typeof start === "number" ? start : 0;
}

export function lineOf(source: string, start: number): number {
  const bytes = Buffer.from(source, "utf8");
  const offset = Math.max(0, Math.min(bytes.length, start - 1));
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (bytes[index] === 0x0a) line += 1;
  }
  return line;
}
