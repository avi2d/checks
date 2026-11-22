import { type CallerSet } from "../site-names.ts";
import { type TestJob, TEST_STEP, PLAYWRIGHT_USES, RELEASE_RUN, SITE_BUILD, DEFAULT_TEST_RUN, RELEASE_TEST_RUN, runnerOf } from "../ci-jobs.ts";
import { CACHE, UPLOAD, DOWNLOAD, WRANGLER_VERSION, type Step, type Job, type Workflow, expression, scalar, HEAD, TOKEN, checkout, SETUP, ciCommand, DRAFT_HOLD, keepArtifacts, claudeInstall, node24, cloudflare, CLOUDFLARE_SET, ASTRO_QUIET, PREVIEW_PROJECT, PREVIEW_MARKER, siteEnv } from "./steps.ts";

const NOT_RELEASED = "needs.changes.outputs.release != 'true'";
const CHECKED_RELEASE = "needs.changes.outputs.check-release == 'true'";
const NOT_DOCS_ONLY = "needs.changes.outputs.docs-only != 'true'";
const NOT_TESTS_ONLY = "needs.changes.outputs.tests-only != 'true'";

const checksRelease = (set: CallerSet): boolean => set.kind === "code" && set.options.checkRelease;

// A repository that checks release pull requests runs every job but the classify step on the release run too.
const notReleased = (set: CallerSet): string => (checksRelease(set) ? "(" + NOT_RELEASED + " || " + CHECKED_RELEASE + ")" : NOT_RELEASED);

const changesJob = (set: CallerSet): Job => ({
  id: "changes",
  runsOn: runnerOf(set.options.publicRepository),
  timeout: 10,
  permissions: ["contents: read"],
  env: [["RELEASE", expression(RELEASE_RUN)]],
  outputs: [
    ["docs-only", expression("steps.classify.outputs.docs-only || 'false'")],
    ["tests-only", expression("steps.classify.outputs.tests-only || 'false'")],
    ["release", expression("env.RELEASE")],
    ...(checksRelease(set) ? [["check-release", expression("env.RELEASE")] as const] : []),
  ],
  steps: [
    { if: "env.RELEASE != 'true'", ...checkout({ ref: HEAD, history: true }) },
    { if: "env.RELEASE != 'true'", ...SETUP },
    ciCommand("changes", { if: "env.RELEASE != 'true'", id: "classify", name: "classify the change as docs-only, tests-only or full" }, [["BASE_SHA", expression("github.event.pull_request.base.sha")]]),
  ],
});

// A held job cancels the whole run on a push to a draft, and a site's preview link must still post.
const holds = (set: CallerSet, test?: TestJob): boolean => set.kind === "code" || test?.readsBuild === true;

const holdSteps = (hold: boolean): readonly Step[] => (hold ? [DRAFT_HOLD] : []);

const holdPermissions = (hold: boolean): readonly string[] => (hold ? ["contents: read", "actions: write"] : ["contents: read"]);

function staticJob(set: CallerSet, kit: boolean): Job {
  const hold = holds(set);
  const gitleaks = kit ? "src/delivery/gitleaks.ts" : "node_modules/@avi2dg/checks/src/delivery/gitleaks.ts";
  return {
    id: "static",
    needs: "changes",
    if: notReleased(set),
    runsOn: runnerOf(set.options.publicRepository),
    timeout: 20,
    permissions: holdPermissions(hold),
    steps: [
      checkout({ ref: HEAD, history: true }),
      SETUP,
      ...holdSteps(hold),
      {
        name: "cache the gitleaks the kit pins",
        if: "runner.environment == 'github-hosted'",
        uses: CACHE,
        with: [
          ["path", "~/.cache/avi2dg-checks/gitleaks"],
          ["key", "gitleaks-" + expression("runner.os") + "-" + expression("runner.arch") + "-" + expression("hashFiles('" + gitleaks + "')")],
        ],
      },
      { run: "bunx checks-workflows" },
      ...(set.options.secretsPack ? [ciCommand("secrets-pack", { name: "unpack the private secrets pack" }, [["PACK", expression("secrets.CHECKS_SECRETS_PACK")]])] : []),
      { run: "bun run lint" },
      { run: "bun run build" },
      { run: "git diff --exit-code" },
      { run: "bun run typecheck" },
    ],
  };
}

const docsJob = (set: CallerSet): Job => ({
  id: "docs",
  needs: "changes",
  if: notReleased(set),
  runsOn: runnerOf(set.options.publicRepository),
  timeout: 15,
  permissions: ["contents: read"],
  steps: [checkout({ ref: HEAD }), SETUP, { run: "bun run docs:build" }],
});

export const PULL_REQUEST_HEAD = expression("github.event.pull_request.head.sha");
export const PULL_REQUEST_BRANCH = expression("github.event.pull_request.head.ref");
export const PULL_REQUEST_NUMBER = expression("github.event.pull_request.number");

const siteJob = (set: CallerSet): Job => ({
  id: "site",
  needs: "changes",
  if: [notReleased(set), NOT_DOCS_ONLY, NOT_TESTS_ONLY].join(" && "),
  runsOn: runnerOf(set.options.publicRepository),
  timeout: 15,
  permissions: ["contents: read", "pull-requests: write"],
  env: [ASTRO_QUIET, CLOUDFLARE_SET],
  steps: [
    checkout({ ref: HEAD }),
    SETUP,
    { note: "A fork's or Dependabot's pull request runs without the repository secrets, so it gets no preview.", if: "env.CLOUDFLARE_SET != 'true'", run: 'echo "the Cloudflare secrets are not set, so this run deploys no preview"' },
    ciCommand("preview-address", { id: "preview", if: "env.CLOUDFLARE_SET == 'true' && github.event_name == 'pull_request'", name: "read the preview address of the branch" }, [
      ...cloudflare,
      ["PROJECT", PREVIEW_PROJECT],
      ["BRANCH", PULL_REQUEST_BRANCH],
    ]),
    { env: [["VITE_PREVIEW_ORIGIN", expression("steps.preview.outputs.origin")]], run: "bun run build:site" },
    { run: "bunx checks-lint --stage built" },
    { if: "steps.preview.outputs.origin != ''", ...node24("Wrangler") },
    ciCommand("preview-deploy", { if: "steps.preview.outputs.origin != ''", name: "deploy the preview" }, [
      ...cloudflare,
      ["WRANGLER_SEND_METRICS", '"false"'],
      ["WRANGLER_VERSION", WRANGLER_VERSION],
      ["DIRECTORY", "dist"],
      ["PROJECT", PREVIEW_PROJECT],
      ["BRANCH", PULL_REQUEST_BRANCH],
      ["COMMIT_HASH", PULL_REQUEST_HEAD],
      ["COMMIT_DIRTY", '"true"'],
      ["ORIGIN", expression("steps.preview.outputs.origin")],
    ]),
    ciCommand("preview-comment", { if: "steps.preview.outputs.origin != ''", name: "post the preview link on the pull request" }, [
      TOKEN,
      ["PULL_REQUEST", PULL_REQUEST_NUMBER],
      ["MARKER", PREVIEW_MARKER],
      ["AUTHOR", "github-actions[bot]"],
      ["ORIGIN", expression("steps.preview.outputs.origin")],
      ["HEAD_SHA", PULL_REQUEST_HEAD],
    ]),
    {
      uses: UPLOAD,
      with: [
        ["name", SITE_BUILD],
        ["path", "dist"],
        ["include-hidden-files", "true"],
        ["retention-days", "1"],
        ["if-no-files-found", "error"],
      ],
    },
  ],
});

const testStep = (set: CallerSet, test: TestJob): Step => {
  const tier = test.run === `${DEFAULT_TEST_RUN} --tier=unit` ? "unit" : test.run === `${DEFAULT_TEST_RUN} --tier=e2e` ? "e2e" : undefined;
  return checksRelease(set) && tier !== undefined
    ? { id: TEST_STEP, env: [["CHECK_RELEASE", expression("needs.changes.outputs.check-release")], ["TEST_TIER", tier]], run: RELEASE_TEST_RUN }
    : { id: TEST_STEP, run: scalar(test.run) };
};

function testJob(set: CallerSet, test: TestJob, claudeVersion: string | undefined): Job {
  const hold = holds(set, test);
  return {
    id: test.name,
    ...(test.readsBuild ? { needs: "site" } : { needs: "changes", if: notReleased(set) + " && " + NOT_DOCS_ONLY }),
    runsOn: scalar(test.runsOn),
    timeout: 30,
    permissions: holdPermissions(hold),
    steps: [
      checkout({ ref: HEAD, history: true }),
      SETUP,
      ...holdSteps(hold),
      ...claudeInstall(claudeVersion),
      ...(test.readsBuild
        ? [
            {
              uses: DOWNLOAD,
              with: [
                ["name", SITE_BUILD],
                ["path", "dist"],
              ],
            } satisfies Step,
          ]
        : []),
      ...(test.browsers === "" ? [] : [{ uses: PLAYWRIGHT_USES, with: [["browsers", scalar(test.browsers)]] } satisfies Step]),
      testStep(set, test),
      keepArtifacts("artifacts-" + expression("job.check_run_id"), "artifacts/"),
    ],
  };
}

const quotedWords = (words: readonly string[]): string => "'" + words.join(" ") + "'";

function skipsOf(set: CallerSet): string {
  const tests = set.ci.tests.map(({ name }) => name);
  const afterSite = set.ci.tests.filter(({ readsBuild }) => readsBuild).map(({ name }) => name);
  const site = set.kind === "site" ? ["site"] : [];
  const choices: readonly (readonly [string, readonly string[]])[] = [
    [checksRelease(set) ? "needs.changes.outputs.release == 'true' && needs.changes.outputs.check-release != 'true'" : "needs.changes.outputs.release == 'true'", ["static", ...site, ...(set.options.docsBuild ? ["docs"] : []), ...tests]],
    ["needs.changes.outputs.docs-only == 'true'", [...site, ...tests]],
    ...(set.kind === "site" ? [["needs.changes.outputs.tests-only == 'true'", [...site, ...afterSite]] as const] : []),
  ];
  const chosen = choices.flatMap(([test, jobs]) => (jobs.length === 0 ? [] : [test + " && " + quotedWords(jobs)]));
  return expression([...chosen, "''"].join(" || "));
}

const DISPATCHED = "always() && github.event_name == 'workflow_dispatch'";

const dispatchedStatus = (name: string, outcome: string, context: string): Step =>
  ciCommand("commit-status", { if: DISPATCHED, name }, [TOKEN, ["JOB_STATUS", expression(outcome)], ["CONTEXT", context], ["ATTEMPTS", '"5"']]);

function gateJob(set: CallerSet): Job {
  const needed = ["changes", "static", ...(set.kind === "site" ? ["site"] : []), ...(set.options.docsBuild ? ["docs"] : []), ...set.ci.tests.map(({ name }) => name)];
  return {
    id: "checks",
    needs: "[" + needed.join(", ") + "]",
    if: "always()",
    runsOn: runnerOf(set.options.publicRepository),
    timeout: 5,
    permissions: ["contents: read", "statuses: write", "pull-requests: read"],
    steps: [
      checkout({ ref: HEAD }),
      SETUP,
      ciCommand("require-success", { name: "require every result to be success" }, [
        ["RESULTS", expression("toJSON(needs)")],
        ["SKIPS", skipsOf(set)],
      ]),
      {
        ...dispatchedStatus("report the gate on the dispatched commit", "job.status", "checks"),
        note: "GitHub keeps a dispatched run's checks off the pull request, so the release pull request reads these statuses.",
      },
      { if: DISPATCHED, id: "title", continueOnError: true, env: [TOKEN], run: "bunx checks-commit-title" },
      dispatchedStatus("report the title as commitlint on the dispatched commit", "steps.title.outcome", "commitlint"),
    ],
  };
}

const PULL_REQUEST_EVENTS = ["pull_request:", "  types: [opened, synchronize, reopened, ready_for_review]", "workflow_dispatch:"];
export const BY_HAND = ["workflow_dispatch:"];

export function ciWorkflow(set: CallerSet, kit: boolean): Workflow {
  const tests = set.ci.tests.map((test) => testJob(set, test, set.options.claudeVersion));
  return {
    name: "ci",
    on: PULL_REQUEST_EVENTS,
    concurrency: "ci-" + expression("github.event.pull_request.number || github.run_id"),
    ...(set.kind === "site" ? { env: siteEnv(set.names, ["pages"]) } : {}),
    jobs: [changesJob(set), staticJob(set, kit), ...(set.kind === "site" ? [siteJob(set)] : []), ...(set.options.docsBuild ? [docsJob(set)] : []), ...tests, gateJob(set)],
  };
}
