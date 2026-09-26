import { Effect, FileSystem, Path, Schema } from "effect";
import { identifierName, isRecord, lineOf, parseTypeScript, spanStart, stringValue } from "./swc.ts";

export type Environment = "ci" | "local";
export type TestTier = "live" | "pixel";
export type SkipDeclaration = {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly reason: string;
  readonly when?: Environment;
};

export class SkipDeclarationError extends Schema.TaggedError<SkipDeclarationError>()("SkipDeclarationError", {
  message: Schema.String,
}) {}

const TEST_FILES = ["tests/**/*.test.ts", "tests/**/*.test.tsx"] as const;
const SKIP_HELPER_MODULE = "test-skips.ts";
const whenSchema = Schema.Literals(["ci", "local"]);

export function skipReason(_reason: string, label: string, _when?: Environment): string {
  return label;
}

function expressionOf(argument: unknown): unknown {
  return isRecord(argument) ? argument["expression"] : undefined;
}

function argumentsOf(node: Record<string, unknown>): readonly unknown[] {
  const args = node["arguments"];
  return Array.isArray(args) ? args : [];
}

function skipReasonAliases(statement: unknown): readonly string[] {
  if (!isRecord(statement) || statement["type"] !== "ImportDeclaration") return [];
  const source = stringValue(statement["source"]);
  const specifiers = statement["specifiers"];
  if (source === undefined || !source.endsWith(SKIP_HELPER_MODULE) || !Array.isArray(specifiers)) return [];
  return specifiers.flatMap((specifier) => {
    if (!isRecord(specifier) || specifier["type"] !== "ImportSpecifier") return [];
    const imported = identifierName(specifier["imported"]) ?? identifierName(specifier["local"]);
    const local = identifierName(specifier["local"]);
    return imported === "skipReason" && local !== undefined ? [local] : [];
  });
}

function importedSkipReasonNames(module: unknown): ReadonlySet<string> {
  if (!isRecord(module) || !Array.isArray(module["body"])) return new Set();
  return new Set(module["body"].flatMap(skipReasonAliases));
}

type Member = { readonly object: string | undefined; readonly property: string | undefined };

function memberOf(node: unknown): Member | undefined {
  if (!isRecord(node) || node["type"] !== "MemberExpression") return undefined;
  return { object: identifierName(node["object"]), property: identifierName(node["property"]) };
}

type SkipReasonScan =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "valid"; readonly name: string; readonly reason: string; readonly when?: Environment };

function skipReasonCall(node: unknown, aliases: ReadonlySet<string>): SkipReasonScan {
  if (!isRecord(node) || node["type"] !== "CallExpression") return { kind: "none" };
  if (!aliases.has(identifierName(node["callee"]) ?? "")) return { kind: "none" };
  const [reasonArgument, labelArgument, whenArgument] = argumentsOf(node);
  const reason = stringValue(expressionOf(reasonArgument));
  const label = stringValue(expressionOf(labelArgument));
  if (reason === undefined || reason.trim() === "" || label === undefined || label.trim() === "") {
    return { kind: "invalid", message: "skipReason needs a non-empty literal reason and a literal test name" };
  }
  const when = whenArgument === undefined ? undefined : stringValue(expressionOf(whenArgument));
  if (whenArgument !== undefined && when === undefined) {
    return { kind: "invalid", message: "skipReason's when value must be \"ci\" or \"local\"" };
  }
  if (when !== undefined && !Schema.is(whenSchema)(when)) {
    return {
      kind: "invalid",
      message: `skipReason's when value must be "ci" or "local", found ${JSON.stringify(when)}`,
    };
  }
  return { kind: "valid", name: label, reason, ...(when === undefined ? {} : { when }) };
}

type RegisteredSkip = { readonly onDescribe: boolean; readonly first: unknown };

function registeredSkip(node: Record<string, unknown>): RegisteredSkip | undefined {
  if (node["type"] !== "CallExpression") return undefined;
  const callee = node["callee"];
  const curried = isRecord(callee) && callee["type"] === "CallExpression";
  const member = memberOf(curried ? callee["callee"] : callee);
  const methods = curried ? ["skipIf", "if"] : ["skip", "todo"];
  if (member === undefined || !methods.includes(member.property ?? "")) return undefined;
  return { onDescribe: member.object === "describe", first: expressionOf(argumentsOf(node)[0]) };
}

function registeredSkips(module: unknown): readonly RegisteredSkip[] {
  const found: RegisteredSkip[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecord(node)) return;
    const registered = registeredSkip(node);
    if (registered !== undefined) found.push(registered);
    for (const value of Object.values(node)) visit(value);
  };
  visit(module);
  return found;
}

type DeclarationsRead =
  | { readonly kind: "valid"; readonly declarations: readonly SkipDeclaration[] }
  | { readonly kind: "invalid"; readonly message: string };

function declarationsIn(source: string, file: string, module: unknown): DeclarationsRead {
  const aliases = importedSkipReasonNames(module);
  if (aliases.size === 0) return { kind: "valid", declarations: [] };
  const declarations: SkipDeclaration[] = [];
  for (const { onDescribe, first } of registeredSkips(module)) {
    if (!isRecord(first)) continue;
    const metadata = skipReasonCall(first, aliases);
    if (metadata.kind === "none") continue;
    const line = lineOf(source, spanStart(first));
    if (onDescribe) {
      return {
        kind: "invalid",
        message: `line ${line}: skipReason cannot declare a describe; declare each test inside it with its own skipReason`,
      };
    }
    if (metadata.kind === "invalid") return metadata;
    const { name, reason, when } = metadata;
    declarations.push({ file, line, name, reason, ...(when === undefined ? {} : { when }) });
  }
  return { kind: "valid", declarations };
}

function selectedTierFile(file: string, tier: TestTier | undefined): boolean {
  if (file.startsWith("tests/quarantine/")) return false;
  if (tier === undefined) return !file.startsWith("tests/live/") && !file.startsWith("tests/pixel/");
  return file.startsWith(`tests/${tier}/`);
}

export const readSkipDeclarations = Effect.fn("readSkipDeclarations")(function* (
  root: string,
  tier: TestTier | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* Effect.tryPromise({
    try: () =>
      Promise.all(
        TEST_FILES.map((pattern) =>
          Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })),
        ),
      ).then((groups) => groups.flat().filter((file) => selectedTierFile(file, tier)).sort()),
    catch: (cause) => new SkipDeclarationError({ message: `cannot find test files: ${String(cause)}` }),
  });
  const declarations: SkipDeclaration[] = [];
  for (const file of files) {
    const source = yield* fs.readFileString(path.join(root, file)).pipe(
      Effect.mapError((cause) => new SkipDeclarationError({ message: `cannot read ${file}: ${cause.message}` })),
    );
    const module = yield* parseTypeScript(file, source).pipe(
      Effect.mapError((error) => new SkipDeclarationError({ message: error.message })),
    );
    const parsed = yield* Effect.try({
      try: () => declarationsIn(source, file, module),
      catch: (cause) => new SkipDeclarationError({ message: `cannot read skip declarations in ${file}: ${String(cause)}` }),
    });
    if (parsed.kind === "invalid") {
      return yield* new SkipDeclarationError({ message: `${file}: ${parsed.message}` });
    }
    declarations.push(...parsed.declarations);
  }
  return declarations;
});
