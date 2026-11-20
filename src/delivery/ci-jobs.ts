import { Effect, Schema } from "effect";
import { RELEASE_BRANCH_PREFIX } from "../core/release-names.ts";
import { isRecord, workflowJobs, type Workflow } from "./workflow-references.ts";

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

export const ciJobsOf = Effect.fn("ciJobsOf")(function* (kind: RepositoryKind, ci: Workflow | undefined) {
  return ci === undefined ? DEFAULT_CI_JOBS[kind] : yield* fullCiJobsOf(kind, ci);
});
