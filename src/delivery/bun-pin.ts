import { Effect, FileSystem, Path, Schema } from "effect";
import { within } from "./mutation-job.ts";
import { isRecord, locate, workflowJobs, type Workflow } from "./workflow-references.ts";

export const FLEET_BUN_VERSION = "1.4.3";
const ROOT_MANIFEST = "package.json";

export type BunPinPolicy = {
  readonly files: ReadonlyMap<string, string>;
  readonly manifests: ReadonlyMap<string, unknown>;
};

export type BunPinFault = {
  readonly location: string;
  readonly fault: string;
};

const SETUP_BUN = /^oven-sh\/setup-bun(?:@(?<ref>.*))?$/i;
const V2_REF = /^v2(?:\.\d+){0,2}$/;

function setupBunRef(uses: unknown): string | undefined {
  const match = typeof uses === "string" ? SETUP_BUN.exec(uses.trim()) : null;
  return match === null ? undefined : (match.groups?.["ref"] ?? "");
}

function isExpression(value: string): boolean {
  return value.includes("${{");
}

function baseName(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

function actionInput(step: Readonly<Record<string, unknown>>, name: string): string {
  const inputs = isRecord(step["with"]) ? step["with"] : {};
  const value = Object.entries(inputs).find(([key]) => key.toLowerCase() === name)?.[1];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).trim() : "";
}

function nonEmpty(version: string | undefined): string | undefined {
  const trimmed = version?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function manifestBunVersion(manifest: unknown): string | undefined {
  if (!isRecord(manifest)) return undefined;
  const manager = manifest["packageManager"];
  const engines = manifest["engines"];
  const engine = isRecord(engines) ? engines["bun"] : undefined;
  const version = manager === undefined || manager === null ? engine : typeof manager === "string" ? (manager.split("bun@")[1] ?? engine) : undefined;
  return typeof version === "string" ? nonEmpty(version) : undefined;
}

const FILE_READERS = new Map<string, (text: string) => string | undefined>([
  [".tool-versions", (text) => /^bun\s*(?<version>.*?)$/m.exec(text)?.groups?.["version"]],
  [".bumrc", (text) => text],
  [".bun-version", (text) => text],
]);

function fileBunVersion(policy: BunPinPolicy, key: string): string | undefined {
  if (baseName(key) === "package.json") return manifestBunVersion(policy.manifests.get(key));
  const text = policy.files.get(key);
  const read = FILE_READERS.get(baseName(key));
  return text === undefined || read === undefined ? undefined : nonEmpty(read(text));
}

type BunPinRequest = {
  readonly version: string | undefined;
  readonly source: string;
  readonly expression: string | undefined;
};

function rootRequest(policy: BunPinPolicy, consulted: string): BunPinRequest {
  const version = manifestBunVersion(policy.manifests.get(ROOT_MANIFEST));
  return { version, source: version === undefined ? consulted : ROOT_MANIFEST, expression: undefined };
}

function bunPinRequest(policy: BunPinPolicy, step: Readonly<Record<string, unknown>>): BunPinRequest {
  const pinned = actionInput(step, "bun-version");
  if (pinned !== "") {
    return isExpression(pinned)
      ? { version: undefined, source: "with.bun-version", expression: pinned }
      : { version: pinned, source: "with.bun-version", expression: undefined };
  }
  const file = actionInput(step, "bun-version-file");
  if (file === "") return rootRequest(policy, ROOT_MANIFEST);
  const source = `with.bun-version-file ${file}`;
  if (isExpression(file)) return { version: undefined, source, expression: file };
  const key = within("", file);
  const version = key === undefined ? undefined : fileBunVersion(policy, key);
  return version === undefined ? rootRequest(policy, `${source} or ${ROOT_MANIFEST}`) : { version, source, expression: undefined };
}

function bunPinFault(policy: BunPinPolicy, step: Readonly<Record<string, unknown>>): string | undefined {
  const request = bunPinRequest(policy, step);
  if (request.expression !== undefined) {
    return `requests bun ${request.expression} from ${request.source}, which cannot be shown equal to ${FLEET_BUN_VERSION} before the run`;
  }
  if (request.version === undefined) {
    return `pins no bun version from ${request.source}, so setup-bun installs latest, want ${FLEET_BUN_VERSION}`;
  }
  return request.version === FLEET_BUN_VERSION ? undefined : `requests bun ${request.version} from ${request.source}, want ${FLEET_BUN_VERSION}`;
}

function unknownRefFault(ref: string): string {
  return `uses oven-sh/setup-bun at ${ref === "" ? "no ref" : ref}, but the check knows only setup-bun v2's version resolution, so the step must use oven-sh/setup-bun@v2`;
}

export function findBunPinFaults(policy: BunPinPolicy, workflows: readonly Workflow[]): readonly BunPinFault[] {
  return workflows.flatMap((workflow) => {
    const at = locate(workflow.path, workflow.text.split("\n"));
    return workflowJobs(workflow).flatMap(([id, job]) => {
      const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
      return steps.flatMap((step: unknown, index: number) => {
        if (!isRecord(step)) return [];
        const ref = setupBunRef(step["uses"]);
        if (ref === undefined) return [];
        const fault = V2_REF.test(ref) ? bunPinFault(policy, step) : unknownRefFault(ref);
        return fault === undefined ? [] : [{ location: at(["jobs", id, "steps", index, "uses"], String(step["uses"]), `job ${id} step ${index + 1}`), fault }];
      });
    });
  });
}

export function formatBunPinReport(faults: readonly BunPinFault[]): string {
  return [`ci-wiring: ${faults.length} setup-bun step(s) drift from the fleet bun version:`, ...faults.map(({ location, fault }) => `  ${location}: ${fault}`)].join("\n");
}

function versionFileKeys(job: Readonly<Record<string, unknown>>): readonly string[] {
  const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
  const keys: string[] = [];
  for (const step of steps) {
    if (!isRecord(step) || !V2_REF.test(setupBunRef(step["uses"]) ?? "")) continue;
    const file = actionInput(step, "bun-version-file");
    if (file === "" || isExpression(file)) continue;
    const key = within("", file);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

function wantedBunPinFiles(workflows: readonly Workflow[]): ReadonlySet<string> {
  const wanted = new Set<string>([ROOT_MANIFEST]);
  for (const workflow of workflows) {
    for (const [, job] of workflowJobs(workflow)) {
      for (const key of versionFileKeys(job)) wanted.add(key);
    }
  }
  return wanted;
}

const readJsonFile = Effect.fn("readJsonFile")(function* (file: string) {
  return yield* (yield* FileSystem.FileSystem).readFileString(file).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))),
    Effect.orElseSucceed((): undefined => undefined),
  );
});

export const readBunPinPolicy = Effect.fn("readBunPinPolicy")(function* (root: string, workflows: readonly Workflow[]) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const files = new Map<string, string>();
  const manifests = new Map<string, unknown>();
  for (const name of wantedBunPinFiles(workflows)) {
    if (baseName(name) === "package.json") {
      const parsed: unknown = yield* readJsonFile(path.join(root, name));
      if (parsed !== undefined) manifests.set(name, parsed);
    } else {
      const text = yield* fs.readFileString(path.join(root, name)).pipe(Effect.orElseSucceed((): undefined => undefined));
      if (text !== undefined) files.set(name, text);
    }
  }
  return { files, manifests };
});
