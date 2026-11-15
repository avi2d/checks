import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { releasedMains } from "../lib/released-main.ts";
import { CHECKOUT, ran } from "../lib/fixture-repo.ts";

const GATE = join(CHECKOUT, "src", "delivery", "production-gate.ts");
const RELEASE = join(CHECKOUT, "src", "delivery", "release-tag.ts");

const onMain = releasedMains("checks-production-gate-");

async function released() {
  const main = await onMain("chore: release 0.2.0 (#7)");
  expect((await main.run(RELEASE, [])).exitCode).toBe(0);
  return main;
}

test(
  "the commit checks-release-tag released passes without running any test",
  async () => {
    const main = await released();

    expect(await main.run(GATE, [])).toEqual({
      exitCode: 0,
      text: `production-gate: ${main.head.slice(0, 12)} is the release v0.2.0, so production publishes it without running the tests again\n`,
    });
    expect((await main.run(GATE, [main.head])).exitCode).toBe(0);
  },
  60_000,
);

test(
  "a release commit that was never released, whose tag does not exist, is refused",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)");

    const refused = await main.run(GATE, []);
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toBe(
      `production-gate: production publishes only a published release, and ${main.head.slice(0, 12)} has no tag v0.2.0; merge its release pull request first\n`,
    );
  },
  60_000,
);

test(
  "a commit that landed after the release is refused, since the tag of its version is on the release commit",
  async () => {
    const main = await released();
    await $`git commit -q --allow-empty -m ${"fix: round a bill (#9)"}`.cwd(main.dir).quiet();

    const refused = await main.run(GATE, []);
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toContain(`has v0.2.0 on ${main.head.slice(0, 12)}, not on it;`);
  },
  60_000,
);

test(
  "a draft release, or one whose notes lost the changelog section, is refused",
  async () => {
    const main = await released();
    const edit = (body: Readonly<Record<string, unknown>>) =>
      ran($`gh api --method PATCH repos/{owner}/{repo}/releases/1 --input - < ${Buffer.from(JSON.stringify(body))}`.cwd(main.dir).env({ ...process.env, ...main.env }));

    await edit({ name: "v0.2.0", body: "price a bill", draft: true, prerelease: false });
    expect((await main.run(GATE, [])).text).toContain("has only the draft release v0.2.0;");

    await edit({ name: "v0.2.0", body: "nothing", draft: false, prerelease: false });
    expect((await main.run(GATE, [])).text).toContain("has the release v0.2.0, whose notes lack the CHANGELOG.md section for 0.2.0;");
  },
  60_000,
);
