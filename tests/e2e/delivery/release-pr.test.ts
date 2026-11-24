import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consumer, head, manifest } from "../lib/release-pr-fixture.ts";

test(
  "a fix since the last tag opens one pull request that bumps the patch, carries the built changelog and dispatches the checks on its head",
  async () => {
    const widget = await consumer();
    const main = await head(widget.dir);

    const opened = await widget.run(["ci.yml"]);
    expect(opened.text).toContain(
      "release-pr: opened https://github.com/acme/widget/pull/1 to release 0.1.1, and dispatched ci.yml on release/main\n",
    );
    expect(opened.exitCode).toBe(0);

    expect(await widget.inOrigin("log", "-1", "--format=%s%n%P%n%an <%ae>", "release/main")).toBe(
      `chore: release 0.1.1\n${main}\ngithub-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`,
    );
    expect(await widget.inOrigin("diff", "--name-only", "main", "release/main")).toBe("CHANGELOG.md\npackage.json");
    expect(await widget.inOrigin("show", "release/main:package.json")).toBe(manifest("0.1.1").trim());
    const changelog = await widget.inOrigin("show", "release/main:CHANGELOG.md");
    expect(changelog).toContain("## 0.1.1");
    expect(changelog).toContain("- **parts:** keep the order of parts [#3](https://github.com/acme/widget/pull/3)");

    const state = await widget.state();
    expect(state.pulls).toEqual([
      { number: 1, title: "chore: release 0.1.1", head: "release/main", base: "main", body: "Release 0.1.1.", html_url: "https://github.com/acme/widget/pull/1" },
    ]);
    expect(state.dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
    ]);
    expect((await $`git status --porcelain`.cwd(widget.dir).quiet()).stdout.toString()).toBe("");
    expect(await readFile(join(widget.dir, "package.json"), "utf8")).toBe(manifest("0.1.0"));
  },
  60_000,
);

test(
  "the release pull request does not leave public workspace versions at the old root version",
  async () => {
    const widget = await consumer();
    await mkdir(join(widget.dir, "packages", "public"), { recursive: true });
    await writeFile(join(widget.dir, "packages", "public", "package.json"), '{"name":"@acme/public","version":"0.1.0"}\n');
    await writeFile(join(widget.dir, "package.json"), manifest("0.1.0").replace('"name": "widget",', '"name": "widget",\n  "private": true,\n  "workspaces": ["packages/*"],'));
    await mkdir(join(widget.dir, ".github", "workflows"), { recursive: true });
    await writeFile(
      join(widget.dir, ".github", "workflows", "main.yml"),
      [
        "name: main",
        "on:",
        "  push:",
        "    branches: [main]",
        "jobs:",
        "  release:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - env:",
        '          CHECKS_PUBLISH_WORKSPACES: "true"',
        "        run: bunx checks-release-tag",
        "",
      ].join("\n"),
    );
    await $`git add package.json packages/public/package.json .github/workflows/main.yml && git commit -q -m ${"fix: include the public workspace"} && git push -q origin main`.cwd(widget.dir).quiet();
    expect((await widget.run(["ci.yml"])).exitCode).toBe(0);
    expect(await widget.inOrigin("show", "release/main:packages/public/package.json")).toBe('{"name":"@acme/public","version":"0.1.1"}');
  },
  60_000,
);

test(
  "a second run on the same main leaves the release pull request alone and dispatches nothing",
  async () => {
    const widget = await consumer();
    expect((await widget.run(["ci.yml"])).exitCode).toBe(0);
    const before = await widget.state();

    const again = await widget.run(["ci.yml"]);
    expect(again.text).toContain(`release-pr: https://github.com/acme/widget/pull/1 releases 0.1.1 from ${(await head(widget.dir)).slice(0, 12)} and is current\n`);
    expect(again.exitCode).toBe(0);
    const after = await widget.state();
    expect(after.calls.slice(before.calls.length)).toEqual(["GET repos/{owner}/{repo}", "GET repos/{owner}/{repo}/pulls?head={owner}:release%2Fmain&base=main&state=open"]);
    expect(after.dispatches).toEqual(before.dispatches);
  },
  60_000,
);

test(
  "a feature landing on main rebuilds the branch on it and retitles the same pull request to the minor version",
  async () => {
    const widget = await consumer();
    expect((await widget.run(["ci.yml"])).exitCode).toBe(0);
    const landed = await widget.land("feat: price a bill (#4)");

    const refreshed = await widget.run(["ci.yml"]);
    expect(refreshed.text).toContain("release-pr: refreshed https://github.com/acme/widget/pull/1 to release 0.2.0, and dispatched ci.yml on release/main\n");
    expect(refreshed.exitCode).toBe(0);
    expect(await widget.inOrigin("log", "-1", "--format=%s %P", "release/main")).toBe(`chore: release 0.2.0 ${landed}`);
    const state = await widget.state();
    expect(state.pulls.map(({ title, body }) => ({ title, body }))).toEqual([{ title: "chore: release 0.2.0", body: "Release 0.2.0." }]);
    expect(state.calls).toContain("PATCH repos/{owner}/{repo}/git/refs/heads/release/main");
    expect(state.dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
      { workflow: "ci.yml", ref: "release/main" },
    ]);
  },
  60_000,
);

test(
  "a refused pull request dispatches nothing, and the next run opens it on the branch already built",
  async () => {
    const widget = await consumer();
    const refused = await widget.run(["ci.yml"], { FAKE_GH_FAIL: "POST repos/{owner}/{repo}/pulls" });
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain("checks-release-pr: gh api POST repos/{owner}/{repo}/pulls: gh: Resource not accessible by integration (HTTP 403)");
    expect((await widget.state()).dispatches).toEqual([]);
    expect(await widget.inOrigin("log", "-1", "--format=%s", "release/main")).toBe("chore: release 0.1.1");
    const before = await widget.state();

    const retried = await widget.run(["ci.yml"]);
    expect(retried.text).toContain("release-pr: opened https://github.com/acme/widget/pull/1 to release 0.1.1, and dispatched ci.yml on release/main\n");
    expect(retried.exitCode).toBe(0);
    const after = await widget.state();
    expect(after.calls.slice(before.calls.length)).toEqual([
      "GET repos/{owner}/{repo}",
      "GET repos/{owner}/{repo}/pulls?head={owner}:release%2Fmain&base=main&state=open",
      "POST repos/{owner}/{repo}/pulls",
      "POST repos/{owner}/{repo}/actions/workflows/ci.yml/dispatches",
    ]);
  },
  60_000,
);

test(
  "with nothing unreleased since the last tag it opens nothing",
  async () => {
    const widget = await consumer();
    await writeFile(join(widget.dir, "package.json"), manifest("0.1.1"));
    await widget.commit("chore: release 0.1.1 (#5)");
    await $`git tag v0.1.1`.cwd(widget.dir).quiet();

    expect(await widget.run(["ci.yml"])).toEqual({ exitCode: 0, text: "release-pr: no unreleased changes since v0.1.1\n" });
    expect((await widget.state()).calls).toEqual(["GET repos/{owner}/{repo}"]);
  },
  60_000,
);

test(
  "an untagged bump points at the tag job of the workflow it runs in, not at a release-pr workflow the repository lacks",
  async () => {
    const widget = await consumer();
    await writeFile(join(widget.dir, "package.json"), manifest("0.3.0"));
    await widget.commit("chore: jump");

    const refused = await widget.run(["ci.yml"], { GITHUB_WORKFLOW: "daily-release" });
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain("rerun the tag job of daily-release on the release commit, whose refusal says what to fix");
    expect((await widget.state()).calls).toEqual(["GET repos/{owner}/{repo}"]);
  },
  60_000,
);

test(
  "a version the last tag does not name, a dirty tree, a detached head and no workflow are each refused before anything is written",
  async () => {
    const widget = await consumer();
    await writeFile(join(widget.dir, "package.json"), manifest("0.3.0"));
    await widget.commit("chore: jump");
    const untagged = await widget.run(["ci.yml"], { GITHUB_WORKFLOW: "release-pr" });
    expect(untagged.exitCode).toBe(2);
    expect(untagged.text).toContain("checks-release-pr: package.json holds 0.3.0, but the last release tag is v0.1.0, so v0.3.0 is untagged; rerun the tag job of release-pr on the release commit, whose refusal says what to fix, or return its version to 0.1.0");

    await $`git reset -q --hard HEAD~1`.cwd(widget.dir).quiet();
    await writeFile(join(widget.dir, "CHANGELOG.md"), "edited by hand\n");
    const dirty = await widget.run(["ci.yml"]);
    expect(dirty.exitCode).toBe(2);
    expect(dirty.text).toContain("checks-release-pr: the working tree has changes to tracked files; the release commits only what the build writes");

    await $`git checkout -q -- CHANGELOG.md && git checkout -q --detach`.cwd(widget.dir).quiet();
    const detached = await widget.run(["ci.yml"]);
    expect(detached.exitCode).toBe(2);
    expect(detached.text).toContain("checks-release-pr: git symbolic-ref --quiet --short HEAD");

    const usage = await widget.run([]);
    expect(usage.exitCode).toBe(2);
    expect(usage.text).toContain("usage: checks-release-pr [--allow-non-default-branch] [--version <major.minor.patch>] <workflow>...");

    expect((await widget.state()).calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
    expect(await widget.inOrigin("for-each-ref", "--format=%(refname)", "refs/heads/release/")).toBe("");
  },
  60_000,
);
