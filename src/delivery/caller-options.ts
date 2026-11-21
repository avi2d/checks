import { Option, Schema } from "effect";
import { crons } from "./release-schedule.ts";
import { weekly } from "./schedule-policy.ts";
import { calledFileOf, workflowJobs, type Workflow } from "./workflow-references.ts";

export type Flake = { readonly nodeVersionFile: string | undefined };

export type CallerOptions = {
  readonly advisoriesCron: string | undefined;
  readonly flake: Flake;
  readonly pages: Pages | undefined;
  readonly docsBuild: boolean;
  readonly secretsPack: boolean;
  readonly fullTest: boolean;
  readonly claudeVersion: string | undefined;
  readonly publishWorkspaces: boolean;
  readonly checkRelease: boolean;
  readonly publishes: boolean;
  readonly publicRepository: boolean;
};

export const NO_CALLER_OPTIONS: CallerOptions = {
  advisoriesCron: undefined,
  flake: { nodeVersionFile: undefined },
  pages: undefined,
  docsBuild: false,
  secretsPack: false,
  fullTest: false,
  claudeVersion: undefined,
  publishWorkspaces: false,
  checkRelease: false,
  publishes: false,
  publicRepository: false,
};

export type HeldWorkflow = (name: string) => Workflow | undefined;

const Step = Schema.Struct({
  uses: Schema.optionalKey(Schema.String),
  run: Schema.optionalKey(Schema.String),
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const decodeSteps = Schema.decodeUnknownOption(Schema.Struct({ steps: Schema.Array(Step) }));
const decodeFlakeInputs = Schema.decodeUnknownOption(Schema.Struct({ "node-version-file": Schema.optionalKey(Schema.String) }));
const PagesInputs = Schema.Struct({ build: Schema.String, path: Schema.String });

export type Pages = typeof PagesInputs.Type;

const decodePagesInputs = Schema.decodeUnknownOption(PagesInputs);
const decodeStaticInputs = Schema.decodeUnknownOption(Schema.Struct({ "secrets-pack": Schema.optionalKey(Schema.Boolean) }));

type Step = typeof Step.Type;

const stepsOf = (job: unknown): readonly Step[] => Option.match(decodeSteps(job), { onNone: () => [], onSome: ({ steps }) => steps });

const callsAction = (step: Step, action: string): boolean => step.uses?.split("@")[0]?.endsWith(action) === true;

// A repository still on reusable workflow calls keeps the options it passes when --write replaces the calls.
function callsOf(workflow: Workflow | undefined, file: string): readonly unknown[] {
  if (workflow === undefined) return [];
  return workflowJobs(workflow).flatMap(([, job]) => (calledFileOf(job["uses"]) === file ? [job["with"] ?? {}] : []));
}

function weeklyCronOf(advisories: Workflow | undefined): string | undefined {
  const [cron, ...rest] = crons(advisories?.document);
  return rest.length === 0 && typeof cron === "string" && weekly(cron) ? cron : undefined;
}

function heldNodeVersionFile(workflow: Workflow): string | undefined {
  const file = workflowJobs(workflow)
    .flatMap(([, job]) => stepsOf(job))
    .find((step) => callsAction(step, "actions/setup-node"))?.with?.["node-version-file"];
  return typeof file === "string" ? file : undefined;
}

function flakeOf(flake: Workflow | undefined): Flake {
  const [call] = callsOf(flake, "flake.yml");
  if (call !== undefined) {
    return Option.match(decodeFlakeInputs(call), {
      onNone: () => NO_CALLER_OPTIONS.flake,
      onSome: (inputs) => ({ nodeVersionFile: inputs["node-version-file"] }),
    });
  }
  return { nodeVersionFile: flake === undefined ? undefined : heldNodeVersionFile(flake) };
}

// A deploy builds with its one run step in the job that uploads the Pages artifact.
function pagesOf(docs: Workflow | undefined): Pages | undefined {
  if (docs === undefined) return undefined;
  const [call] = callsOf(docs, "github-pages.yml");
  if (call !== undefined) return Option.getOrUndefined(decodePagesInputs(call));
  for (const [, job] of workflowJobs(docs)) {
    const steps = stepsOf(job);
    const path = steps.find((step) => callsAction(step, "actions/upload-pages-artifact"))?.with?.["path"];
    const runs = steps.flatMap(({ run }) => (run === undefined ? [] : [run]));
    if (typeof path === "string" && runs.length === 1 && runs[0] !== undefined) return { build: runs[0], path };
  }
  return undefined;
}

function readsSecretsPack(ci: Workflow | undefined): boolean {
  const passed = callsOf(ci, "static.yml").some((call) => Option.match(decodeStaticInputs(call), { onNone: () => false, onSome: (inputs) => inputs["secrets-pack"] === true }));
  const unpacks = (step: Step): boolean => step.run?.trim() === "bunx checks-ci secrets-pack" || callsAction(step, "/secrets-pack");
  return passed || (ci !== undefined && workflowJobs(ci).some(([, job]) => stepsOf(job).some(unpacks)));
}

function claudeInputOf(inputs: unknown): string | undefined {
  if (typeof inputs !== "object" || inputs === null || !("claude-version" in inputs)) return undefined;
  return typeof inputs["claude-version"] === "string" ? inputs["claude-version"] : undefined;
}

function claudeVersionOf(workflows: readonly (Workflow | undefined)[]): string | undefined {
  for (const workflow of workflows) {
    if (workflow === undefined) continue;
    for (const [, job] of workflowJobs(workflow)) {
      const passed = claudeInputOf(job["with"]);
      if (passed !== undefined) return passed;
      for (const step of stepsOf(job)) {
        const installed = /(?:^|\s)@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)(?=\s|$)/.exec(step.run ?? "")?.[1];
        if (installed !== undefined) return installed;
      }
    }
  }
  return undefined;
}

const decodeEnv = Schema.decodeUnknownOption(Schema.Struct({ env: Schema.Record(Schema.String, Schema.Unknown) }));

const setsPublishWorkspaces = (step: unknown): boolean =>
  Option.match(decodeEnv(step), { onNone: () => false, onSome: ({ env }) => String(env["CHECKS_PUBLISH_WORKSPACES"]) === "true" });

const decodePublishWorkspaces = Schema.decodeUnknownOption(Schema.Struct({ "publish-workspaces": Schema.optionalKey(Schema.Boolean) }));

const passesPublishWorkspaces = (call: unknown): boolean =>
  Option.match(decodePublishWorkspaces(call), { onNone: () => false, onSome: (inputs) => inputs["publish-workspaces"] === true });

export function readsPublishWorkspaces(workflows: readonly Workflow[]): boolean {
  return workflows.some(
    (workflow) =>
      callsOf(workflow, "release-main.yml").some(passesPublishWorkspaces) ||
      workflowJobs(workflow).some(([, job]) => Array.isArray(job["steps"]) && job["steps"].some(setsPublishWorkspaces)),
  );
}

export function callerOptionsOf(held: HeldWorkflow, publishes: boolean, publishWorkspaces: boolean, needsReleaseChecks: boolean, publicRepository: boolean, docsBuild: boolean): CallerOptions {
  return {
    advisoriesCron: weeklyCronOf(held("advisories.yml")),
    flake: flakeOf(held("flake.yml")),
    pages: pagesOf(held("docs.yml")),
    docsBuild,
    secretsPack: readsSecretsPack(held("ci.yml")),
    fullTest: publishes,
    claudeVersion: claudeVersionOf([held("ci.yml"), held("flake.yml")]),
    publishWorkspaces,
    checkRelease: !publishes && needsReleaseChecks,
    publishes,
    publicRepository,
  };
}
