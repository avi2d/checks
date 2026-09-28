import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { consumerTrees, KIT_BIN, type KitTree } from "./lib/consumer-tree.ts";
import type { Ran } from "./lib/fixture-repo.ts";

const consumerTree = consumerTrees("checks-astro-consumer-");

function astroTree(): Promise<KitTree> {
  return consumerTree({ paths: ["src/**/*.ts"], include: ["src/**/*.ts"], types: [] });
}

function oxlint(tree: KitTree): Promise<Ran> {
  return tree.run(join(KIT_BIN, "oxlint"), ["--type-aware"]);
}

test(
  "consumer goes red on logic in .astro frontmatter, green once only imports, props and markup remain",
  async () => {
    const tree = await astroTree();
    await tree.put("src/load.ts", `export function load(): string[] {\n  return [];\n}\n`);
    await tree.put(
      "src/pages/page.astro",
      `---\nimport { load } from "../load.ts";\n\nconst items = await load();\n---\n<html><body>{items.length}</body></html>\n`,
    );

    const red = await oxlint(tree);
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("page.astro");
    expect(red.text).toContain("readability(thin-astro)");

    await tree.put("src/render.ts", `export function render(title: string): string {\n  return title;\n}\n`);
    await tree.put(
      "src/pages/page.astro",
      `---\nimport { render } from "../render.ts";\n\ninterface Props {\n  title: string;\n}\n\nconst { title } = Astro.props;\n---\n<html><body><h1>{title}</h1>{render(title)}</body></html>\n`,
    );
    await rm(join(tree.dir, "src", "load.ts"));

    const green = await oxlint(tree);
    expect(green.text).not.toContain("readability(thin-astro)");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "consumer goes red on getStaticPaths declared in .astro frontmatter, green once it is re-exported from a .ts file",
  async () => {
    const tree = await astroTree();
    await tree.put(
      "src/pages/[slug].astro",
      `---\nexport function getStaticPaths() {\n  return [{ params: { slug: "home" } }];\n}\n\nconst { slug } = Astro.props;\n---\n<html><body>{slug}</body></html>\n`,
    );

    const red = await oxlint(tree);
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("[slug].astro");
    expect(red.text).toContain("readability(thin-astro)");

    await tree.put(
      "src/paths.ts",
      `export function getStaticPaths(): readonly { readonly params: { readonly slug: string } }[] {\n  return [{ params: { slug: "home" } }];\n}\n`,
    );
    await tree.put(
      "src/pages/[slug].astro",
      `---\nexport { getStaticPaths } from "../paths.ts";\n\ninterface Props {\n  slug: string;\n}\n\nconst { slug } = Astro.props;\n---\n<html><body>{slug}</body></html>\n`,
    );

    const green = await oxlint(tree);
    expect(green.text).not.toContain("readability(thin-astro)");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
