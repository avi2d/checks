import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "commit-identity.ts");

const OWNER = { name: "avi2d", email: "avi2dg@gmail.com" };
const STRANGER = { name: "Pat Stranger", email: "stranger@example.com" };
const SQUASH = { name: "GitHub", email: "noreply@github.com" };
const INTRUDER = { name: "Ivy Intruder", email: "intruder@example.com" };

type Identity = { name: string; email: string };

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

function identityEnv(author: Identity, committer: Identity) {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
  };
}

async function initRepo(manifest?: unknown): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-commit-identity-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(manifest ?? { name: "commit-identity-fixture" }),
  );
  await $`git init -q -b main`.cwd(dir).quiet();
}

async function commit(options: {
  readonly message: string;
  readonly author?: Identity;
  readonly committer?: Identity;
}): Promise<string> {
  const env = identityEnv(options.author ?? OWNER, options.committer ?? OWNER);
  await writeFile(join(dir, "file.txt"), `${Math.random()}\n`);
  await $`git add -A && git commit -q --no-gpg-sign -m ${options.message}`.cwd(dir).env(env).quiet();
  const sha = await $`git rev-parse HEAD`.cwd(dir).quiet();
  return sha.stdout.toString().trim();
}

async function check(...args: readonly string[]): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT} ${args}`.cwd(dir).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

test(
  "commit-identity goes red on a foreign author and names the commit",
  async () => {
    await initRepo();
    const base = await commit({ message: "feat: base" });
    const foreign = await commit({ message: "feat: stolen", author: STRANGER });

    const red = await check(base, "HEAD");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(foreign.slice(0, 12));
    expect(red.text).toContain("feat: stolen");
    expect(red.text).toContain("author Pat Stranger <stranger@example.com>");
    expect(red.text).toContain("allowed: avi2d <avi2dg@gmail.com>");
  },
  60_000,
);

test(
  "commit-identity goes red on a foreign committer",
  async () => {
    await initRepo();
    const base = await commit({ message: "feat: base" });
    const foreign = await commit({ message: "feat: relayed", committer: STRANGER });

    const red = await check(base, "HEAD");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(foreign.slice(0, 12));
    expect(red.text).toContain("committer Pat Stranger <stranger@example.com>");
  },
  60_000,
);

test(
  "commit-identity goes red only on a Co-authored-by trailer in the trailer block",
  async () => {
    await initRepo();
    const base = await commit({ message: "feat: base" });
    const coauthored = await commit({
      message: "feat: helped\n\nCo-authored-by: Pat Stranger <stranger@example.com>\n",
    });
    const lowercase = await commit({
      message: "feat: helped again\n\nco-authored-by: Pat Stranger <stranger@example.com>\n",
    });
    await commit({ message: "feat: signed\n\nSigned-off-by: avi2d <avi2dg@gmail.com>\n" });
    await commit({ message: "feat: reviewed\n\nReviewed-by: Someone <someone@example.com>\n" });
    await commit({ message: "fix: reject <foo@bar.com>\n\nError: expected <user@host> in the body.\n" });
    await commit({
      message:
        "feat: quoted\n\nThe squash wrote Co-authored-by: Pat Stranger <stranger@example.com> in prose.\n\nSee the log.\n",
    });

    const red = await check(base, "HEAD");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(coauthored.slice(0, 12));
    expect(red.text).toContain("trailer Co-authored-by: Pat Stranger <stranger@example.com>");
    expect(red.text).toContain(lowercase.slice(0, 12));
    expect(red.text).toContain("trailer co-authored-by: Pat Stranger <stranger@example.com>");
    expect(red.text).toContain("2 of 6 commit(s)");
  },
  60_000,
);

test(
  "commit-identity goes green on a clean history, including GitHub as squash committer",
  async () => {
    await initRepo();
    const base = await commit({ message: "feat: base" });
    await commit({ message: "feat: clean\n\nA body that mentions a trailerless fact.\n" });
    await commit({ message: "fix: squashed (#12)", committer: SQUASH });

    const green = await check(base, "HEAD");
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("2 commit(s)");

    const single = await check("HEAD");
    expect(single.exitCode).toBe(0);
  },
  60_000,
);

test(
  "commit-identity reads the allowlist from the consumer package.json",
  async () => {
    await initRepo({
      name: "commit-identity-fixture",
      commitIdentity: { authors: [STRANGER] },
    });
    const base = await commit({ message: "feat: base", author: STRANGER, committer: STRANGER });
    await commit({ message: "feat: theirs", author: STRANGER, committer: STRANGER });

    const green = await check(base, "HEAD");
    expect(green.exitCode).toBe(0);

    const red = await check(`${base}~1`, "HEAD");
    expect(red.exitCode).toBe(2);
    expect(red.text).toContain("git log");
  },
  60_000,
);

test(
  "commit-identity judges a root commit in the one-argument form",
  async () => {
    await initRepo({ name: "commit-identity-fixture", commitIdentity: { authors: [STRANGER] } });
    const root = await commit({ message: "feat: first", author: STRANGER, committer: STRANGER });
    const green = await check(root);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain(`1 commit(s) in ${root} carry only allowed identities`);

    await $`git checkout -q --orphan foreign`.cwd(dir).quiet();
    const foreign = await commit({ message: "feat: other first", author: INTRUDER, committer: STRANGER });
    const red = await check(foreign);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("author Ivy Intruder <intruder@example.com>");
  },
  60_000,
);

test(
  "commit-identity refuses a malformed allowlist and a missing argument",
  async () => {
    await initRepo({ name: "commit-identity-fixture", commitIdentity: { authors: [] } });
    await commit({ message: "feat: base" });

    const malformed = await check("HEAD");
    expect(malformed.exitCode).toBe(2);
    expect(malformed.text).toContain("non-empty authors array");

    const usage = await check();
    expect(usage.exitCode).toBe(2);
    expect(usage.text).toContain("usage: commit-identity.ts");
  },
  60_000,
);
