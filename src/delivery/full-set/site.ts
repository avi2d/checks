import { type SiteNames } from "../site-names.ts";
import { PLAYWRIGHT_USES, runnerOf } from "../ci-jobs.ts";
import { CHECKOUT, WRANGLER_VERSION, type Pair, type Workflow, expression, TOKEN, RUNNER, HOSTED, checkout, SETUP, ciCommand, keepArtifacts, node24, servedStep, cloudflare, CLOUDFLARE_SET, ASTRO_QUIET, PREVIEW_PROJECT, PREVIEW_MARKER, siteEnv } from "./steps.ts";
import { PULL_REQUEST_HEAD, PULL_REQUEST_BRANCH, PULL_REQUEST_NUMBER, BY_HAND } from "./ci.ts";

export const PREVIEW_CLOSE = (names: SiteNames, publishes: boolean): Workflow => ({
  name: "preview-close",
  on: ["pull_request:", "  types: [closed]"],
  env: siteEnv(names, ["pages"]),
  jobs: [
    {
      id: "preview",
      runsOn: runnerOf(publishes),
      timeout: 10,
      permissions: ["contents: read", "pull-requests: write"],
      env: [CLOUDFLARE_SET],
      steps: [
        checkout({ ref: PULL_REQUEST_HEAD }),
        SETUP,
        { note: "A fork's or Dependabot's pull request runs without the repository secrets, so it got no preview.", if: "env.CLOUDFLARE_SET != 'true'", run: 'echo "the Cloudflare secrets are not set, so there is no preview to remove"' },
        ciCommand("preview-remove", { if: "env.CLOUDFLARE_SET == 'true'", name: "delete the branch's deployments" }, [
          ...cloudflare,
          TOKEN,
          ["PULL_REQUEST", PULL_REQUEST_NUMBER],
          ["MARKER", PREVIEW_MARKER],
          ["AUTHOR", "github-actions[bot]"],
          ["PROJECT", PREVIEW_PROJECT],
          ["BRANCH", PULL_REQUEST_BRANCH],
        ]),
      ],
    },
  ],
});

const STAGING_ORIGIN = "https://" + expression("env.SITE_PAGES") + ".pages.dev";

// A group per release commit keeps a later push from cancelling a release that waits for its turn.
export const SITE_MAIN = (names: SiteNames): Workflow => ({
  name: "main",
  on: ["push:", "  branches: [main]"],
  env: siteEnv(names, ["pages"]),
  jobs: [
    {
      id: "release",
      runsOn: RUNNER,
      timeout: 20,
      concurrency: '"' + expression("startsWith(github.event.head_commit.message, 'chore: release ') && format('site-main-{0}', github.sha) || 'site-main'") + '"',
      permissions: ["contents: write", "actions: read", "pull-requests: read"],
      env: [ASTRO_QUIET],
      steps: [
        checkout({ history: true, credentials: true }),
        SETUP,
        { env: [TOKEN], run: "bunx checks-release-tag" },
        { run: "bun run build:site" },
        node24("Wrangler"),
        ciCommand("pages-deploy", { name: "deploy the built pages" }, [
          ...cloudflare,
          ["WRANGLER_SEND_METRICS", '"false"'],
          ["WRANGLER_VERSION", WRANGLER_VERSION],
          ["DIRECTORY", "dist"],
          ["PROJECT", expression("env.SITE_PAGES")],
          ["BRANCH", "main"],
          ["COMMIT_HASH", expression("github.sha")],
          ["COMMIT_DIRTY", '"false"'],
          ["COMMIT_MESSAGE", "Staging build of " + expression("github.repository") + " main"],
          ["ADDRESS", STAGING_ORIGIN + "/"],
        ]),
        servedStep(STAGING_ORIGIN),
      ],
    },
  ],
});

const PRODUCTION_ORIGIN = "https://" + expression("env.SITE_DOMAIN");
const STAGED = expression("steps.staging.outputs.sha");
const DEPLOY_KEY: Pair = ["DEPLOY_KEY", expression("secrets.PRODUCTION_DEPLOY_KEY")];

export const PRODUCTION = (names: SiteNames): Workflow => ({
  name: "production",
  on: BY_HAND,
  env: siteEnv(names, ["pages", "domain", "production"]),
  jobs: [
    {
      id: "production",
      runsOn: RUNNER,
      timeout: 45,
      concurrency: "site-production",
      permissions: ["contents: read", "actions: read", "pull-requests: read"],
      env: [ASTRO_QUIET],
      steps: [
        { note: "The gate runs from the dispatched commit, since a release commit can predate it.", ...checkout({ history: true }) },
        SETUP,
        ciCommand("pages-staged-commit", { id: "staging", name: "read the commit the Pages project serves" }, [
          ...cloudflare,
          DEPLOY_KEY,
          TOKEN,
          ["PROJECT", expression("env.SITE_PAGES")],
          ["BRANCH", "main"],
          ["WORKFLOW", "main.yml"],
        ]),
        { name: "refuse a staged commit that is not a published release", env: [TOKEN, ["SHA", STAGED]], run: 'bunx checks-production-gate "$SHA"' },
        { env: [["SHA", STAGED]], run: 'git checkout --detach "$SHA"' },
        { run: "bun install --frozen-lockfile" },
        { uses: PLAYWRIGHT_USES, with: [["browsers", "webkit"]] },
        { name: "run the full test suite on the release commit", run: "bun run test --full" },
        { name: "run the pixel screenshots on the release commit", run: "bun run test:pixel" },
        { run: "bun run build:production" },
        ciCommand("pages-publish guard", { name: "check the deploy key is set" }, [DEPLOY_KEY]),
        {
          uses: CHECKOUT,
          with: [
            ["repository", expression("env.SITE_PRODUCTION")],
            ["ref", "main"],
            ["ssh-key", expression("secrets.PRODUCTION_DEPLOY_KEY")],
            ["path", "production-pages"],
          ],
        },
        ciCommand("pages-publish publish", { name: "push the build" }, [
          ["SITE_PATH", "production-pages"],
          ["DIRECTORY", "dist"],
          ["REPOSITORY", expression("env.SITE_PRODUCTION")],
          ["CNAME", expression("env.SITE_DOMAIN")],
          ["BRANCH", "main"],
          ["COMMIT_MESSAGE", "Production build of " + expression("github.repository") + " main"],
          ["SOURCE_SHA", STAGED],
        ]),
        servedStep(PRODUCTION_ORIGIN),
        node24("Lighthouse"),
        ciCommand("lighthouse", { name: "audit each page and write the median scores to the summary" }, [
          ["SITE", "dist"],
          ["RUNS", '"3"'],
          ["ORIGIN", PRODUCTION_ORIGIN],
          ["REPORTS", expression("runner.temp") + "/lighthouse-reports"],
        ]),
        keepArtifacts("lighthouse-reports", expression("runner.temp") + "/lighthouse-reports"),
      ],
    },
  ],
});
