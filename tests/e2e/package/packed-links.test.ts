import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";
import { CHECKOUT } from "../lib/fixture-repo.ts";
import { packedPaths } from "../lib/packed.ts";

function relativeLinks(markdown: string): readonly string[] {
  return [...markdown.replaceAll(/`[^`\n]*`/g, "").matchAll(/\]\(([^)\s]+)\)/g)].flatMap(([, target = ""]) => {
    const path = target.split("#")[0] ?? "";
    return path === "" || /^[a-z][a-z+.-]*:/i.test(path) ? [] : [path];
  });
}

test("every relative link in a markdown file the package ships resolves to a file the package ships", async () => {
  const shipped = await packedPaths();
  const markdown = [...shipped].filter((path) => path.endsWith(".md"));
  expect(markdown).toContain("README.md");
  const dangling = markdown.flatMap((file) =>
    relativeLinks(readFileSync(join(CHECKOUT, file), "utf8"))
      .map((link) => normalize(join(dirname(file), link)))
      .filter((target) => !shipped.has(target))
      .map((target) => `${file} links ${target}`),
  );
  expect(dangling).toEqual([]);
}, 30_000);
