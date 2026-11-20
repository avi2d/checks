import { Effect, Schema } from "effect";
import { RELEASE_BRANCH_PREFIX } from "../core/release-names.ts";
import { calledFileOf, isRecord, workflowJobs, type Workflow } from "./workflow-references.ts";

export type RepositoryKind = "code" | "site";

export const DEFAULT_TEST_RUN = "bunx checks-test --pr";
export const RELEASE_TEST_RUN = "${{ needs.changes.outputs.check-release == 'true' && 'bun run test' || 'bunx checks-test --pr' }}";

const DEFAULT_RUNNER = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";

// A fork can name its head release/, and a dispatch holds no head_ref, so only the dispatch and the same-repository release/<base> pull request count.
export const RELEASE_RUN = `((github.event_name == 'workflow_dispatch' && startsWith(github.ref_name, '${RELEASE_BRANCH_PREFIX}')) || (github.event_name == 'pull_request' && github.head_ref == format('${RELEASE_BRANCH_PREFIX}{0}', github.base_ref) && github.event.pull_request.head.repo.full_name == github.repository))`;

export const SITE_BUILD = "site-dist";

export type TestJob = {
  readonly name: string;
  readonly run: string;
  readonly browsers: string;
  readonly readsBuild: boolean;
  readonly runsOn: string;
};

export type CiJobs = { readonly tests: readonly TestJob[] };

const FIXED_JOBS = ["changes", "static", "site", "checks"] as const;

const UNIT: TestJob = { name: "unit", run: DEFAULT_TEST_RUN, browsers: "", readsBuild: false, runsOn: DEFAULT_RUNNER };

const BROWSER: TestJob = { name: "browser", run: "bunx checks-browser --pr", browsers: "webkit", readsBuild: true, runsOn: DEFAULT_RUNNER };

export const DEFAULT_CI_JOBS: Readonly<Record<RepositoryKind, CiJobs>> = {
  code: { tests: [{ ...UNIT, name: "test" }] },
  site: { tests: [UNIT, BROWSER] },
};

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
});

const FullTestJob = Schema.Struct({
  needs: Schema.optionalKey(Schema.String),
  "runs-on": Schema.String,
  steps: Schema.Array(FullStep),
});

const decodeFullTestJob = Schema.decodeUnknownEffect(FullTestJob);

const fullTestJobOf = Effect.fn("fullTestJobOf")(function* (kind: RepositoryKind, path: string, name: string, job: unknown) {
  if (FIXED_JOBS.some((fixed) => fixed === name)) return yield* new CiJobsFault({ message: `${path} runs a test step in job ${name}, a name the written ci.yml gives its own job, so rename it` });
  if (!JOB_ID.test(name)) return yield* new CiJobsFault({ message: `${path} holds test job ${name}, a name the written ci.yml cannot give a test job, so rename it` });
  const held = yield* decodeFullTestJob(job).pipe(Effect.mapError((issue) => new CiJobsFault({ message: `${path} job ${name} is not a test job checks-workflows writes: ${issue.message}` })));
  const run = held.steps.find((step) => step.id === TEST_STEP)?.run;
  const browsers = held.steps.find((step) => step.uses === PLAYWRIGHT_USES)?.with?.["browsers"];
  return {
    name,
    run: run === undefined || run === RELEASE_TEST_RUN ? DEFAULT_TEST_RUN : run,
    browsers: typeof browsers === "string" ? browsers : "",
    readsBuild: kind === "site" && held.needs === "site",
    runsOn: held["runs-on"],
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

const testJobOf = Effect.fn("testJobOf")(function* (kind: RepositoryKind, path: string, name: string, job: Readonly<Record<string, unknown>>) {
  if (!JOB_ID.test(name) || FIXED_JOBS.some((fixed) => fixed === name)) {
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
    run: held.run === RELEASE_TEST_RUN ? DEFAULT_TEST_RUN : (held.run ?? DEFAULT_TEST_RUN),
    browsers: held.browsers ?? "",
    readsBuild: kind === "site" && held.artifact === SITE_BUILD,
    runsOn: held["runs-on"] ?? DEFAULT_RUNNER,
  } satisfies TestJob;
});

const holdsTestStep = (job: Readonly<Record<string, unknown>>): boolean => {
  const steps = job["steps"];
  return Array.isArray(steps) && steps.some((step) => isRecord(step) && step["id"] === TEST_STEP);
};

// A written ci.yml marks each test job by the step whose id is test.
const fullCiJobsOf = Effect.fn("fullCiJobsOf")(function* (kind: RepositoryKind, ci: Workflow) {
  const held = workflowJobs(ci).filter(([, job]) => holdsTestStep(job));
  if (held.length === 0) return DEFAULT_CI_JOBS[kind];
  return { tests: yield* Effect.forEach(held, ([name, job]) => fullTestJobOf(kind, ci.path, name, job)) } satisfies CiJobs;
});

// A ci.yml that calls test.yml records its test jobs in the call, so --write keeps them.
export const ciJobsOf = Effect.fn("ciJobsOf")(function* (kind: RepositoryKind, ci: Workflow | undefined) {
  if (ci === undefined) return DEFAULT_CI_JOBS[kind];
  const calls = workflowJobs(ci).flatMap(([name, job]) => (calledFileOf(job["uses"]) === "test.yml" ? [{ name, job }] : []));
  if (calls.length > 0) return { tests: yield* Effect.forEach(calls, ({ name, job }) => testJobOf(kind, ci.path, name, job)) } satisfies CiJobs;
  return yield* fullCiJobsOf(kind, ci);
});
