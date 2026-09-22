import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..");

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function oxlint(): Promise<{ exitCode: number; text: string }> {
  const binary = join(dir, "node_modules", ".bin", "oxlint");
  const result = await $`${binary} --type-aware`.cwd(dir).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

async function writeConsumerFixture(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-consumer-"));

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "checks-consumer-fixture",
      type: "module",
      devDependencies: {
        "@avi2d/checks": `file:${CHECKOUT}`,
        effect: "4.0.0-rc.115",
        oxlint: "1.83.0",
      },
    }),
  );
  await writeFile(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      extends: ["./node_modules/@avi2d/checks/oxlintrc.json"],
      // oxlint's plugins do not inherit through extends, so the consumer restates them.
      plugins: ["typescript", "oxc", "eslint", "import"],
    }),
  );
  // oxlint honours .gitignore but not ignorePatterns for node_modules,
  // so the fixture carries the same node_modules/ entry a real consumer has.
  await writeFile(join(dir, ".gitignore"), "node_modules/\n");

  await $`bun install`.cwd(dir).quiet();
}

test(
  "file: consumer goes red on a planted Effect.ignore, green once it is removed",
  async () => {
    await writeConsumerFixture();
    await writeFile(
      join(dir, "plant.ts"),
      `import { Effect } from "effect";\n\nexport const program = Effect.ignore(Effect.fail("boom"));\n\nEffect.succeed(1);\n`,
    );

    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("plant.ts");
    expect(red.text).toContain("effect-channel(no-error-channel-escape)");

    await rm(join(dir, "plant.ts"));
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);

    const green = await oxlint();
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "file: consumer lint stays green with a lint-dirty file inside the installed package",
  async () => {
    await writeConsumerFixture();
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);
    await writeFile(
      join(dir, "node_modules", "@avi2d", "checks", "effect-channel", "planted.ts"),
      `import { Effect } from "effect";\n\nexport const planted = Effect.ignore(Effect.fail("boom"));\n`,
    );

    const result = await oxlint();
    expect(result.exitCode).toBe(0);
  },
  180_000,
);

test("package files cover every exports target", async () => {
  const raw = await readFile(join(CHECKOUT, "package.json"), "utf8");
  const manifest = JSON.parse(raw) as { exports?: Record<string, string>; files?: string[] };
  const targets = Object.values(manifest.exports ?? {}).map((target) =>
    target.replace(/^\.\//, ""),
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(manifest.files?.some((entry) => target === entry || target.startsWith(`${entry}/`))).toBe(
      true,
    );
  }
});
