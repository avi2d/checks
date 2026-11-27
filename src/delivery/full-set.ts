import kitRelease from "./full-set/kit-release.txt";
import { RELEASE_VERSION_ENV } from "../core/release-names.ts";
import type { PlatformPackages } from "../core/settings.ts";
import { HOSTED_PLATFORMS, PLATFORM_BINARIES_ENV } from "./platform-packages.ts";
import { type CallerSet } from "./site-names.ts";
import { RELEASE_ASSETS_DIRECTORY, RELEASE_ASSETS_SCRIPT, type CallerOptions, type Flake, type Pages } from "./caller-options.ts";
import { isBrowserWalk, runnerOf } from "./ci-jobs.ts";
import { SETUP_NODE, UPLOAD, DOWNLOAD, CONFIGURE_PAGES, UPLOAD_PAGES, DEPLOY_PAGES, type Job, type Step, type Workflow, expression, scalar, workflowText, TOKEN, RUNNER, checkout, SETUP, ciCommand, keepArtifacts, claudeInstall } from "./full-set/steps.ts";
import { PULL_REQUEST_HEAD, PULL_REQUEST_NUMBER, BY_HAND, ciWorkflow, gitleaksCache } from "./full-set/ci.ts";
import { PREVIEW_CLOSE, SITE_MAIN, PRODUCTION } from "./full-set/site.ts";
import { PR_TEXT } from "./full-set/pr-text.ts";

// The pull_request types cannot filter an edit by its changed field, so the job reads the changes payload.
const TITLE_CHANGED = "github.event.action != 'edited' || github.event.changes.title != null";

const prTitle = (publishes: boolean): Workflow => ({
  name: "pr-title",
  on: ["pull_request:", "  types: [opened, synchronize, reopened, edited]"],
  concurrency: "pr-title-" + PULL_REQUEST_NUMBER + "-" + expression("(" + TITLE_CHANGED + ") && 'title' || github.run_id"),
  jobs: [
    {
      id: "title",
      if: TITLE_CHANGED,
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

const VERSION_INPUT = ["  inputs:", "    version:", "      description: the version to release instead of the planned bump", "      required: false", "      type: string"];

const release = (versionInput: boolean): Workflow => ({
  name: "release",
  on: versionInput ? [...BY_HAND, ...VERSION_INPUT] : BY_HAND,
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
        { env: [TOKEN, ...(versionInput ? [[RELEASE_VERSION_ENV, expression("inputs.version")] as const] : [])], run: "bunx checks-release-pr ci.yml" },
        ciCommand("held-runs", { name: "delete the runs held for approval on the branch tip" }, [TOKEN, ["BRANCH", "release/" + expression("github.ref_name")]]),
      ],
    },
  ],
});

const RELEASE_COMMIT = "startsWith(github.event.head_commit.message, 'chore: release ')";

const RELEASED_TAG = "needs.release.outputs.tag";

// The release step sets the tag output only when it wrote a GitHub release, so a merge that releases nothing builds no asset.
// The implicit success() also reads the suite job, which skips on a push that releases an earlier release commit.
const assets = (needs: string, tag: string, when?: string): Job => ({
  id: "assets",
  needs,
  ...(when === undefined ? {} : { if: when }),
  runsOn: expression("matrix.runner"),
  timeout: 30,
  matrix: ["runner", "[ubuntu-latest, macos-latest]"],
  permissions: ["contents: write"],
  steps: [
    checkout({ ref: expression(tag) }),
    SETUP,
    { name: "build the release assets", run: "bun run " + RELEASE_ASSETS_SCRIPT },
    { name: "attach the release assets to the GitHub release", env: [TOKEN, ["TAG", expression(tag)]], run: 'gh release upload "$TAG" ' + RELEASE_ASSETS_DIRECTORY + "/* --clobber" },
  ],
});

const BINARIES_ARTIFACT = "platform-binary-";
const BINARIES_DIRECTORY = expression("runner.temp") + "/platform-binaries";
const BINARIES_BUILT = "needs.binaries.result == 'success'";

const binaries = ({ binary, platforms }: PlatformPackages): Job => ({
  id: "binaries",
  if: JSON.stringify(RELEASE_COMMIT),
  runsOn: expression("matrix.runner"),
  timeout: 30,
  matrix: ["runner", "[" + platforms.map((name) => HOSTED_PLATFORMS[name].runner).join(", ") + "]"],
  permissions: ["contents: read"],
  steps: [
    checkout({}),
    SETUP,
    { name: "build the release binaries", run: "bun run " + RELEASE_ASSETS_SCRIPT },
    { uses: UPLOAD, with: [["name", BINARIES_ARTIFACT + expression("matrix.runner")], ["path", RELEASE_ASSETS_DIRECTORY + "/" + binary + "-*"], ["if-no-files-found", "error"]] },
  ],
});

const downloadBinaries: Step = {
  note: "The binaries job skips on a push that is no release commit, so there is nothing to download.",
  if: BINARIES_BUILT,
  uses: DOWNLOAD,
  with: [["pattern", BINARIES_ARTIFACT + "*"], ["merge-multiple", "true"], ["path", BINARIES_DIRECTORY]],
};

const releaseGate = (suite: boolean, packaged: boolean): Pick<Job, "needs" | "if"> => {
  const passed = (job: string) => "(needs." + job + ".result == 'success' || needs." + job + ".result == 'skipped')";
  const gated = [...(suite ? ["suite"] : []), ...(packaged ? ["binaries"] : [])];
  if (gated.length === 0) return {};
  const listed = gated.join(", ");
  return { needs: gated.length === 1 ? listed : "[" + listed + "]", if: expression(["!cancelled()", ...gated.map(passed)].join(" && ")) };
};

// A full-test run gates the publish, so the release job waits for it and still runs when the commit is no release commit and it skips.
function codeMain({ fullTest, checkRelease, publishWorkspaces, releaseAssets, platformPackages }: CallerOptions): Workflow {
  const suite = fullTest || checkRelease || publishWorkspaces;
  const packaged = platformPackages !== undefined;
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
              steps: [checkout({ history: true }), SETUP, gitleaksCache(false), { run: "bunx checks-ci gitleaks" }, { name: "run the full test suite on the release commit", run: "bun run test --full" }],
            },
          ]
        : []),
      ...(platformPackages === undefined ? [] : [binaries(platformPackages)]),
      {
        id: "release",
        ...releaseGate(suite, packaged),
        runsOn: RUNNER,
        timeout: 15,
        concurrency: "main",
        permissions: ["contents: write", "id-token: write", "actions: read", "pull-requests: read"],
        ...(releaseAssets ? { outputs: [["tag", expression("steps.release.outputs.tag")] as const] } : {}),
        steps: [
          checkout({ history: true, credentials: true }),
          SETUP,
          { note: "npm takes a trusted publish only from the Node it set up with its registry.", uses: SETUP_NODE, with: [["node-version", '"24"'], ["registry-url", "https://registry.npmjs.org"]] },
          ...(packaged ? [downloadBinaries] : []),
          {
            ...(releaseAssets ? { id: "release" } : {}),
            env: [TOKEN, ...(publishWorkspaces ? [["CHECKS_PUBLISH_WORKSPACES", '"true"'] as const] : []), ...(packaged ? [[PLATFORM_BINARIES_ENV, BINARIES_DIRECTORY] as const] : [])],
            run: "bunx checks-release-tag",
          },
        ],
      },
      ...(releaseAssets ? [assets("release", RELEASED_TAG, expression("!cancelled() && needs.release.result == 'success' && " + RELEASED_TAG + " != ''"))] : []),
    ],
  };
}

export type FullWorkflow = { readonly name: string; readonly text: string };

const fileOf = (workflow: Workflow): FullWorkflow => ({ name: workflow.name + ".yml", text: workflowText(workflow) });

const pullRequestText = (publicRepository: boolean): readonly FullWorkflow[] => (publicRepository ? [fileOf(PR_TEXT)] : []);

// The kit cannot use the caller's release workflow because npm trusts release.yml.
export function fullRequiredSet(set: CallerSet, kit: boolean): readonly FullWorkflow[] {
  const ci = fileOf(ciWorkflow(set, kit));
  const { publicRepository } = set.options;
  if (set.kind === "site") return [ci, fileOf(prTitle(publicRepository)), ...pullRequestText(publicRepository), fileOf(PREVIEW_CLOSE(set.names, publicRepository)), fileOf(SITE_MAIN(set.names)), fileOf(release(set.options.releaseVersionInput)), fileOf(PRODUCTION(set.names, set.ci.tests.some(isBrowserWalk), kit))];
  const shared = [ci, fileOf(prTitle(publicRepository)), ...pullRequestText(publicRepository)];
  if (!kit) return [...shared, fileOf(codeMain(set.options)), fileOf(release(set.options.releaseVersionInput))];
  if (!set.options.releaseAssets) return shared;
  return [...shared, { name: "release.yml", text: kitRelease }];
}

// A second deploy waits for the one in flight, since Pages serves one deployment at a time.
export const fullDocs = ({ build, path }: Pages): FullWorkflow =>
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
  });

export const fullAdvisories = (cron: string | undefined): FullWorkflow =>
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
  });

export const fullFlake = ({ nodeVersionFile }: Flake, claudeVersion: string | undefined): FullWorkflow =>
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
  });

