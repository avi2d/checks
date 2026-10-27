import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { grantsOidc, ownerRepoOf, publishesToNpm } from "../../src/delivery/release-preflight.ts";
import { isRecord, workflowJobs } from "../../src/delivery/workflow-references.ts";

const REPO = resolve(import.meta.dir, "..", "..");
const F = "`".repeat(3);

test("owner and name come from the https and ssh forms of a GitHub remote", () => {
  expect(ownerRepoOf("https://github.com/acme/widget.git")).toBe("acme/widget");
  expect(ownerRepoOf("git+https://github.com/acme/widget.git")).toBe("acme/widget");
  expect(ownerRepoOf("git@github.com:acme/widget.git")).toBe("acme/widget");
  expect(ownerRepoOf("https://github.com/acme/widget")).toBe("acme/widget");
});

test("anything but a GitHub owner and name has no repository to match", () => {
  expect(ownerRepoOf("https://example.com/acme/widget.git")).toBeUndefined();
  expect(ownerRepoOf("acme/widget")).toBeUndefined();
  expect(ownerRepoOf("")).toBeUndefined();
});

test("the publisher matters for the kit publish and for npm publish", () => {
  expect(publishesToNpm("./node_modules/.bin/checks-release-publish")).toBe(true);
  expect(publishesToNpm("bun src/delivery/release-publish.ts")).toBe(true);
  expect(publishesToNpm("npm publish --provenance")).toBe(true);
  expect(publishesToNpm("bun run build")).toBe(false);
});

const kitStep = { run: "bun src/delivery/release-publish.ts" };
const lintStep = { run: "bun run lint" };

test("a publishing job without its own permissions inherits the workflow grant", () => {
  expect(grantsOidc({ permissions: { contents: "read", "id-token": "write" }, jobs: { publish: { steps: [kitStep] } } })).toBe(true);
});

test("a publishing job with write-all above it inherits the token grant", () => {
  expect(grantsOidc({ permissions: "write-all", jobs: { publish: { steps: [kitStep] } } })).toBe(true);
});

test("a publishing job with its own permissions ignores the workflow grant", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read", "id-token": "write" },
      jobs: { publish: { permissions: { contents: "read" }, steps: [kitStep] } },
    }),
  ).toBe(false);
});

test("a grant on another job mints no token for the publishing job", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read" },
      jobs: {
        lint: { permissions: { "id-token": "write" }, steps: [lintStep] },
        publish: { steps: [kitStep] },
      },
    }),
  ).toBe(false);
});

test("one publishing job without the grant fails the check when a sibling publishing job holds it", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read", "id-token": "write" },
      jobs: {
        publish: { steps: [kitStep] },
        second: { permissions: { contents: "read" }, steps: [kitStep] },
      },
    }),
  ).toBe(false);
});

test("two publishing jobs each holding the grant pass the check", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read" },
      jobs: {
        publish: { permissions: { contents: "read", "id-token": "write" }, steps: [kitStep] },
        second: { permissions: { contents: "read", "id-token": "write" }, steps: [kitStep] },
      },
    }),
  ).toBe(true);
});

test("a publishing job granting the token needs no workflow grant", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read" },
      jobs: { publish: { permissions: { contents: "read", "id-token": "write" }, steps: [kitStep] } },
    }),
  ).toBe(true);
});

test("a document with no jobs grants no token to a publishing job", () => {
  expect(grantsOidc({ permissions: { contents: "read", "id-token": "write" } })).toBe(false);
  expect(grantsOidc({ permissions: "write-all" })).toBe(false);
});

test("a document with no publishing job grants no token", () => {
  expect(grantsOidc({ permissions: { contents: "read", "id-token": "write" }, jobs: { lint: { steps: [lintStep] } } })).toBe(false);
});

test("a job only named for publish metadata with no publish step grants no token", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read", "id-token": "write" },
      jobs: { validate: { name: "Validate npm publish metadata", steps: [{ run: "bun run lint" }] } },
    }),
  ).toBe(false);
});

test("no grant anywhere mints no token", () => {
  expect(grantsOidc({ permissions: { contents: "read" } })).toBe(false);
  expect(grantsOidc({ permissions: { contents: "read" }, jobs: { publish: { steps: [kitStep] } } })).toBe(false);
  expect(grantsOidc(undefined)).toBe(false);
});

function stepRuns(document: unknown, jobId: string): string[] {
  const job = workflowJobs({ path: "", document, text: "" }).find(([id]) => id === jobId)?.[1];
  const steps = isRecord(job) ? job["steps"] : undefined;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    const run = isRecord(step) ? step["run"] : undefined;
    return typeof run === "string" ? [run] : [];
  });
}

test("the release-push flow plans only after the preflight passes, so an untagged bump fails before release-push plans", async () => {
  const text = await readFile(join(REPO, ".github/workflows/release-push.yml"), "utf8");
  const runs = stepRuns(Bun.YAML.parse(text), "release");
  const preflight = runs.findIndex((run) => run.includes("release-preflight") && run.includes("release.yml"));
  const plan = runs.findIndex((run) => run.includes("release-push.ts"));
  expect(preflight).toBeGreaterThanOrEqual(0);
  expect(plan).toBeGreaterThanOrEqual(0);
  expect(preflight).toBeLessThan(plan);
  expect(runs[preflight] ?? "").toContain("chore: release");
});

test("the daily-release template plans only after the preflight passes, so an untagged bump fails before release-pr plans", async () => {
  const page = await readFile(join(REPO, "docs/gates/checks-release-pr.md"), "utf8");
  const fences = page.split(F).filter((_, index) => index % 2 === 1);
  const documents = fences.flatMap((fence) => {
    try {
      return [Bun.YAML.parse(fence.replace(/^[a-z]+\n/, ""))];
    } catch {
      return [];
    }
  });
  const template = documents.find((document) => isRecord(document) && document["name"] === "daily-release");
  const runs = stepRuns(template, "pull-request");
  const preflight = runs.findIndex((run) => run.includes("release-preflight") && run.includes("release.yml"));
  const plan = runs.findIndex((run) => run.includes("release-pr") && !run.includes("release-preflight"));
  expect(preflight).toBeGreaterThanOrEqual(0);
  expect(plan).toBeGreaterThanOrEqual(0);
  expect(preflight).toBeLessThan(plan);
});
