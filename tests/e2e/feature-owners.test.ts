import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "feature-owners.ts");
const FIXTURE = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];
const BILLING = {
  name: "billing",
  root: "src/billing",
  entries: ["src/billing/index.ts"],
  proof: "tests/e2e/billing.test.ts",
};
const INVOICES = {
  name: "invoices",
  root: "src/invoices",
  entries: ["src/invoices/index.ts"],
  proof: "tests/e2e/invoices.test.ts",
};

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

function proof(specifier: string, form = "import { charge } from"): string {
  return `import { expect, test } from "bun:test";\n${form} "${specifier}";\n\ntest("charges", () => {\n  expect(charge).toBeDefined();\n});\n`;
}

async function write(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
}

async function commit(message: string): Promise<string> {
  await $`git add -A && git ${FIXTURE} commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

async function repository(quality: Record<string, unknown>): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-feature-owners-"));
  await $`git init -q -b main`.cwd(dir).quiet();
  await writeFile(join(dir, "quality.json"), JSON.stringify(quality));
  await write({
    "src/billing/index.ts": `export { charge } from "./charge.ts";\n`,
    "src/billing/charge.ts": "export const charge = 1;\n",
    "src/invoices/index.ts": "export const invoice = 1;\n",
  });
}

async function owners(...refs: readonly string[]): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT} ${refs}`.cwd(dir).nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

test(
  "refuses a feature whose proof is missing or imports none of its entries, and passes once it imports one",
  async () => {
    await repository({ features: [BILLING] });
    const missing = await owners(await commit("feat: billing"));
    expect(missing.text).toBe(
      "feature-owners: 1 problem(s) with the features' runnable proofs:\n  billing: proof tests/e2e/billing.test.ts is not in the head commit\n",
    );
    expect(missing.exitCode).toBe(1);

    await write({ "tests/e2e/billing.test.ts": proof("../../src/billing/charge.ts") });
    const deep = await owners(await commit("test: deep"));
    expect(deep.text).toContain(
      "  billing: proof tests/e2e/billing.test.ts imports none of its entries, src/billing/index.ts\n",
    );
    expect(deep.exitCode).toBe(1);

    await write({ "tests/e2e/billing.test.ts": proof("../../src/billing/index.ts", "import type { charge } from") });
    const typeOnly = await owners(await commit("test: types"));
    expect(typeOnly.text).toContain("imports none of its entries");
    expect(typeOnly.exitCode).toBe(1);

    await write({ "tests/e2e/billing.test.ts": proof("../../src/billing/index.ts") });
    const proven = await commit("test: entry");
    await rm(join(dir, "tests/e2e/billing.test.ts"));
    const green = await owners(proven);
    expect(green.text).toBe("feature-owners: 1 feature(s) keep a proof under tests/e2e/ that imports an entry\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a proof that does not parse, or an entry missing from the head commit, is refused with the rest",
  async () => {
    await repository({ features: [BILLING, { ...INVOICES, entries: ["src/invoices/index.ts", "src/invoices/api.ts"] }] });
    await write({
      "tests/e2e/billing.test.ts": "import { charge from '../../src/billing/index.ts';\n",
      "tests/e2e/invoices.test.ts": proof("../../src/invoices/index.js", "import { invoice as charge } from"),
    });
    const result = await owners(await commit("feat: both"));
    expect(result.text).toContain("feature-owners: 2 problem(s) with the features' runnable proofs:\n");
    expect(result.text).toContain("  billing: proof tests/e2e/billing.test.ts does not parse: ");
    expect(result.text).toContain("  invoices: entry src/invoices/api.ts is not in the head commit\n");
    expect(result.text).not.toContain("invoices: proof");
    expect(result.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a proof importing a .tsx entry through its .js specifier imports that entry",
  async () => {
    await repository({ features: [{ ...BILLING, entries: ["src/billing/view.tsx"] }] });
    await write({
      "src/billing/view.tsx": "export const charge = <b>1</b>;\n",
      "tests/e2e/billing.test.ts": proof("../../src/billing/view.js"),
    });
    const result = await owners(await commit("feat: view"));
    expect(result.text).toBe("feature-owners: 1 feature(s) keep a proof under tests/e2e/ that imports an entry\n");
    expect(result.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a proof with a local export and no source is read, not crashed on",
  async () => {
    await repository({ features: [BILLING] });
    await write({ "tests/e2e/billing.test.ts": "export {};\n" });
    const empty = await owners(await commit("test: empty"));
    expect(empty.text).toBe(
      "feature-owners: 1 problem(s) with the features' runnable proofs:\n  billing: proof tests/e2e/billing.test.ts imports none of its entries, src/billing/index.ts\n",
    );
    expect(empty.exitCode).toBe(1);

    await write({ "tests/e2e/billing.test.ts": `${proof("../../src/billing/index.ts")}export { charge };\n` });
    const proven = await owners(await commit("test: entry"));
    expect(proven.text).toBe("feature-owners: 1 feature(s) keep a proof under tests/e2e/ that imports an entry\n");
    expect(proven.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a proof outside tests/e2e/ is refused where quality.json is read, and a repository declaring no feature passes",
  async () => {
    await repository({ features: [{ ...BILLING, proof: "tests/billing.test.ts" }] });
    const head = await commit("feat: billing");
    const outside = await owners(head);
    expect(outside.text).toContain("Expected a test file under tests/e2e/ such as tests/e2e/billing.test.ts");
    expect(outside.text).toContain('at ["features"][0]["proof"]');
    expect(outside.exitCode).toBe(2);

    await writeFile(join(dir, "quality.json"), JSON.stringify({ features: [] }));
    const none = await owners(head);
    expect(none.text).toBe("feature-owners: quality.json declares no feature\n");
    expect(none.exitCode).toBe(0);
  },
  60_000,
);

test(
  "while advisory it lists the owners a range touches and exits 0, and without changeSignal it lists none",
  async () => {
    await repository({ features: [BILLING, INVOICES], changeSignal: "advisory" });
    await write({
      "tests/e2e/billing.test.ts": proof("../../src/billing/index.ts"),
      "tests/e2e/invoices.test.ts": proof("../../src/invoices/index.ts", "import { invoice as charge } from"),
      "src/invoices/tax.ts": "export const tax = 1;\n",
    });
    const base = await commit("feat: base");

    await write({ "src/billing/charge.ts": "export const charge = 2;\n", "README.md": "# Notes\n" });
    const one = await commit("feat: charge");
    const single = await owners(base, one);
    expect(single.text).toContain("feature-owners: advisory, the range touches 1 feature owner(s):\n  billing: src/billing/charge.ts\n");
    expect(single.exitCode).toBe(0);

    await $`git mv src/invoices/tax.ts src/billing/tax.ts`.cwd(dir).quiet();
    await write({ "tests/e2e/invoices.test.ts": `${proof("../../src/invoices/index.ts", "import { invoice as charge } from")}\n` });
    const two = await commit("refactor: move tax");
    const spanning = await owners(base, two);
    expect(spanning.text).toContain(
      "feature-owners: advisory, the range touches 2 feature owner(s); a reviewer judges whether they make one slice:\n" +
        "  billing: src/billing/charge.ts, src/billing/tax.ts\n" +
        "  invoices: src/invoices/tax.ts, tests/e2e/invoices.test.ts\n",
    );
    expect(spanning.exitCode).toBe(0);

    await write({ "README.md": "# Notes on billing\n" });
    const docs = await owners(two, await commit("docs: notes"));
    expect(docs.text).toContain("feature-owners: advisory, the range touches no feature owner\n");
    expect(docs.exitCode).toBe(0);

    await writeFile(join(dir, "quality.json"), JSON.stringify({ features: [BILLING, INVOICES] }));
    const silent = await owners(base, two);
    expect(silent.text).toBe("feature-owners: 2 feature(s) keep a proof under tests/e2e/ that imports an entry\n");
    expect(silent.exitCode).toBe(0);
  },
  60_000,
);
