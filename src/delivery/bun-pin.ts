import { Effect, FileSystem, Path, Schema } from "effect";
import { within } from "./mutation-job.ts";
import { isRecord, workflowJobs, type Workflow } from "./workflow-references.ts";

export const FLEET_BUN_VERSION = "1.4.3";

export type BunPinPolicy = {
  readonly files: ReadonlyMap<string, string>;
  readonly manifests: ReadonlyMap<string, unknown>;
};

export type BunPinFault = {
  readonly location: string;
  readonly fault: string;
};

function setupBun(uses: unknown): boolean {
  return typeof uses === "string" && /^oven-sh\/setup-bun(@|$)/i.test(uses.trim());
}

function isExpression(value: string): boolean {
  return value.includes("${{");
}

function baseName(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

function manifestBunVersion(manifest: unknown): string | undefined {
  if (!isRecord(manifest)) return undefined;
  const manager = manifest["packageManager"];
  if (typeof manager === "string") {
    const pinned = /^bun@(.+)$/.exec(manager.trim())?.[1]?.trim();
    if (pinned !== undefined && pinned !== "") return pinned;
  }
  const engines = manifest["engines"];
  const bun = isRecord(engines) ? engines["bun"] : undefined;
  return typeof bun === "string" && bun.trim() !== "" ? bun.trim() : undefined;
}

function toolVersionsBun(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const [name, ...rest] = line.trim().split(/\s+/);
    if (name === "bun") {
      const version = rest.join(" ").trim();
      return version === "" ? undefined : version;
    }
  }
  return undefined;
}

function fileBunVersion(name: string, text: string | undefined, manifest: unknown): string | undefined {
  if (baseName(name) === "package.json") {
    return manifest === undefined ? undefined : manifestBunVersion(manifest);
  }
  if (text === undefined) return undefined;
  if (baseName(name) === ".tool-versions") return toolVersionsBun(text);
  if (baseName(name) === ".bun-version" || baseName(name) === ".bumrc") {
    return text.trim() === "" ? undefined : text.trim();
  }
  return undefined;
}

type BunPinRequest = {
  readonly version: string | undefined;
  readonly source: string;
  readonly expression: string | undefined;
};

function bunPinRequest(policy: BunPinPolicy, step: Readonly<Record<string, unknown>>): BunPinRequest {
  const inputs = isRecord(step["with"]) ? step["with"] : {};
  const pinned = inputs["bun-version"];
  if (typeof pinned === "string" && pinned.trim() !== "") {
    return isExpression(pinned)
      ? { version: undefined, source: "with.bun-version", expression: pinned.trim() }
      : { version: pinned.trim(), source: "with.bun-version", expression: undefined };
  }
  const file = inputs["bun-version-file"];
  if (typeof file === "string" && file.trim() !== "") {
    const source = `with.bun-version-file ${file.trim()}`;
    if (isExpression(file)) return { version: undefined, source, expression: file.trim() };
    const key = within("", file.trim());
    return {
      version: key === undefined ? undefined : fileBunVersion(key, policy.files.get(key), policy.manifests.get(key)),
      source,
      expression: undefined,
    };
  }
  return { version: manifestBunVersion(policy.manifests.get("package.json")), source: "package.json", expression: undefined };
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

export function findBunPinFaults(policy: BunPinPolicy, workflows: readonly Workflow[]): readonly BunPinFault[] {
  return workflows.flatMap((workflow) => {
    const lines = workflow.text
      .split("\n")
      .flatMap((line, index) => (line.toLowerCase().includes("uses") && line.toLowerCase().includes("setup-bun") ? [index + 1] : []));
    let seen = 0;
    return workflowJobs(workflow).flatMap(([id, job]) => {
      const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
      return steps.flatMap((step: unknown, index: number) => {
        if (!isRecord(step) || !setupBun(step["uses"])) return [];
        const line = lines[seen];
        seen += 1;
        const location = line === undefined ? `${workflow.path} job ${id} step ${index + 1}` : `${workflow.path} line ${line}`;
        const fault = bunPinFault(policy, step);
        return fault === undefined ? [] : [{ location, fault }];
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
    if (!isRecord(step) || !setupBun(step["uses"]) || !isRecord(step["with"])) continue;
    const file = step["with"]["bun-version-file"];
    if (typeof file !== "string" || isExpression(file.trim())) continue;
    const key = within("", file.trim());
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

function wantedBunPinFiles(workflows: readonly Workflow[]): ReadonlySet<string> {
  const wanted = new Set<string>(["package.json"]);
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
