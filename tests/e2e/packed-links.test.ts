import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path/posix";
import { Schema } from "effect";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

const Packed = Schema.fromJsonString(Schema.Tuple([Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) })]));

function relativeLinks(markdown: string): readonly string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].flatMap(([, target = ""]) => {
    const path = target.split("#")[0] ?? "";
    return path === "" || /^[a-z][a-z+.-]*:/i.test(path) ? [] : [path];
  });
}

test("every relative link in a markdown file the package ships resolves to a file the package ships", async () => {
  const packed = await $`npm pack --dry-run --json --ignore-scripts`.cwd(CHECKOUT).quiet();
  const [{ files }] = Schema.decodeSync(Packed)(packed.stdout.toString());
  const shipped = new Set(files.map(({ path }) => path));
  const markdown = [...shipped].filter((path) => path.endsWith(".md"));
  expect(markdown).toContain("README.md");
  const dangling = markdown.flatMap((file) =>
    relativeLinks(readFileSync(join(CHECKOUT, file), "utf8"))
      .map((link) => normalize(join(dirname(file), link)))
      .filter((target) => !shipped.has(target))
      .map((target) => `${file} links ${target}`),
  );
  expect(dangling).toEqual([]);
});
