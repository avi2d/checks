import { SHARED_REPOSITORY } from "./mutation-workflow.ts";
import { MUTATION_WORKFLOW } from "./setup-workflow.ts";
import { SITE_NAME_KEYS, takesSiteNames, type CallerSet, type SiteNames } from "./site-names.ts";

export type RepositoryKind = CallerSet["kind"];

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

// GitHub passes `secrets: inherit` only to a workflow of the same organization or enterprise, so each caller names what its shared workflow declares.
const SHARED_SECRETS = {
  "advisories.yml@v3": [],
  "ci.yml@v3": [],
  "flake.yml@v3": [],
  "pr-title.yml@v3": [],
  "preview-remove.yml@v3": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "release-main.yml@v3": [],
  "release-pr.yml@v3": [],
  "site-ci.yml@v3": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "site-main.yml@v3": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "site-production.yml@v3": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "PRODUCTION_DEPLOY_KEY"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

type SharedWorkflow = keyof typeof SHARED_SECRETS;

type Caller = {
  readonly name: string;
  readonly on: readonly string[];
  readonly concurrency?: { readonly group: string; readonly cancel: boolean };
  readonly job: string;
  readonly shared: SharedWorkflow;
  readonly permissions: string;
  readonly with?: SiteNames;
};

function callerText({ name, with: names, on, concurrency, job, shared, permissions }: Caller): string {
  const lines = [`name: ${name}`, "", "on:", ...on.map((line) => `  ${line}`), ""];
  if (concurrency !== undefined) {
    lines.push("concurrency:", `  group: ${concurrency.group}`, `  cancel-in-progress: ${String(concurrency.cancel)}`, "");
  }
  lines.push("jobs:", `  ${job}:`, `    uses: ${SHARED_WORKFLOWS}/${shared}`, `    permissions: { ${permissions} }`);
  if (names !== undefined) lines.push("    with:", ...SITE_NAME_KEYS.map((key) => `      ${key}: ${names[key]}`));
  const secrets: readonly string[] = SHARED_SECRETS[shared];
  if (secrets.length > 0) lines.push("    secrets:", ...secrets.map((secret) => `      ${secret}: \${{ secrets.${secret} }}`));
  return [...lines, ""].join("\n");
}

const PULL_REQUEST = ["pull_request:", "  types: [opened, synchronize, reopened, ready_for_review]", "workflow_dispatch:"];
const BY_HAND = ["workflow_dispatch:"];
const PER_PULL_REQUEST = { group: "ci-${{ github.event.pull_request.number || github.run_id }}", cancel: true };

const ciCaller = (shared: SharedWorkflow, permissions: string): Caller => ({
  name: "ci",
  on: PULL_REQUEST,
  concurrency: PER_PULL_REQUEST,
  job: "checks",
  shared,
  permissions,
});

const PR_TITLE: Caller = {
  name: "pr-title",
  on: ["pull_request:", "  types: [edited]"],
  concurrency: { group: "pr-title-${{ github.event.pull_request.number }}", cancel: true },
  job: "title",
  shared: "pr-title.yml@v3",
  permissions: "contents: read, statuses: write, pull-requests: read",
};

// site-main queues each release commit in its shared job, so a caller group would cancel a pending release.
const mainCaller = (shared: SharedWorkflow, permissions: string, concurrency?: Caller["concurrency"]): Caller => ({
  name: "main",
  on: ["push:", "  branches: [main]"],
  ...(concurrency === undefined ? {} : { concurrency }),
  job: "release",
  shared,
  permissions,
});

// A caller-level group of the same name deadlocks the shared job that holds release-pull-request.
const RELEASE: Caller = {
  name: "release",
  on: BY_HAND,
  job: "pull-request",
  shared: "release-pr.yml@v3",
  permissions: "contents: write, pull-requests: write, actions: write",
};

const SITE: readonly Caller[] = [
  ciCaller("site-ci.yml@v3", "contents: read, actions: write, statuses: write, pull-requests: write"),
  PR_TITLE,
  {
    name: "preview-close",
    on: ["pull_request:", "  types: [closed]"],
    job: "preview",
    shared: "preview-remove.yml@v3",
    permissions: "contents: read, pull-requests: write",
  },
  mainCaller("site-main.yml@v3", "contents: write, actions: read, pull-requests: read"),
  RELEASE,
  {
    name: "production",
    on: BY_HAND,
    job: "production",
    shared: "site-production.yml@v3",
    permissions: "contents: read, actions: read, pull-requests: read",
  },
];

const siteCallers = (names: SiteNames): readonly Caller[] => SITE.map((caller) => (takesSiteNames(caller.shared) ? { ...caller, with: names } : caller));

const CODE: readonly Caller[] = [
  ciCaller("ci.yml@v3", "contents: read, actions: write, statuses: write, pull-requests: read"),
  PR_TITLE,
// release-main holds no group, so the caller serializes pushes to main.
  mainCaller("release-main.yml@v3", "contents: write, id-token: write, actions: read, pull-requests: read", { group: "main", cancel: false }),
  RELEASE,
];

const filesOf = (callers: readonly Caller[]): readonly WorkflowFile[] => callers.map((caller) => ({ name: `${caller.name}.yml`, text: callerText(caller) }));

const ADVISORIES: WorkflowFile = {
  name: "advisories.yml",
  text: callerText({ name: "advisories", on: BY_HAND, job: "advisories", shared: "advisories.yml@v3", permissions: "contents: read, issues: write" }),
};

const FLAKE: WorkflowFile = {
  name: "flake.yml",
  text: callerText({ name: "flake", on: BY_HAND, job: "flake", shared: "flake.yml@v3", permissions: "contents: read" }),
};

const MUTATION: WorkflowFile = { name: "mutation.yml", text: MUTATION_WORKFLOW };

export function requiredSet(set: CallerSet): readonly WorkflowFile[] {
  return filesOf(set.kind === "site" ? siteCallers(set.names) : CODE);
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

export function differencesOf(set: CallerSet, present: readonly WorkflowFile[]): readonly Difference[] {
  const held = new Map(present.filter(({ name }) => !isIgnoredWorkflow(name)).map(({ name, text }) => [name, text]));
  const required = requiredSet(set);
  const byHand = byHandSet(set.kind);
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
