import { isRecord } from "./workflow-references.ts";

export type StepContext =
  | { readonly kind: "workflow" }
  | { readonly kind: "reusable"; readonly inputDefaults: ReadonlyMap<string, string> }
  | { readonly kind: "composite"; readonly inputForEnv: ReadonlyMap<string, string>; readonly inputDefaults: ReadonlyMap<string, string> };

export const ORDINARY: StepContext = { kind: "workflow" };

const INPUT_EXPRESSION = /^\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/;
const VARIABLE = String.raw`\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})`;
const PROGRAM_VARIABLE = new RegExp(String.raw`^(?:"${VARIABLE}"|${VARIABLE})(?=\s|$)`);

function programVariable(line: string): string | undefined {
  const match = PROGRAM_VARIABLE.exec(line);
  return match === null ? undefined : match.slice(1).join("");
}

function inputName(value: string): string | undefined {
  const match = INPUT_EXPRESSION.exec(value);
  return match?.[1];
}

function stringDefaults(inputs: unknown): ReadonlyMap<string, string> {
  if (!isRecord(inputs)) return new Map();
  const defaults = new Map<string, string>();
  for (const [name, spec] of Object.entries(inputs)) {
    if (isRecord(spec) && typeof spec["default"] === "string" && spec["default"].trim() !== "") defaults.set(name, spec["default"]);
  }
  return defaults;
}

export function reusableDefaults(document: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  const on = document["on"];
  if (!isRecord(on)) return new Map();
  const call = on["workflow_call"];
  if (!isRecord(call)) return new Map();
  return stringDefaults(call["inputs"]);
}

export function compositeDefaults(document: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  return stringDefaults(document["inputs"]);
}

export function envInputs(step: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  const env = step["env"];
  if (!isRecord(env)) return new Map();
  const found = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    const input = inputName(value);
    if (input !== undefined) found.set(name, input);
  }
  return found;
}

export function runsCallerCommand(line: string, plain: string, context: StepContext): boolean {
  if (context.kind === "workflow") return false;
  if (inputName(line) !== undefined) return true;
  if (context.kind === "reusable") return false;
  const name = programVariable(plain);
  return name !== undefined && context.inputForEnv.has(name);
}

export function callerDefault(line: string, plain: string, context: StepContext): { readonly name: string; readonly value: string } | undefined {
  if (context.kind === "workflow") return undefined;
  const direct = inputName(line);
  if (direct !== undefined) {
    const value = context.inputDefaults.get(direct);
    return value === undefined ? undefined : { name: direct, value };
  }
  if (context.kind === "reusable") return undefined;
  const name = programVariable(plain);
  if (name === undefined) return undefined;
  const input = context.inputForEnv.get(name);
  if (input === undefined) return undefined;
  const value = context.inputDefaults.get(input);
  return value === undefined ? undefined : { name: input, value };
}
