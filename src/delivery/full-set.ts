import { type CallerSet } from "./site-names.ts";
import { type CallerOptions, type Flake, type Pages } from "./caller-options.ts";
import { runnerOf } from "./ci-jobs.ts";
import { SETUP_NODE, CONFIGURE_PAGES, UPLOAD_PAGES, DEPLOY_PAGES, type Step, type Workflow, expression, scalar, workflowText, TOKEN, RUNNER, checkout, SETUP, ciCommand, keepArtifacts, claudeInstall } from "./full-set/steps.ts";
import { PULL_REQUEST_HEAD, PULL_REQUEST_NUMBER, BY_HAND, ciWorkflow } from "./full-set/ci.ts";
import { PREVIEW_CLOSE, SITE_MAIN, PRODUCTION } from "./full-set/site.ts";

const prTitle = (publishes: boolean): Workflow => ({
  name: "pr-title",
  on: ["pull_request:", "  types: [opened, synchronize, reopened, edited]"],
  concurrency: "pr-title-" + PULL_REQUEST_NUMBER,
  jobs: [
    {
      id: "title",
      runsOn: runnerOf(publishes),
      timeout: 10,
      permissions: ["contents: read", "statuses: write", "pull-requests: read"],
      steps: [
        checkout({ ref: PULL_REQUEST_HEAD }),
        SETUP,
        {
          id: "title",
          env: [
            ["PR_TITLE", expression("github.event.pull_request.title")],
            TOKEN,
          ],
          run: "bunx checks-commit-title",
        },
        ciCommand(
          "commit-status",
          { note: "Branch protection reads the title as the commitlint status, which an edit to the title rewrites.", if: "always()", name: "report the commitlint status" },
          [TOKEN, ["HEAD_SHA", PULL_REQUEST_HEAD], ["JOB_STATUS", expression("steps.title.outcome")], ["CONTEXT", "commitlint"], ["ATTEMPTS", '"5"']],
        ),
      ],
    },
  ],
});

const RELEASE: Workflow = {
  name: "release",
  on: BY_HAND,
  jobs: [
    {
      id: "pull-request",
      runsOn: RUNNER,
      timeout: 10,
      concurrency: "release-pull-request",
      permissions: ["contents: write", "pull-requests: write", "actions: write"],
      steps: [
        { note: "A rerun plans the branch tip, not the commit the dispatch named.", ...checkout({ ref: expression("github.ref"), history: true, credentials: true }) },
        SETUP,
        { env: [TOKEN], run: "bunx checks-release-pr ci.yml" },
        ciCommand("held-runs", { name: "delete the runs held for approval on the branch tip" }, [TOKEN, ["BRANCH", "release/" + expression("github.ref_name")]]),
      ],
    },
  ],
};

const RELEASE_COMMIT = "startsWith(github.event.head_commit.message, 'chore: release ')";

// A full-test run gates the publish, so the release job waits for it and still runs when the commit is no release commit and it skips.
function codeMain({ fullTest, checkRelease, publishWorkspaces }: CallerOptions): Workflow {
  const suite = fullTest || checkRelease || publishWorkspaces;
  return {
    name: "main",
    on: ["push:", "  branches: [main]"],
    jobs: [
      ...(suite
        ? [
            {
              id: "suite",
              if: JSON.stringify(RELEASE_COMMIT),
              runsOn: RUNNER,
              timeout: 45,
              permissions: ["contents: read"],
              steps: [checkout({ history: true }), SETUP, { name: "run the full test suite on the release commit", run: "bun run test --full" }],
            },
          ]
        : []),
      {
        id: "release",
        ...(suite ? { needs: "suite", if: expression("!cancelled() && (needs.suite.result == 'success' || needs.suite.result == 'skipped')") } : {}),
        runsOn: RUNNER,
        timeout: 15,
        concurrency: "main",
        permissions: ["contents: write", "id-token: write", "actions: read", "pull-requests: read"],
        steps: [
          checkout({ history: true, credentials: true }),
          SETUP,
          { note: "npm takes a trusted publish only from the Node it set up with its registry.", uses: SETUP_NODE, with: [["node-version", '"24"'], ["registry-url", "https://registry.npmjs.org"]] },
          { env: [TOKEN, ...(publishWorkspaces ? [["CHECKS_PUBLISH_WORKSPACES", '"true"'] as const] : [])], run: "bunx checks-release-tag" },
        ],
      },
    ],
  };
}

export type FullWorkflow = { readonly name: string; readonly text: string };

const fileOf = (workflow: Workflow, publicRepository: boolean): FullWorkflow => ({
  name: workflow.name + ".yml",
  text: workflowText(publicRepository ? { ...workflow, jobs: workflow.jobs.map((job) => job.runsOn === RUNNER ? { ...job, runsOn: "ubuntu-latest" } : job) } : workflow),
});

// The kit publishes through a release.yml that npm's trusted publishing names, so it keeps its own release files.
export function fullRequiredSet(set: CallerSet, kit: boolean): readonly FullWorkflow[] {
  const ci = fileOf(ciWorkflow(set, kit), set.options.publicRepository);
  if (set.kind === "site") return [ci, fileOf(prTitle(set.options.publicRepository), set.options.publicRepository), fileOf(PREVIEW_CLOSE(set.names, set.options.publicRepository), set.options.publicRepository), fileOf(SITE_MAIN(set.names), set.options.publicRepository), fileOf(RELEASE, set.options.publicRepository), fileOf(PRODUCTION(set.names), set.options.publicRepository)];
  return kit ? [ci, fileOf(prTitle(set.options.publicRepository), set.options.publicRepository)] : [ci, fileOf(prTitle(set.options.publicRepository), set.options.publicRepository), fileOf(codeMain(set.options), set.options.publicRepository), fileOf(RELEASE, set.options.publicRepository)];
}

// A second deploy waits for the one in flight, since Pages serves one deployment at a time.
export const fullDocs = ({ build, path }: Pages, publicRepository: boolean): FullWorkflow =>
  fileOf({
    name: "docs",
    on: ["push:", "  branches: [main]", ...BY_HAND],
    jobs: [
      {
        id: "build",
        runsOn: RUNNER,
        timeout: 15,
        permissions: ["contents: read", "pages: read"],
        steps: [
          checkout({ history: true }),
          SETUP,
          { uses: CONFIGURE_PAGES },
          { run: scalar(build) },
          { uses: UPLOAD_PAGES, with: [["path", scalar(path)]] },
        ],
      },
      {
        id: "deploy",
        needs: "build",
        runsOn: RUNNER,
        timeout: 10,
        concurrency: "github-pages-deploy",
        permissions: ["pages: write", "id-token: write"],
        environment: { name: "github-pages", url: expression("steps.deployment.outputs.page_url") },
        steps: [{ id: "deployment", uses: DEPLOY_PAGES }],
      },
    ],
  }, publicRepository);

export const fullAdvisories = (cron: string | undefined, publicRepository: boolean): FullWorkflow =>
  fileOf({
    name: "advisories",
    on: cron === undefined ? BY_HAND : [...BY_HAND, "schedule:", "  - cron: " + JSON.stringify(cron)],
    jobs: [
      {
        id: "advisories",
        runsOn: RUNNER,
        timeout: 15,
        permissions: ["contents: read", "issues: write"],
        steps: [checkout({}), SETUP, { name: "run the scan", env: [TOKEN], run: "bunx checks-advisories --all --issue" }],
      },
    ],
  }, publicRepository);

export const fullFlake = ({ nodeVersionFile }: Flake, claudeVersion: string | undefined, publicRepository: boolean): FullWorkflow =>
  fileOf({
    name: "flake",
    on: BY_HAND,
    jobs: [
      {
        id: "flake",
        runsOn: RUNNER,
        timeout: 60,
        permissions: ["contents: read"],
        steps: [
          checkout({ history: true }),
          SETUP,
          ...(nodeVersionFile === undefined ? [] : [{ uses: SETUP_NODE, with: [["node-version-file", nodeVersionFile]] } satisfies Step]),
          ...claudeInstall(claudeVersion),
          { run: "bunx checks-flake --runs 10 --report flake-report.json" },
          { ...keepArtifacts("flake-report", "flake-report.json"), with: [["name", "flake-report"], ["path", "flake-report.json"], ["retention-days", "7"], ["if-no-files-found", "ignore"]] },
        ],
      },
    ],
  }, publicRepository);

