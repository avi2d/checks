import { SHARED_REPOSITORY } from "./mutation-workflow.ts";
import { MUTATION_WORKFLOW } from "./setup-workflow.ts";

export type RepositoryKind = "site" | "code";

export function kindOf(site: unknown): RepositoryKind {
  return site === undefined ? "code" : "site";
}

export function isIgnoredWorkflow(name: string): boolean {
  return name === "pr-text.yml";
}

export type WorkflowFile = { readonly name: string; readonly text: string };

export type Difference =
  | { readonly kind: "missing"; readonly name: string }
  | { readonly kind: "extra"; readonly name: string }
  | { readonly kind: "differs"; readonly name: string; readonly lines: readonly DifferentLine[] };

type DifferentLine = { readonly line: number; readonly holds: string | undefined; readonly writes: string | undefined };

const SHARED_WORKFLOWS = `${SHARED_REPOSITORY}/.github/workflows`;

type Caller = {
  readonly name: string;
  readonly on: readonly string[];
  readonly concurrency?: { readonly group: string; readonly cancel: boolean };
  readonly job: string;
  readonly uses: string;
  readonly permissions: string;
  readonly secrets?: true;
};

function callerText({ name, on, concurrency, job, uses, permissions, secrets }: Caller): string {
  const lines = [`name: ${name}`, "", "on:", ...on.map((line) => `  ${line}`), ""];
  if (concurrency !== undefined) {
    lines.push("concurrency:", `  group: ${concurrency.group}`, `  cancel-in-progress: ${String(concurrency.cancel)}`, "");
  }
  lines.push("jobs:", `  ${job}:`, `    uses: ${uses}`, `    permissions: { ${permissions} }`);
  if (secrets === true) lines.push("    secrets: inherit");
  return [...lines, ""].join("\n");
}

const PULL_REQUEST = ["pull_request:", "  types: [opened, synchronize, reopened, ready_for_review]", "workflow_dispatch:"];
const BY_HAND = ["workflow_dispatch:"];
const PER_PULL_REQUEST = { group: "ci-${{ github.event.pull_request.number || github.run_id }}", cancel: true };

const ciCaller = (shared: string, permissions: string, secrets: boolean): Caller => ({
  name: "ci",
  on: PULL_REQUEST,
  concurrency: PER_PULL_REQUEST,
  job: "checks",
  uses: `${SHARED_WORKFLOWS}/${shared}@v3`,
  permissions,
  ...(secrets ? { secrets: true } : {}),
});

const PR_TITLE: Caller = {
  name: "pr-title",
  on: ["pull_request:", "  types: [edited]"],
  concurrency: { group: "pr-title-${{ github.event.pull_request.number }}", cancel: true },
  job: "title",
  uses: `${SHARED_WORKFLOWS}/pr-title.yml@v3`,
  permissions: "contents: read, statuses: write, pull-requests: read",
};

// The shared job holds a group for each release commit, so a caller-level group would cancel a pending release run.
const mainCaller = (shared: string, permissions: string, secrets: boolean): Caller => ({
  name: "main",
  on: ["push:", "  branches: [main]"],
  job: "release",
  uses: `${SHARED_WORKFLOWS}/${shared}@v3`,
  permissions,
  ...(secrets ? { secrets: true } : {}),
});

// A caller-level group of the same name deadlocks the shared job that holds release-pull-request.
const RELEASE: Caller = {
  name: "release",
  on: BY_HAND,
  job: "pull-request",
  uses: `${SHARED_WORKFLOWS}/release-pr.yml@v3`,
  permissions: "contents: write, pull-requests: write, actions: write",
};

const SITE: readonly Caller[] = [
  ciCaller("site-ci.yml", "contents: read, actions: write, statuses: write, pull-requests: write", true),
  PR_TITLE,
  {
    name: "preview-close",
    on: ["pull_request:", "  types: [closed]"],
    job: "preview",
    uses: `${SHARED_WORKFLOWS}/preview-remove.yml@v3`,
    permissions: "contents: read, pull-requests: write",
    secrets: true,
  },
  mainCaller("site-main.yml", "contents: write, actions: read, pull-requests: read", true),
  RELEASE,
  {
    name: "production",
    on: BY_HAND,
    job: "production",
    uses: `${SHARED_WORKFLOWS}/site-production.yml@v3`,
    permissions: "contents: read, actions: read, pull-requests: read",
    secrets: true,
  },
];

const CODE: readonly Caller[] = [
  ciCaller("ci.yml", "contents: read, actions: write, statuses: write, pull-requests: read", false),
  PR_TITLE,
  mainCaller("release-main.yml", "contents: write, id-token: write, actions: read, pull-requests: read", false),
  RELEASE,
];

const filesOf = (callers: readonly Caller[]): readonly WorkflowFile[] => callers.map((caller) => ({ name: `${caller.name}.yml`, text: callerText(caller) }));

const ADVISORIES: WorkflowFile = {
  name: "advisories.yml",
  text: callerText({ name: "advisories", on: BY_HAND, job: "advisories", uses: `${SHARED_WORKFLOWS}/advisories.yml@v3`, permissions: "contents: read, issues: write" }),
};

const FLAKE: WorkflowFile = {
  name: "flake.yml",
  text: callerText({ name: "flake", on: BY_HAND, job: "flake", uses: `${SHARED_WORKFLOWS}/flake.yml@v3`, permissions: "contents: read" }),
};

const MUTATION: WorkflowFile = { name: "mutation.yml", text: MUTATION_WORKFLOW };

export function requiredSet(kind: RepositoryKind): readonly WorkflowFile[] {
  return filesOf(kind === "site" ? SITE : CODE);
}

// A by-hand caller may be absent, but a present one holds exactly this text.
export function byHandSet(kind: RepositoryKind): readonly WorkflowFile[] {
  return kind === "site" ? [ADVISORIES] : [ADVISORIES, MUTATION, FLAKE];
}

function differentLines(holds: string, writes: string): readonly DifferentLine[] {
  const held = holds.split("\n");
  const written = writes.split("\n");
  return Array.from({ length: Math.max(held.length, written.length) }, (_, index) => ({ line: index + 1, holds: held[index], writes: written[index] })).filter(
    ({ holds: one, writes: other }) => one !== other,
  );
}

export function differencesOf(kind: RepositoryKind, present: readonly WorkflowFile[]): readonly Difference[] {
  const held = new Map(present.filter(({ name }) => !isIgnoredWorkflow(name)).map(({ name, text }) => [name, text]));
  const required = requiredSet(kind);
  const byHand = byHandSet(kind);
  const known = new Set([...required, ...byHand].map(({ name }) => name));
  const judged = [...required, ...byHand.filter(({ name }) => held.has(name))];
  return [
    ...judged.flatMap((file): readonly Difference[] => {
      const text = held.get(file.name);
      if (text === undefined) return [{ kind: "missing", name: file.name }];
      return text === file.text ? [] : [{ kind: "differs", name: file.name, lines: differentLines(text, file.text) }];
    }),
    ...present.filter(({ name }) => !known.has(name) && !isIgnoredWorkflow(name)).map(({ name }): Difference => ({ kind: "extra", name })),
  ];
}

const shown = (text: string | undefined): string => (text === undefined ? "no line" : JSON.stringify(text));

export function differenceLines(directory: string, difference: Difference): readonly string[] {
  const path = `${directory}/${difference.name}`;
  if (difference.kind === "missing") return [`  ${path}: missing`];
  if (difference.kind === "extra") return [`  ${path}: no workflow of the set, so delete it`];
  return [
    `  ${path}: differs from the caller checks-workflows writes`,
    ...difference.lines.map(({ line, holds, writes }) => `    line ${line}: holds ${shown(holds)}, the caller holds ${shown(writes)}`),
  ];
}
