import { expect } from "bun:test";
import { remoteCallsOf } from "../../../src/delivery/remote-calls.ts";
import { isRecord } from "../../../src/delivery/workflow-references.ts";

const LOCAL_OR_PINNED = /^(?:\.\/|(?:actions|oven-sh)\/[^/\s@]+@[0-9a-f]{40})/;

function usesOf(document: unknown): readonly string[] {
  if (!isRecord(document) || !isRecord(document["jobs"])) return [];
  return Object.values(document["jobs"]).flatMap((job) => {
    if (!isRecord(job)) return [];
    const own = typeof job["uses"] === "string" ? [job["uses"]] : [];
    const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
    return [...own, ...steps.flatMap((step) => (isRecord(step) && typeof step["uses"] === "string" ? [step["uses"]] : []))];
  });
}

export function expectNoRemoteUses(name: string, text: string): void {
  const document = Bun.YAML.parse(text);
  expect(remoteCallsOf([{ path: name, document, text }])).toEqual([]);
  for (const uses of usesOf(document)) expect([uses, LOCAL_OR_PINNED.test(uses)]).toEqual([uses, true]);
}
