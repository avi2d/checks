import { expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./lib/fake-gh.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-preflight.ts");

const KIT_PUBLISH = "bun src/delivery/release-publish.ts";
const BUILD = "bun run build";

const repository = fixtureRepos("checks-release-preflight-");
const scratch = scratchDirs();

function manifest(version: string, repositoryUrl: string | undefined): string {
  return JSON.stringify({ name: "@acme/widget", version, repository: repositoryUrl === undefined ? undefined : { type: "git", url: repositoryUrl } }, null, 2) + "\n";
}

function topPermissions(oidc: boolean): string {
  return oidc ? "  contents: read\n  id-token: write\n" : "  contents: read\n";
}

function jobPermissions(oidc: boolean): string {
  return oidc ? "    permissions:\n      contents: read\n      id-token: write\n" : "    permissions:\n      contents: read\n";
}

function workflow(publish: string | undefined, topOidc: boolean, jobOidc?: boolean, extraJobs = ""): string {
  const step = publish === undefined ? BUILD : publish;
  const job = jobOidc === undefined ? "" : `${jobPermissions(jobOidc)}\n`;
  return (
    "name: release\non:\n  push:\n    tags: [\"v*\"]\n  workflow_dispatch:\npermissions:\n" +
    topPermissions(topOidc) +
    "jobs:\n  publish:\n    runs-on: ubuntu-latest\n" +
    job +
    "    steps:\n" +
    `      - run: ${step}\n` +
    extraJobs
  );
}

const LINT_JOB = "  lint:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    steps:\n      - run: bun run lint\n";

const SECOND_PUBLISH_DENIED = "  second:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: bun src/delivery/release-publish.ts\n";

type Ready = {
  readonly dir: string;
  readonly run: (env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly state: FakeGh["state"];
};

async function ready(
  version: string,
  tag: string | undefined,
  repositoryUrl: string | undefined,
  publish: string | undefined,
  topOidc = true,
  jobOidc?: boolean,
  extraJobs = "",
): Promise<Ready> {
  const repo = await repository({});
  await repo.write({ "package.json": manifest(tag === undefined ? version : tag.slice(1), repositoryUrl), ".github/workflows/release.yml": workflow(publish, topOidc, jobOidc, extraJobs) });
  await repo.commit("chore: add the manifest");
  if (tag !== undefined) await $`git tag ${tag}`.cwd(repo.dir).quiet();
  await repo.write({ "package.json": manifest(version, repositoryUrl), "notes.txt": "bill\n" });
  await repo.commit("feat: build a bill");
  const home = await scratch("checks-release-preflight-home-");
  const fake = await fakeGh(home, repo.dir);
  return {
    dir: repo.dir,
    run: (env = {}) =>
      ran($`bun ${SCRIPT} release.yml`.cwd(repo.dir).env({ ...process.env, ...fake.env, GITHUB_REPOSITORY: "acme/widget", ...env })),
    state: fake.state,
  };
}

test(
  "a manifest bumped past the last tag fails before the release runs, since 0.7.0 over v0.6.0 is untagged",
  async () => {
    const preflight = await ready("0.7.0", "v0.6.0", "git+https://github.com/acme/widget.git", KIT_PUBLISH);

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: package.json holds 0.7.0, but the last release tag is v0.6.0, so v0.7.0 is untagged; rerun the release that bumped it, whose refusal says what to fix, or return package.json to 0.6.0\n",
    );
    expect(await preflight.state()).toEqual({ calls: [], pulls: [], dispatches: [], runs: [] });
  },
  60_000,
);

test(
  "a manifest naming another repository fails the publisher prerequisites, since the run in acme/widget presents no publisher for another owner",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/other/widget.git", KIT_PUBLISH);

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: package.json names the repository other/widget, but the run is in acme/widget, so the run cannot present npm's trusted publisher for @acme/widget; point repository.url at acme/widget, or move the trusted publisher on npm to other/widget and release.yml\n",
    );
  },
  60_000,
);

test(
  "a release workflow minting no OIDC token fails the publisher prerequisites, since the run cannot prove its publisher",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", KIT_PUBLISH, false);

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: .github/workflows/release.yml grants the publishing job no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs\n",
    );
  },
  60_000,
);

test(
  "a publishing job with its own permissions ignores the workflow grant, so the run mints no token",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", KIT_PUBLISH, true, false);

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: .github/workflows/release.yml grants the publishing job no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs\n",
    );
  },
  60_000,
);

test(
  "a grant on another job mints no token for the publishing job, so the run mints no token",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", KIT_PUBLISH, false, undefined, LINT_JOB);

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: .github/workflows/release.yml grants the publishing job no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs\n",
    );
  },
  60_000,
);

test(
  "a second publishing job without the grant fails the check when the first publishing job holds it",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", KIT_PUBLISH, true, undefined, SECOND_PUBLISH_DENIED);

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: .github/workflows/release.yml grants the publishing job no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs\n",
    );
  },
  60_000,
);

test(
  "a shallow checkout fails before trusting the tag it sees, since the last tag may be missing",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", KIT_PUBLISH);
    const home = await scratch("checks-release-preflight-shallow-");
    await $`git clone --quiet --depth 1 file://${preflight.dir} checkout`.cwd(home).quiet();
    const dir = join(home, "checkout");

    const refused = await ran($`bun ${SCRIPT} release.yml`.cwd(dir).env({ ...process.env, GITHUB_REPOSITORY: "acme/widget" }));
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: the checkout is shallow, so the tag it sees may not be the last one; fetch all of it\n",
    );
  },
  60_000,
);

test(
  "a release that agrees on every check passes and names what it checked",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", KIT_PUBLISH);

    expect(await preflight.run()).toEqual({
      exitCode: 0,
      text: "release-preflight: package.json holds 0.6.0, which matches v0.6.0\nrelease-preflight: package.json names acme/widget and release.yml grants the publishing job id-token: write, so the run holds the prerequisites for npm's trusted publisher for @acme/widget\n",
    });
  },
  60_000,
);

test(
  "a workflow that publishes nothing to npm skips the publisher prerequisites and still passes",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", undefined, undefined);

    expect(await preflight.run()).toEqual({
      exitCode: 0,
      text: "release-preflight: package.json holds 0.6.0, which matches v0.6.0\nrelease-preflight: release.yml publishes nothing to npm, so no trusted publisher has to match\n",
    });
  },
  60_000,
);
