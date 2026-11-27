import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consumer, head, manifest } from "../lib/release-pr-fixture.ts";

const MAINTENANCE = ["ci: cache the bun install (#3)", "test: cover the bill total (#4)"];

test(
  "an unset or empty CHECKS_RELEASE_VERSION does not open a pull request for only maintenance commits",
  async () => {
    const widget = await consumer(MAINTENANCE);
    const noChanges = { exitCode: 0, text: "release-pr: no unreleased changes since v0.1.0\n" };
    expect(await widget.run(["ci.yml"])).toEqual(noChanges);
    expect(await widget.run(["ci.yml"], { CHECKS_RELEASE_VERSION: "" })).toEqual(noChanges);
    expect((await widget.state()).calls).toEqual(["GET repos/{owner}/{repo}", "GET repos/{owner}/{repo}"]);
  },
  60_000,
);

test(
  "CHECKS_RELEASE_VERSION plans a maintenance release rather than skipping it",
  async () => {
    const widget = await consumer(MAINTENANCE);
    const opened = await widget.run(["ci.yml"], { CHECKS_RELEASE_VERSION: "0.2.0" });
    expect(opened.exitCode).toBe(0);
    expect(opened.text).toContain("to release 0.2.0, and dispatched ci.yml on release/main");
    expect(await widget.inOrigin("show", "release/main:package.json")).toBe(manifest("0.2.0").trim());
  },
  60_000,
);

test(
  "a flag-shaped CHECKS_RELEASE_VERSION is refused by its own name rather than printing help or blaming --version",
  async () => {
    const widget = await consumer(MAINTENANCE);
    const refused = await widget.run(["ci.yml"], { CHECKS_RELEASE_VERSION: "-h" });
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toBe("checks-release-pr: CHECKS_RELEASE_VERSION -h is no plain major.minor.patch version\n");
    expect((await widget.state()).calls).toEqual(["GET repos/{owner}/{repo}"]);
  },
  60_000,
);

test(
  "--version 0.2.0 over only ci and test commits opens chore: release 0.2.0 whose changelog lists them",
  async () => {
    const widget = await consumer(MAINTENANCE);
    const main = await head(widget.dir);

    const opened = await widget.run(["--version", "0.2.0", "ci.yml"]);
    expect(opened.text).toContain("release-pr: opened https://github.com/acme/widget/pull/1 to release 0.2.0, and dispatched ci.yml on release/main\n");
    expect(opened.exitCode).toBe(0);
    expect(await widget.inOrigin("log", "-1", "--format=%s %P", "release/main")).toBe(`chore: release 0.2.0 ${main}`);
    expect(await widget.inOrigin("show", "release/main:package.json")).toBe(manifest("0.2.0").trim());
    const changelog = await widget.inOrigin("show", "release/main:CHANGELOG.md");
    const section = changelog.slice(changelog.indexOf("## 0.2.0"), changelog.indexOf("## 0.1.0"));
    expect(section).toContain("### Maintenance");
    expect(section).toContain("- cache the bun install [#3](https://github.com/acme/widget/pull/3)");
    expect(section).toContain("- cover the bill total [#4](https://github.com/acme/widget/pull/4)");
    expect((await widget.state()).pulls.map(({ title, body }) => ({ title, body }))).toEqual([{ title: "chore: release 0.2.0", body: "Release 0.2.0." }]);
    expect(await readFile(join(widget.dir, "package.json"), "utf8")).toBe(manifest("0.1.0"));
  },
  60_000,
);

test(
  "--version over build and docs commits keeps the Maintenance section through tagging and publishing",
  async () => {
    const widget = await consumer(["build(deps): update the parser (#3)", "docs: explain rate limits (#4)"]);
    const opened = await widget.run(["--version", "0.2.0", "ci.yml"]);
    expect(opened.exitCode).toBe(0);
    const proposed = await widget.inOrigin("rev-parse", "release/main");
    const changelog = await widget.inOrigin("show", "release/main:CHANGELOG.md");
    const entries = [
      "### Maintenance",
      "",
      "- explain rate limits [#4](https://github.com/acme/widget/pull/4)",
      "- **deps:** update the parser [#3](https://github.com/acme/widget/pull/3)",
    ].join("\n");
    expect(changelog).toContain(`\n${entries}\n\n## 0.1.0\n`);

    await widget.inOrigin("update-ref", "refs/pull/1/head", proposed);
    await $`git fetch -q origin release/main && git merge -q --squash FETCH_HEAD && git commit -qm ${"chore: release 0.2.0 (#1)"}`
      .cwd(widget.dir).quiet();
    const landed = await head(widget.dir);
    const { result, npm } = await widget.tagAndPublish();
    expect(result.exitCode).toBe(0);
    expect(await widget.inOrigin("rev-parse", "refs/tags/v0.2.0")).toBe(landed);
    const { releases } = await widget.state();
    expect(releases.map(({ tag_name, body }) => [tag_name, body.slice(body.indexOf("### Maintenance"))])).toEqual([["v0.2.0", entries]]);
    expect((await npm.state()).latestByPackage["widget"]).toBe("0.2.0");
    expect((await npm.state()).published).toEqual([landed]);
  },
  60_000,
);

test(
  "--version does not mistake a commit with an empty subject for an empty range",
  async () => {
    const widget = await consumer([]);
    await $`git commit -q --allow-empty --allow-empty-message -m ${""} && git push -q origin main`.cwd(widget.dir).quiet();
    const commit = await head(widget.dir);
    const opened = await widget.run(["--version", "0.2.0", "ci.yml"]);
    expect(opened.exitCode).toBe(0);
    const changelog = await widget.inOrigin("show", "release/main:CHANGELOG.md");
    expect(changelog).toContain(`\n### Maintenance\n\n- commit ${commit.slice(0, 12)}\n\n## 0.1.0\n`);
  },
  60_000,
);

test.each(["--version", "CHECKS_RELEASE_VERSION"] as const)(
  "%s refuses invalid versions by the input actually used and pushes nothing",
  async (source) => {
    const widget = await consumer(MAINTENANCE);
    const run = (version: string) => source === "--version"
      ? widget.run(["--version", version, "ci.yml"], { CHECKS_RELEASE_VERSION: "0.9.0" })
      : widget.run(["ci.yml"], { CHECKS_RELEASE_VERSION: version });
    const refusals: Record<string, string> = {
      "0.1.0": "checks-release-pr: --version 0.1.0 is not newer than 0.1.0, which package.json holds",
      "0.0.9": "checks-release-pr: --version 0.0.9 is not newer than 0.1.0, which package.json holds",
      "0.2": "checks-release-pr: --version 0.2 is no plain major.minor.patch version",
      "0.02.0": "checks-release-pr: --version 0.02.0 is no plain major.minor.patch version",
      "0.2.0-rc.1": "checks-release-pr: --version 0.2.0-rc.1 is no plain major.minor.patch version",
    };
    for (const [version, message] of Object.entries(refusals)) {
      const refused = await run(version);
      expect(refused.exitCode).toBe(2);
      expect(refused.text).toBe(`${message.replace("--version", source)}\n`);
    }

    await widget.commit("feat: price a bill (#5)");
    const below = await run("0.1.1");
    expect(below.exitCode).toBe(2);
    expect(below.text).toBe(`checks-release-pr: ${source} 0.1.1 is below 0.2.0, which the unreleased changes since v0.1.0 need\n`);

    await writeFile(join(widget.dir, "package.json"), manifest("0.2.0"));
    await widget.commit("chore: release 0.2.0 (#6)");
    await $`git tag v0.2.0`.cwd(widget.dir).quiet();
    const empty = await run("0.2.1");
    expect(empty.exitCode).toBe(2);
    expect(empty.text).toBe(`checks-release-pr: ${source} 0.2.1 has no commit to release since v0.2.0\n`);

    const missing = await widget.run(["ci.yml", "--version"]);
    expect(missing.exitCode).toBe(2);
    expect(missing.text).toContain("usage: checks-release-pr");

    expect((await widget.state()).calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
    expect(await widget.inOrigin("for-each-ref", "--format=%(refname)", "refs/heads/release/")).toBe("");
  },
  60_000,
);
