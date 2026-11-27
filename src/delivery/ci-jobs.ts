import { Effect, Schema } from "effect";
import { RELEASE_BRANCH_PREFIX } from "../core/release-names.ts";
import { SETTINGS_FILE, type ExtraTestJob } from "../core/settings.ts";
import { runFaults } from "./plain-steps.ts";
import { calledFileOf, isRecord, workflowJobs, type Workflow } from "./workflow-references.ts";

export type RepositoryKind = "code" | "site";

const DEFAULT_TEST_RUN = "bunx checks-test --pr";
export const RELEASE_TEST_RUN = "bunx checks-ci test";
const BROWSER_RUN = "bunx checks-browser --pr";

// Carried as a custom run, this keeps the step checks-plain-steps refuses, so a write reads it as the default.
const EXPRESSION_TEST_RUN = "${{ needs.changes.outputs.check-release == 'true' && 'bun run test' || 'bunx checks-test --pr' }}";

const heldTestRun = (run: string | undefined): string => (run === undefined || run === RELEASE_TEST_RUN || run === EXPRESSION_TEST_RUN ? DEFAULT_TEST_RUN : run);

const DEFAULT_RUNNER = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";

// A fork can name its head release/, and a dispatch holds no head_ref, so only the dispatch and the same-repository release/<base> pull request count.
export const RELEASE_RUN = `((github.event_name == 'workflow_dispatch' && startsWith(github.ref_name, '${RELEASE_BRANCH_PREFIX}')) || (github.event_name == 'pull_request' && github.head_ref == format('${RELEASE_BRANCH_PREFIX}{0}', github.base_ref) && github.event.pull_request.head.repo.full_name == github.repository))`;

export const SITE_BUILD = "site-dist";

const TestRunner = Schema.Union([Schema.String, Schema.NonEmptyArray(Schema.NonEmptyString)]);
type TestRunner = typeof TestRunner.Type;

export type TestJob = {
  readonly name: string;
  readonly run: string;
  readonly browsers: string;
  readonly readsBuild: boolean;
  readonly runsOn: TestRunner;
};

export type CiJobs = { readonly tests: readonly TestJob[] };

const FIXED_JOBS = ["changes", "static", "site", "checks"] as const;

const isFixed = (name: string, docsBuild: boolean): boolean =>
  (FIXED_JOBS as readonly string[]).includes(name) || (docsBuild && name === "docs");

const UNIT: TestJob = { name: "unit", run: `${DEFAULT_TEST_RUN} --tier=unit`, browsers: "", readsBuild: false, runsOn: DEFAULT_RUNNER };

const E2E: TestJob = { name: "e2e", run: `${DEFAULT_TEST_RUN} --tier=e2e`, browsers: "", readsBuild: false, runsOn: DEFAULT_RUNNER };

const BROWSER: TestJob = { name: "browser", run: BROWSER_RUN, browsers: "webkit", readsBuild: true, runsOn: DEFAULT_RUNNER };

export const isBrowserWalk = (test: TestJob): boolean => test.readsBuild && test.run === BROWSER_RUN;

export const testTierOf = (run: string): "unit" | "e2e" | undefined =>
  run === `${DEFAULT_TEST_RUN} --tier=unit` ? "unit" : run === `${DEFAULT_TEST_RUN} --tier=e2e` ? "e2e" : undefined;

export const DEFAULT_CI_JOBS: Readonly<Record<RepositoryKind, CiJobs>> = {
  code: { tests: [UNIT, E2E] },
  site: { tests: [UNIT, E2E, BROWSER] },
};

const DEFAULT_TEST_NAMES: readonly string[] = [UNIT, E2E, BROWSER].map(({ name }) => name);

// docs is refused without a docs:build script too, so adding the script later cannot collide with a declared job.
export function extraTestJobFault(job: ExtraTestJob): string | undefined {
  const at = `${SETTINGS_FILE} extraTestJobs job ${job.name}`;
  if (isFixed(job.name, true)) return `${at} takes a name the written ci.yml gives its own job, so rename it`;
  if (DEFAULT_TEST_NAMES.includes(job.name)) return `${at} takes the name of a default test job, so rename it`;
  const commands = [...(job.setup ?? []).map((command) => ["setup command", command] as const), ["run", job.run] as const];
  for (const [role, command] of commands) {
    const faults = runFaults(command, undefined);
    if (faults.length > 0) return `${at} ${role} ${JSON.stringify(command)} holds ${faults.join(", ")}, so run one plain command, or move the logic into a bin`;
  }
  return undefined;
}

const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

class CiJobsFault extends Schema.TaggedError<CiJobsFault>()("CiJobsFault", {
  message: Schema.String,
}) {}

export const TEST_STEP = "test";

export const PLAYWRIGHT_USES = "./.github/actions/playwright";

const FullStep = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  uses: Schema.optionalKey(Schema.String),
  run: Schema.optionalKey(Schema.String),
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const FullTestJob = Schema.Struct({
  needs: Schema.optionalKey(Schema.String),
  "runs-on": TestRunner,
  steps: Schema.Array(FullStep),
});

const decodeFullTestJob = Schema.decodeUnknownEffect(FullTestJob);

const defaultRunner = (held: TestRunner, runsOn: string): TestRunner => held === "ubuntu-latest" || held === DEFAULT_RUNNER ? runsOn : held;

const fullTestJobOf = Effect.fn("fullTestJobOf")(function* (kind: RepositoryKind, path: string, name: string, job: unknown, runsOn: string, docsBuild: boolean) {
  if (isFixed(name, docsBuild)) return yield* new CiJobsFault({ message: `${path} runs a test step in job ${name}, a name the written ci.yml gives its own job, so rename it` });
  if (!JOB_ID.test(name)) return yield* new CiJobsFault({ message: `${path} holds test job ${name}, a name the written ci.yml cannot give a test job, so rename it` });
  const held = yield* decodeFullTestJob(job).pipe(Effect.mapError((issue) => new CiJobsFault({ message: `${path} job ${name} is not a test job checks-workflows writes: ${issue.message}` })));
  const step = held.steps.find((candidate) => candidate.id === TEST_STEP);
  const tier = step?.env?.["TEST_TIER"];
  const run = step?.run === RELEASE_TEST_RUN && (tier === "unit" || tier === "e2e") ? `${DEFAULT_TEST_RUN} --tier=${tier}` : step?.run?.replace(/ --shard=\$\{\{ matrix\.shard \}\}\/\d+$/, "");
  const browsers = held.steps.find((candidate) => candidate.uses === PLAYWRIGHT_USES)?.with?.["browsers"];
  return {
    name,
    run: heldTestRun(run),
    browsers: typeof browsers === "string" ? browsers : "",
    readsBuild: kind === "site" && held.needs === "site",
    runsOn: defaultRunner(held["runs-on"], runsOn),
  } satisfies TestJob;
});

const TestInputs = Schema.Struct({
  run: Schema.optionalKey(Schema.String),
  browsers: Schema.optionalKey(Schema.String),
  artifact: Schema.optionalKey(Schema.String),
  "runs-on": Schema.optionalKey(Schema.String),
});

const decodeTestInputs = Schema.decodeUnknownEffect(TestInputs);

// The set decides hold itself, heavy no longer exists, and the options carry claude-version.
const REPLACED_INPUTS = ["hold", "heavy", "claude-version"] as const;

const CARRIED_INPUTS = ["run", "browsers", "artifact", "runs-on"] as const;

// The public gate refuses an expression it cannot show hosted, and the private gate refuses a literal it cannot override.
export const runnerOf = (publicRepository: boolean): string => (publicRepository ? "ubuntu-latest" : DEFAULT_RUNNER);

const defaultJobs = (kind: RepositoryKind, runsOn: string, hasE2e: boolean): CiJobs => ({ tests: DEFAULT_CI_JOBS[kind].tests.filter((test) => hasE2e || test.name !== "e2e").map((test) => ({ ...test, runsOn })) });

const splitLegacyJobs = Effect.fn("splitLegacyJobs")(function* (path: string, jobs: CiJobs, hasE2e: boolean) {
  const hasE2eJob = jobs.tests.some(({ name }) => name === "e2e");
  const narrowed: { readonly name: string; readonly counterpart: string }[] = [];
  const split = jobs.tests.flatMap((job) => {
    if (!hasE2e && job.name === "e2e" && /^(bunx checks-test|bun run test) --pr( --parallel=[1-9][0-9]*)? --tier=e2e$/.test(job.run)) return [];
    const match = /^(bunx checks-test|bun run test)( --pr)( --parallel=[1-9][0-9]*)?$/.exec(job.run);
    if (match === null || (job.name !== "test" && job.name !== "unit")) return [job];
    const run = `${match[1]}${match[2]}${match[3] ?? ""}`;
    const unit = { ...job, name: "unit", run: `${run} --tier=unit`, browsers: "" };
    const e2e = { ...job, name: "e2e", run: `${run} --tier=e2e`, browsers: job.browsers };
    if (hasE2e && !hasE2eJob) return [unit, e2e];
    if (hasE2e) narrowed.push({ name: job.name, counterpart: `${run} --tier=e2e` });
    return [unit];
  });
  const tests = !hasE2e || split.some(({ name }) => name === "e2e") ? split : (() => {
    const unit = split.find((job) => job.name === "unit" && /^(bunx checks-test|bun run test) --pr( --parallel=[1-9][0-9]*)? --tier=unit$/.test(job.run));
    return unit === undefined ? split : [...split, { ...unit, name: "e2e", run: unit.run.replace(/--tier=unit$/, "--tier=e2e"), browsers: "" }];
  })();
  const seen = new Set<string>();
  for (const job of tests) {
    if (seen.has(job.name)) return yield* new CiJobsFault({ message: `${path} holds two test jobs named ${job.name}, so rename one` });
    seen.add(job.name);
  }
  for (const { name, counterpart } of narrowed) {
    if (!tests.some((job) => job.name === "e2e" && job.run === counterpart)) {
      return yield* new CiJobsFault({ message: `${path} narrows all-tier job ${name} to unit tests with no e2e job running ${counterpart}, so rename the e2e job` });
    }
  }
  return { tests };
});

const testJobOf = Effect.fn("testJobOf")(function* (kind: RepositoryKind, path: string, name: string, job: Readonly<Record<string, unknown>>, runsOn: string, docsBuild: boolean) {
  if (!JOB_ID.test(name) || isFixed(name, docsBuild)) {
    return yield* new CiJobsFault({ message: `${path} calls test.yml from job ${name}, a name the written ci.yml cannot give a test job, so rename it` });
  }
  const inputs = job["with"] ?? {};
  if (!isRecord(inputs)) {
    return yield* new CiJobsFault({ message: `${path} job ${name} passes a test.yml input that does not parse, so remove it by hand` });
  }
  const extra = Object.keys(inputs).find((input) => ![...CARRIED_INPUTS, ...REPLACED_INPUTS].some((key) => key === input));
  if (extra !== undefined) {
    return yield* new CiJobsFault({
      message: `${path} job ${name} passes ${extra} to test.yml, an input the written ci.yml cannot carry, so remove it by hand`,
    });
  }
  const held = yield* decodeTestInputs(inputs).pipe(
    Effect.mapError((issue) => new CiJobsFault({ message: `${path} job ${name} passes a test.yml input that does not parse: ${issue.message}` })),
  );
  if (held.artifact !== undefined && !(kind === "site" && held.artifact === SITE_BUILD)) {
    return yield* new CiJobsFault({
      message: `${path} job ${name} passes artifact to test.yml, an input the written ci.yml cannot carry, so remove it by hand`,
    });
  }
  return {
    name,
    run: heldTestRun(held.run),
    browsers: held.browsers ?? "",
    readsBuild: kind === "site" && held.artifact === SITE_BUILD,
    runsOn: defaultRunner(held["runs-on"] ?? runsOn, runsOn),
  } satisfies TestJob;
});

const holdsTestStep = (job: Readonly<Record<string, unknown>>): boolean => {
  const steps = job["steps"];
  return Array.isArray(steps) && steps.some((step) => isRecord(step) && step["id"] === TEST_STEP);
};

// A written ci.yml marks each test job by the step whose id is test.
const fullCiJobsOf = Effect.fn("fullCiJobsOf")(function* (kind: RepositoryKind, ci: Workflow, runsOn: string, docsBuild: boolean, hasE2e: boolean, declared: readonly string[]) {
  const held = workflowJobs(ci).filter(([name, job]) => holdsTestStep(job) && !declared.includes(name));
  if (held.length === 0) return defaultJobs(kind, runsOn, hasE2e);
  return yield* splitLegacyJobs(ci.path, { tests: yield* Effect.forEach(held, ([name, job]) => fullTestJobOf(kind, ci.path, name, job, runsOn, docsBuild)) }, hasE2e);
});

// A ci.yml that calls test.yml records its test jobs in the call, so --write keeps them.
// The settings file records a declared job, so the held copy of it is no test job of the file.
export const ciJobsOf = Effect.fn("ciJobsOf")(function* (
  kind: RepositoryKind,
  ci: Workflow | undefined,
  { publicRepository, docsBuild, hasE2e, declared = [] }: { readonly publicRepository: boolean; readonly docsBuild: boolean; readonly hasE2e: boolean | undefined; readonly declared?: readonly string[] },
) {
  const runsOn = runnerOf(publicRepository);
  const includeE2e = hasE2e !== false;
  if (ci === undefined) return defaultJobs(kind, runsOn, includeE2e);
  const calls = workflowJobs(ci).flatMap(([name, job]) => (calledFileOf(job["uses"]) === "test.yml" && !declared.includes(name) ? [{ name, job }] : []));
  if (calls.length > 0) return yield* splitLegacyJobs(ci.path, { tests: yield* Effect.forEach(calls, ({ name, job }) => testJobOf(kind, ci.path, name, job, runsOn, docsBuild)) }, includeE2e);
  return yield* fullCiJobsOf(kind, ci, runsOn, docsBuild, includeE2e, declared);
});
