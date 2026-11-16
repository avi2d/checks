import type { CallerOptions, Flake, Pages } from "./caller-options.ts";
import { DEFAULT_TEST_RUN, SITE_BUILD, type RepositoryKind, type TestJob } from "./ci-jobs.ts";
import { SHARED_REPOSITORY } from "./mutation-workflow.ts";
import { RELEASE_BRANCH_PREFIX } from "./release-commit.ts";
import { MUTATION_WORKFLOW } from "./setup-workflow.ts";
import { SITE_NAME_KEYS, takesSiteNames, type CallerSet, type SiteNames } from "./site-names.ts";

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
  "github-pages.yml@v3": [],
  "pr-title.yml@v3": [],
  "preview-remove.yml@v3": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "release-main.yml@v3": [],
  "release-pr.yml@v3": [],
  "changes.yml@v3": [],
  "static.yml@v3": [],
  "test.yml@v3": [],
  "site-preview.yml@v3": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "gate.yml@v3": [],
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
  readonly inputs?: readonly Input[];
};

type Input = readonly [key: string, value: string, note?: string];

type Condition = { readonly test: string; readonly note?: string };

type CallingJob = {
  readonly job: string;
  readonly needs?: string;
  readonly condition?: Condition;
  readonly shared: SharedWorkflow;
  readonly permissions: string;
  readonly inputs?: readonly Input[];
  readonly secrets?: readonly string[];
};

const noted = (indent: string, line: string, note: string | undefined): readonly string[] => (note === undefined ? [indent + line] : [`${indent}# ${note}`, indent + line]);

function callingJobLines({ job, needs, condition, shared, permissions, inputs = [], secrets = SHARED_SECRETS[shared] }: CallingJob): readonly string[] {
  const lines = [`  ${job}:`];
  if (needs !== undefined) lines.push(`    needs: ${needs}`);
  if (condition !== undefined) lines.push(...noted("    ", `if: ${condition.test}`, condition.note));
  lines.push(`    uses: ${SHARED_WORKFLOWS}/${shared}`, `    permissions: { ${permissions} }`);
  if (inputs.length > 0) lines.push("    with:", ...inputs.flatMap(([key, value, note]) => noted("      ", `${key}: ${value}`, note)));
  if (secrets.length > 0) lines.push("    secrets:", ...secrets.map((secret) => `      ${secret}: \${{ secrets.${secret} }}`));
  return lines;
}

function workflowText({ name, on, concurrency }: Pick<Caller, "name" | "on" | "concurrency">, jobs: readonly CallingJob[]): string {
  const lines = [`name: ${name}`, "", "on:", ...on.map((line) => `  ${line}`), ""];
  if (concurrency !== undefined) {
    lines.push("concurrency:", `  group: ${concurrency.group}`, `  cancel-in-progress: ${String(concurrency.cancel)}`, "");
  }
  return [...lines, "jobs:", ...jobs.flatMap(callingJobLines), ""].join("\n");
}

function callerText(caller: Caller): string {
  const names = caller.with;
  const inputs = names === undefined ? (caller.inputs ?? []) : SITE_NAME_KEYS.map((key) => [key, `"${names[key]}"`] as const);
  return workflowText(caller, [{ job: caller.job, shared: caller.shared, permissions: caller.permissions, inputs }]);
}

const PULL_REQUEST = ["pull_request:", "  types: [opened, synchronize, reopened, ready_for_review]", "workflow_dispatch:"];
const BY_HAND = ["workflow_dispatch:"];
const PER_PULL_REQUEST = { group: "ci-${{ github.event.pull_request.number || github.run_id }}", cancel: true };

const CI = { name: "ci", on: PULL_REQUEST, concurrency: PER_PULL_REQUEST } as const;

const singleJobCaller = (shared: SharedWorkflow, permissions: string): Caller => ({ ...CI, job: "checks", shared, permissions });

const NOT_RELEASED = "needs.changes.outputs.release != 'true'";

const CHANGED = { test: `${NOT_RELEASED} && needs.changes.outputs.docs-only != 'true'` };

// A fork can name its head release/, and a dispatch holds no head_ref, so only the dispatch and the same-repository release/<base> pull request count.
const RELEASE_RUN = `((github.event_name == 'workflow_dispatch' && startsWith(github.ref_name, '${RELEASE_BRANCH_PREFIX}')) || (github.event_name == 'pull_request' && github.head_ref == format('${RELEASE_BRANCH_PREFIX}{0}', github.base_ref) && github.event.pull_request.head.repo.full_name == github.repository))`;

// A job that needs another skips with it, so only a job that needs none tests the release branch itself.
const NOT_RELEASE: Condition = {
  test: `\${{ !${RELEASE_RUN} }}`,
  note: `Runs on every run but the release run: a dispatch on a ${RELEASE_BRANCH_PREFIX} branch, or the pull request from ${RELEASE_BRANCH_PREFIX}<base> in this repository.`,
};

type Gated = Pick<CallingJob, "needs" | "condition">;

const quoted = (value: string): string => JSON.stringify(value);

const HOLD_OFF: Input = ["hold", "false"];

const SECRETS_PACK: Input = ["secrets-pack", "true"];

function testCallingJob(test: TestJob, kind: RepositoryKind, gated: Gated): CallingJob {
  const inputs: Input[] = [];
  if (test.run !== DEFAULT_TEST_RUN) inputs.push(["run", quoted(test.run)]);
  if (test.browsers !== "") inputs.push(["browsers", quoted(test.browsers)]);
  if (test.readsBuild) inputs.push(["artifact", quoted(SITE_BUILD)]);
  if (test.heavy) inputs.push(["heavy", "true"]);
  // A site job that starts before the preview would cancel the draft run before its preview link posts.
  if (kind === "site" && !test.readsBuild) inputs.push(["hold", "false"]);
  inputs.push(["runs-on", quoted(test.runsOn)]);
  return { job: test.name, ...(test.readsBuild ? { needs: "site" } : gated), shared: "test.yml@v3", permissions: "contents: read, actions: write", inputs };
}

function skipsInput(needed: readonly string[], changes: boolean): Input {
  if (!changes) return ["skips", `\${{ ${RELEASE_RUN} && '${needed.join(" ")}' || '' }}`, "The jobs the gate passes as skipped: every job on the release run."];
  const parts = needed.filter((job) => job !== "changes");
  const skipped = parts.filter((job) => job !== "static");
  const docsOnly = skipped.length > 0 ? `needs.changes.outputs.docs-only == 'true' && '${skipped.join(" ")}' || ` : "";
  const note = "The jobs the gate passes as skipped: every job but changes on the release run, and every job but changes and static on a docs-only change.";
  return ["skips", `\${{ needs.changes.outputs.release == 'true' && '${parts.join(" ")}' || ${docsOnly}'' }}`, note];
}

function gateJob(needed: readonly string[], changes: boolean): CallingJob {
  const inputs: Input[] = [["results", "${{ toJSON(needs) }}"], skipsInput(needed, changes)];
  // Without always() a failed part skips the gate, and the required check never reports.
  return { job: "checks", needs: `[${needed.join(", ")}]`, condition: { test: "always()" }, shared: "gate.yml@v3", permissions: "contents: read, statuses: write", inputs };
}

function composedCiText(set: CallerSet): string {
  const { changes, tests } = set.ci;
  const gated: Gated = changes ? { needs: "changes", condition: CHANGED } : { condition: NOT_RELEASE };
  const jobs: CallingJob[] = [];
  if (changes) jobs.push({ job: "changes", shared: "changes.yml@v3", permissions: "contents: read" });
  jobs.push({
    job: "static",
    ...(changes ? { needs: "changes", condition: { test: NOT_RELEASED } } : { condition: NOT_RELEASE }),
    shared: "static.yml@v3",
    permissions: "contents: read, actions: write, statuses: write, pull-requests: read",
    inputs: [...(set.kind === "site" ? [HOLD_OFF] : []), ...(set.options.secretsPack ? [SECRETS_PACK] : [])],
    ...(set.options.secretsPack ? { secrets: ["CHECKS_SECRETS_PACK"] } : {}),
  });
  if (set.kind === "site") {
    jobs.push({ job: "site", ...gated, shared: "site-preview.yml@v3", permissions: "contents: read, pull-requests: write", inputs: [["pages", quoted(set.names.pages)]] });
  }
  jobs.push(...tests.map((test) => testCallingJob(test, set.kind, gated)));
  return workflowText(CI, [...jobs, gateJob(jobs.map(({ job }) => job), changes)]);
}

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

// release-main holds no group, so the caller serializes pushes to main.
const releaseMain = (fullTest: boolean): Caller => ({
  ...mainCaller("release-main.yml@v3", "contents: write, id-token: write, actions: read, pull-requests: read", { group: "main", cancel: false }),
  ...(fullTest ? { inputs: [["full-test", "true"]] } : {}),
});

const codeCallers = (options: CallerOptions): readonly Caller[] => [PR_TITLE, releaseMain(options.fullTest), RELEASE];

const filesOf = (callers: readonly Caller[]): readonly WorkflowFile[] => callers.map((caller) => ({ name: `${caller.name}.yml`, text: callerText(caller) }));

// The shared workflow's own schedule fires only in its own repository, so a caller that scans weekly holds its cron.
const advisoriesFile = (cron: string | undefined): WorkflowFile => ({
  name: "advisories.yml",
  text: callerText({
    name: "advisories",
    on: cron === undefined ? BY_HAND : [...BY_HAND, "schedule:", `  - cron: ${quoted(cron)}`],
    job: "advisories",
    shared: "advisories.yml@v3",
    permissions: "contents: read, issues: write",
  }),
});

const flakeFile = ({ runs, nodeVersionFile }: Flake): WorkflowFile => ({
  name: "flake.yml",
  text: callerText({
    name: "flake",
    on: BY_HAND,
    job: "flake",
    shared: "flake.yml@v3",
    permissions: "contents: read",
    inputs: [...(runs === undefined ? [] : [["runs", quoted(runs)] as const]), ...(nodeVersionFile === undefined ? [] : [["node-version-file", quoted(nodeVersionFile)] as const])],
  }),
});

// github-pages.yml holds the deploy group itself, so a caller group would only queue a second run behind the first.
const docsFile = ({ build, path }: Pages): WorkflowFile => ({
  name: "docs.yml",
  text: callerText({
    name: "docs",
    on: ["push:", "  branches: [main]", "workflow_dispatch:"],
    job: "pages",
    shared: "github-pages.yml@v3",
    permissions: "contents: read, pages: write, id-token: write",
    inputs: [
      ["build", quoted(build)],
      ["path", quoted(path)],
    ],
  }),
});

const MUTATION: WorkflowFile = { name: "mutation.yml", text: MUTATION_WORKFLOW };

export function requiredSet(set: CallerSet): readonly WorkflowFile[] {
  return [{ name: "ci.yml", text: composedCiText(set) }, ...filesOf(set.kind === "site" ? siteCallers(set.names) : codeCallers(set.options))];
}

function singleJobCiText(set: CallerSet): string {
  if (set.kind === "code") return callerText(singleJobCaller("ci.yml@v3", "contents: read, actions: write, statuses: write, pull-requests: read"));
  return callerText({ ...singleJobCaller("site-ci.yml@v3", "contents: read, actions: write, statuses: write, pull-requests: write"), with: set.names });
}

// The single-job ci.yml stays accepted until the repository runs --write, so a kit upgrade alone fails no pull request.
export function holdsSingleJobCi(set: CallerSet, present: readonly WorkflowFile[]): boolean {
  const text = singleJobCiText(set);
  return present.some((file) => file.name === "ci.yml" && file.text === text);
}

// A by-hand caller may be absent, but a present one holds exactly this text.
export function byHandSet(set: CallerSet): readonly WorkflowFile[] {
  const { advisoriesCron, flake, pages } = set.options;
  const docs = pages === undefined ? [] : [docsFile(pages)];
  return set.kind === "site" ? [advisoriesFile(advisoriesCron), ...docs] : [advisoriesFile(advisoriesCron), MUTATION, flakeFile(flake), ...docs];
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
  const byHand = byHandSet(set);
  const known = new Set([...required, ...byHand].map(({ name }) => name));
  const judged = [...required, ...byHand.filter(({ name }) => held.has(name))];
  const singleJob = holdsSingleJobCi(set, present);
  return [
    ...judged.flatMap((file): readonly Difference[] => {
      const text = held.get(file.name);
      if (text === undefined) return [{ kind: "missing", name: file.name }];
      if (text === file.text || (file.name === "ci.yml" && singleJob)) return [];
      return [{ kind: "differs", name: file.name, lines: differentLines(text, file.text) }];
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
