import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

type HostLoaded = {
  readonly path: string;
  readonly entry: string;
  readonly output: unknown;
};

const HOST_LOADED: readonly HostLoaded[] = [
  {
    path: "scripts/comment-matchers.ts",
    entry: `import { SYNTAXES, refused } from "./matchers";

const refusals = refused("src/probe.ts", "const a = 1; // @ts-expect-error\\n");
console.log(JSON.stringify({ reads: Object.hasOwn(SYNTAXES, "ts"), refusals }));
`,
    output: {
      reads: true,
      refusals: [
        "src/probe.ts:1 carries the machine-read directive `@ts-expect-error`. Fix what the tool is reporting, or stop running the tool on this file",
      ],
    },
  },
  {
    path: "scripts/prose-matchers.ts",
    entry: `import { isLivingDoc, proseRefused } from "./matchers";

const refusals = proseRefused("docs/guide.md", "It builds; it ships.\\n", new Set([1]));
console.log(JSON.stringify({ reads: isLivingDoc("README.md"), refusals }));
`,
    output: { reads: true, refusals: ["docs/guide.md:1 carries `;`, a semicolon. Use two sentences"] },
  },
];

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

for (const { path, entry, output } of HOST_LOADED) {
  test(`${path} runs synchronously alone in a directory with no node_modules, as a host links it`, async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-host-load-"));
    await copyFile(join(CHECKOUT, path), join(dir, "matchers.ts"));
    await writeFile(join(dir, "index.ts"), entry);

    const ran = await $`${process.execPath} --no-install index.ts`.cwd(dir).nothrow().quiet();

    expect(ran.stderr.toString()).toBe("");
    expect(JSON.parse(ran.stdout.toString())).toEqual(output);
    expect(ran.exitCode).toBe(0);
  });

  test(
    `the repo cruise refuses ${path} an import of effect`,
    async () => {
      dir = await mkdtemp(join(tmpdir(), "checks-host-cruise-"));
      for (const config of [".dependency-cruiser.cjs", "dependency-cruiser.config.js", "quality.json"]) {
        await copyFile(join(CHECKOUT, config), join(dir, config));
      }
      for (const linked of ["node_modules", "dist"]) await symlink(join(CHECKOUT, linked), join(dir, linked));
      await mkdir(join(dir, "scripts"));
      const source = await readFile(join(CHECKOUT, path), "utf8");
      const cruise = async (text: string): Promise<string> => {
        await writeFile(join(dir, path), text);
        const cruised = await $`${join(dir, "node_modules", ".bin", "depcruise")} --config .dependency-cruiser.cjs scripts`
          .cwd(dir)
          .nothrow()
          .quiet();
        return cruised.stdout.toString();
      };

      expect(await cruise(source)).not.toContain("host-loaded-imports-nothing");
      expect(await cruise(`import { Effect } from "effect";\nexport const planted = Effect.void;\n${source}`)).toContain(
        `error host-loaded-imports-nothing: ${path} → `,
      );
    },
    60_000,
  );
}
