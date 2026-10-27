import { expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./lib/fake-gh.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-preflight.ts");

const repository = fixtureRepos("checks-release-preflight-");
const scratch = scratchDirs();

function manifest(version: string, repositoryUrl: string | undefined): string {
  return JSON.stringify({ name: "@acme/widget", version, repository: repositoryUrl === undefined ? undefined : { type: "git", url: repositoryUrl } }, null, 2) + "\n";
}

function workflow(publish: boolean, oidc: boolean): string {
  const permissions = oidc ? "  contents: read\n  id-token: write\n" : "  contents: read\n";
  const step = publish ? "      - run: ./node_modules/.bin/checks-release-publish\n" : "      - run: bun run build\n";
  return "name: release\non:\n  push:\n    tags: [\"v*\"]\n  workflow_dispatch:\npermissions:\n" + permissions + "jobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n" + step;
}

type Ready = {
  readonly run: (env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly state: FakeGh["state"];
};

async function ready(version: string, tag: string | undefined, repositoryUrl: string | undefined, flow: "npm" | "plain", oidc = true): Promise<Ready> {
  const repo = await repository({});
  await repo.write({ "package.json": manifest(tag === undefined ? version : tag.slice(1), repositoryUrl), ".github/workflows/release.yml": workflow(flow === "npm", oidc) });
  await repo.commit("chore: add the manifest");
  if (tag !== undefined) await $`git tag ${tag}`.cwd(repo.dir).quiet();
  await repo.write({ "package.json": manifest(version, repositoryUrl), "notes.txt": "bill\n" });
  await repo.commit("feat: build a bill");
  const home = await scratch("checks-release-preflight-home-");
  const fake = await fakeGh(home, repo.dir);
  return {
    run: (env = {}) =>
      ran($`bun ${SCRIPT} release.yml`.cwd(repo.dir).env({ ...process.env, ...fake.env, GITHUB_REPOSITORY: "acme/widget", ...env })),
    state: fake.state,
  };
}

test(
  "a manifest bumped past the last tag fails before the release runs, since 0.7.0 over v0.6.0 is untagged",
  async () => {
    const preflight = await ready("0.7.0", "v0.6.0", "git+https://github.com/acme/widget.git", "npm");

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
  "a manifest naming another repository fails the trusted publisher, since the run in acme/widget matches no publisher for another owner",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/other/widget.git", "npm");

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: package.json names the repository other/widget, but the run is in acme/widget, so npm's trusted publisher for @acme/widget matches no run here; point repository.url at acme/widget, or move the trusted publisher on npm to other/widget and release.yml\n",
    );
  },
  60_000,
);

test(
  "a release workflow minting no OIDC token fails the trusted publisher, since the run cannot prove its publisher",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", "npm", false);

    const refused = await preflight.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: .github/workflows/release.yml grants no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs\n",
    );
  },
  60_000,
);

test(
  "a repository forbidding release pull requests fails before the tag, since the approve setting is off",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", "npm");

    const refused = await preflight.run({ FAKE_GH_APPROVE: "0" });
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      "checks-release-preflight: the repository forbids GitHub Actions from creating and approving pull requests, so the daily release cannot open its release pull request; allow it with `gh api --method PUT repos/acme/widget/actions/permissions/workflow -F can_approve_pull_request_reviews=true`\n",
    );
    expect(refused.text).toContain("gh api --method PUT repos/acme/widget/actions/permissions/workflow -F can_approve_pull_request_reviews=true");
  },
  60_000,
);

test(
  "a release that agrees on every check passes and names what it checked",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", "git+https://github.com/acme/widget.git", "npm");

    expect(await preflight.run()).toEqual({
      exitCode: 0,
      text: "release-preflight: package.json holds 0.6.0, which matches v0.6.0\nrelease-preflight: npm's trusted publisher for @acme/widget matches the run in acme/widget\nrelease-preflight: the repository lets GitHub Actions create and approve the release pull request\n",
    });
  },
  60_000,
);

test(
  "a workflow that publishes nothing to npm skips the publisher match and still passes",
  async () => {
    const preflight = await ready("0.6.0", "v0.6.0", undefined, "plain");

    expect(await preflight.run()).toEqual({
      exitCode: 0,
      text: "release-preflight: package.json holds 0.6.0, which matches v0.6.0\nrelease-preflight: release.yml publishes nothing to npm, so no trusted publisher has to match\nrelease-preflight: the repository lets GitHub Actions create and approve the release pull request\n",
    });
  },
  60_000,
);
