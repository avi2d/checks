import { Effect, Schema } from "effect";
import { SHARED_REPOSITORY } from "./mutation-workflow.ts";
import { RELEASE_BRANCH_PREFIX } from "../core/release-names.ts";
import { isRecord, workflowJobs, type Workflow } from "./workflow-references.ts";

export type RepositoryKind = "code" | "site";

export const DEFAULT_TEST_RUN = "bunx checks-test --pr";
export const RELEASE_TEST_RUN = "${{ needs.changes.outputs.check-release == 'true' && 'bun run test' || 'bunx checks-test --pr' }}";

const SHARED_RUNNER = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";

// A fork can name its head release/, and a dispatch holds no head_ref, so only the dispatch and the same-repository release/<base> pull request count.
export const RELEASE_RUN = `((github.event_name == 'workflow_dispatch' && startsWith(github.ref_name, '${RELEASE_BRANCH_PREFIX}')) || (github.event_name == 'pull_request' && github.head_ref == format('${RELEASE_BRANCH_PREFIX}{0}', github.base_ref) && github.event.pull_request.head.repo.full_name == github.repository))`;

export const SITE_BUILD = "site-dist";

export type TestJob = {
  readonly name: string;
  readonly run: string;
  readonly browsers: string;
  readonly readsBuild: boolean;
  readonly heavy: boolean;
  readonly runsOn: string;
};

export type CiJobs = { readonly changes: boolean; readonly tests: readonly TestJob[] };

const FIXED_JOBS = ["changes", "static", "site", "checks"] as const;

const UNIT: TestJob = { name: "unit", run: DEFAULT_TEST_RUN, browsers: "", readsBuild: false, heavy: false, runsOn: SHARED_RUNNER };

const BROWSER: TestJob = { name: "browser", run: "bunx checks-browser --pr", browsers: "webkit", readsBuild: true, heavy: true, runsOn: SHARED_RUNNER };

export const DEFAULT_CI_JOBS: Readonly<Record<RepositoryKind, CiJobs>> = {
  code: { changes: true, tests: [{ ...UNIT, name: "test" }] },
  site: { changes: true, tests: [UNIT, BROWSER] },
};

const SHARED_WORKFLOWS_PREFIX = `${SHARED_REPOSITORY}/.github/workflows/`;

export function sharedFileOf(uses: unknown): string | undefined {
  if (typeof uses !== "string" || !uses.startsWith(SHARED_WORKFLOWS_PREFIX)) return undefined;
  const [file] = uses.slice(SHARED_WORKFLOWS_PREFIX.length).split("@");
  return file;
}

const PART_FILES = ["changes.yml", "static.yml", "test.yml", "site-preview.yml", "gate.yml"] as const;

type Part = (typeof PART_FILES)[number];

function partOf(uses: unknown): Part | undefined {
  const file = sharedFileOf(uses);
  return PART_FILES.find((part) => part === file);
}

const TestInputs = Schema.Struct({
  run: Schema.optionalKey(Schema.String),
  browsers: Schema.optionalKey(Schema.String),
  artifact: Schema.optionalKey(Schema.String),
  heavy: Schema.optionalKey(Schema.Boolean),
  "runs-on": Schema.optionalKey(Schema.String),
});

const decodeTestInputs = Schema.decodeUnknownEffect(TestInputs);

const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

class CiJobsFault extends Schema.TaggedError<CiJobsFault>()("CiJobsFault", {
  message: Schema.String,
}) {}

const testJobOf = Effect.fn("testJobOf")(function* (kind: RepositoryKind, path: string, name: string, inputs: unknown) {
  if (!JOB_ID.test(name) || FIXED_JOBS.some((fixed) => fixed === name)) {
    return yield* new CiJobsFault({ message: `${path} calls test.yml from job ${name}, a name the composed ci.yml cannot give a test job, so rename it` });
  }
  const held = yield* decodeTestInputs(inputs ?? {}).pipe(
    Effect.mapError((issue) => new CiJobsFault({ message: `${path} job ${name} passes a test.yml input that does not parse: ${issue.message}` })),
  );
  return {
    name,
    run: held.run === RELEASE_TEST_RUN ? DEFAULT_TEST_RUN : (held.run ?? DEFAULT_TEST_RUN),
    browsers: held.browsers ?? "",
    readsBuild: kind === "site" && held.artifact === SITE_BUILD,
    heavy: held.heavy ?? false,
    runsOn: held["runs-on"] ?? SHARED_RUNNER,
  } satisfies TestJob;
});

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
  const held = yield* decodeFullTestJob(job).pipe(Effect.mapError((issue) => new CiJobsFault({ message: `${path} job ${name} is not a test job checks-workflows writes: ${issue.message}` })));
  const run = held.steps.find((step) => step.id === TEST_STEP)?.run;
  const browsers = held.steps.find((step) => step.uses === PLAYWRIGHT_USES)?.with?.["browsers"];
  return {
    name,
    run: run ?? DEFAULT_TEST_RUN,
    browsers: typeof browsers === "string" ? browsers : "",
    readsBuild: kind === "site" && held.needs === "site",
    heavy: false,
    runsOn: held["runs-on"],
  } satisfies TestJob;
});

const holdsTestStep = (job: Readonly<Record<string, unknown>>): boolean => {
  const steps = job["steps"];
  return Array.isArray(steps) && steps.some((step) => isRecord(step) && step["id"] === TEST_STEP);
};

// A written ci.yml marks each test job by the step whose id is test.
const fullCiJobsOf = Effect.fn("fullCiJobsOf")(function* (kind: RepositoryKind, ci: Workflow) {
  const held = workflowJobs(ci).filter(([name, job]) => !FIXED_JOBS.some((fixed) => fixed === name) && holdsTestStep(job));
  if (held.length === 0) return DEFAULT_CI_JOBS[kind];
  return { changes: true, tests: yield* Effect.forEach(held, ([name, job]) => fullTestJobOf(kind, ci.path, name, job)) } satisfies CiJobs;
});

// A ci.yml that calls no part, such as the single-job caller, records no choice, so it gets the default jobs of its kind.
export const ciJobsOf = Effect.fn("ciJobsOf")(function* (kind: RepositoryKind, ci: Workflow | undefined) {
  if (ci === undefined) return DEFAULT_CI_JOBS[kind];
  const parts = workflowJobs(ci).flatMap(([name, job]) => {
    const part = partOf(job["uses"]);
    return part === undefined ? [] : [{ name, job, part }];
  });
  if (parts.length === 0) return yield* fullCiJobsOf(kind, ci);
  const tests = yield* Effect.forEach(
    parts.filter(({ part }) => part === "test.yml"),
    ({ name, job }) => testJobOf(kind, ci.path, name, job["with"]),
  );
  return { changes: parts.some(({ part }) => part === "changes.yml"), tests } satisfies CiJobs;
});
