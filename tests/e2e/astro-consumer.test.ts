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

test(
  "consumer goes red on logic in an .astro script block, green once the block holds only a side-effect import",
  async () => {
    const tree = await astroTree();
    await tree.put(
      "src/pages/page.astro",
      `---\n---\n<html><body><button>Go</button></body></html>\n<script>\nconst button = document.querySelector("button");\nbutton?.addEventListener("click", () => {});\n</script>\n`,
    );

    const red = await oxlint(tree);
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("page.astro");
    expect(red.text).toContain("readability(thin-astro)");

    await tree.put(
      "src/client.ts",
      `document.querySelector("button")?.addEventListener("click", () => {});\n\nexport {};\n`,
    );
    await tree.put(
      "src/pages/page.astro",
      `---\n---\n<html><body><button>Go</button></body></html>\n<script>\nimport "../client.ts";\n</script>\n`,
    );

    const green = await oxlint(tree);
    expect(green.text).not.toContain("readability(thin-astro)");
    expect(green.text).not.toContain("no-unassigned-import");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "consumer goes red on a call or await in an Astro.props default, green once each default is a literal or a props name",
  async () => {
    const tree = await astroTree();
    await tree.put("src/load.ts", `export async function load(): Promise<number> {\n  return 0;\n}\n\nexport function label(): string {\n  return "Home";\n}\n`);
    await tree.put(
      "src/pages/called.astro",
      `---\nimport { label } from "../load.ts";\n\nconst { title = label() } = Astro.props;\n---\n<html><body>{title}</body></html>\n`,
    );
    await tree.put(
      "src/pages/awaited.astro",
      `---\nimport { load } from "../load.ts";\n\nconst { count = await load() } = Astro.props;\n---\n<html><body>{count}</body></html>\n`,
    );

    const red = await oxlint(tree);
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("called.astro");
    expect(red.text).toContain("awaited.astro");
    expect(red.text).toContain("readability(thin-astro)");

    await rm(join(tree.dir, "src", "load.ts"));
    await rm(join(tree.dir, "src", "pages", "awaited.astro"));
    await tree.put(
      "src/pages/called.astro",
      `---\ninterface Props {\n  title?: string;\n  heading?: string;\n}\n\nconst { title = "Home" } = Astro.props;\nconst { heading = title } = Astro.props;\n---\n<html><body><h1>{heading}</h1>{title}</body></html>\n`,
    );

    const green = await oxlint(tree);
    expect(green.text).not.toContain("readability(thin-astro)");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "consumer goes red on logic in an Astro.props default, green once each default is a signed number or an earlier props name",
  async () => {
    const tree = await astroTree();
    await tree.put(
      "src/pages/forward.astro",
      `---\nconst { heading = title, title = "Home" } = Astro.props;\n---\n<html><body><h1>{heading}</h1></body></html>\n`,
    );
    await tree.put(
      "src/pages/negated.astro",
      `---\nconst { count = -step } = Astro.props;\n---\n<html><body>{count}</body></html>\n`,
    );
    await tree.put(
      "src/pages/stranger.astro",
      `---\nconst { heading = title } = Astro.props;\n---\n<html><body><h1>{heading}</h1></body></html>\n`,
    );

    const red = await oxlint(tree);
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("forward.astro");
    expect(red.text).toContain("negated.astro");
    expect(red.text).toContain("stranger.astro");
    expect(red.text).toContain("readability(thin-astro)");

    await rm(join(tree.dir, "src", "pages", "forward.astro"));
    await rm(join(tree.dir, "src", "pages", "negated.astro"));
    await tree.put(
      "src/pages/stranger.astro",
      `---\nconst { count = -1, step = +1 } = Astro.props;\n---\n<html><body>{count}{step}</body></html>\n`,
    );
    await tree.put(
      "src/pages/renamed.astro",
      `---\nconst { title = "Home", heading = title } = Astro.props;\n---\n<html><body><h1>{heading}</h1></body></html>\n`,
    );

    const green = await oxlint(tree);
    expect(green.text).not.toContain("readability(thin-astro)");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "consumer goes red on a signed number or a same-pattern name as a computed key, green once the key is a literal or an earlier statement's name",
  async () => {
    const tree = await astroTree();
    await tree.put(
      "src/pages/signed-key.astro",
      `---\nconst { [-1]: count } = Astro.props;\n---\n<html><body>{count}</body></html>\n`,
    );
    await tree.put(
      "src/pages/signed-index.astro",
      `---\nconst count = Astro.props.values[-1];\n---\n<html><body>{count}</body></html>\n`,
    );
    await tree.put(
      "src/pages/own-key.astro",
      `---\nconst { key, [key]: title } = Astro.props;\n---\n<html><body>{title}</body></html>\n`,
    );

    const red = await oxlint(tree);
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("signed-key.astro");
    expect(red.text).toContain("signed-index.astro");
    expect(red.text).toContain("own-key.astro");
    expect(red.text).toContain("readability(thin-astro)");

    await tree.put(
      "src/pages/signed-key.astro",
      `---\nconst { [1]: count } = Astro.props;\n---\n<html><body>{count}</body></html>\n`,
    );
    await tree.put(
      "src/pages/signed-index.astro",
      `---\nconst count = Astro.props.values[1];\n---\n<html><body>{count}</body></html>\n`,
    );
    await tree.put(
      "src/pages/own-key.astro",
      `---\nconst { key } = Astro.props;\nconst { [key]: title } = Astro.props;\n---\n<html><body>{title}</body></html>\n`,
    );

    const green = await oxlint(tree);
    expect(green.text).not.toContain("readability(thin-astro)");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
