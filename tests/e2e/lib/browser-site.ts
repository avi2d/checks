import { $ } from "bun";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./fixture-repo.ts";

const RUNNER = join(CHECKOUT, "src", "quality", "browser", "browser.ts");

export const HOOK_TYPES = join(CHECKOUT, "src", "quality", "browser", "hooks.ts");

export type Declared = {
  readonly site?: string;
  readonly routes?: readonly { readonly path: string; readonly locale: string }[];
  readonly viewports?: readonly { readonly name: string; readonly width: number; readonly height: number; readonly touch?: boolean }[];
  readonly states?: readonly { readonly name: string; readonly textPx?: number; readonly reducedMotion?: "reduce" | "no-preference" }[];
  readonly targets?: readonly { readonly name: string; readonly selector: string; readonly routes?: readonly string[]; readonly focusable?: boolean }[];
  readonly checks: readonly string[];
  readonly hooks?: string;
};

export function page(body: string, { head = "", lang = "en", viewport = "width=device-width, initial-scale=1" } = {}): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="${viewport}"><title>Fixture</title>${head}</head><body><main>${body}</main></body></html>`;
}

export function routesOf(pages: Readonly<Record<string, string>>): readonly { readonly path: string; readonly locale: string }[] {
  return Object.keys(pages).map((path) => ({ path: `/${path}`, locale: "en" }));
}

export function declaration(declared: Declared): string {
  return JSON.stringify({
    site: "dist",
    routes: [{ path: "/", locale: "en" }],
    viewports: [{ name: "phone", width: 320, height: 640 }],
    states: [{ name: "default" }],
    targets: [{ name: "link", selector: "main a", focusable: true }],
    ...declared,
  });
}

export type BrowserSite = {
  readonly dir: string;
  readonly write: (files: Readonly<Record<string, string>>) => Promise<void>;
  readonly run: (env?: Readonly<Record<string, string>>) => Promise<Ran>;
};

const scratch = scratchDirs();

export async function browserSite(files: Readonly<Record<string, string>>): Promise<BrowserSite> {
  const dir = await scratch("checks-browser-");
  // A hooks module imports effect and the kit's types the way a product's would, through node_modules.
  await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));
  const write = async (written: Readonly<Record<string, string>>): Promise<void> => {
    for (const [name, content] of Object.entries(written)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content);
    }
  };
  await write(files);
  return { dir, write, run: (env = {}) => ran($`bun ${RUNNER}`.cwd(dir).env({ ...process.env, ...env })) };
}

export function failuresOf(text: string): readonly string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => / failure\(s\) in /.test(line));
  return start === -1 ? [] : lines.slice(start + 1).filter((line) => line.startsWith("  ")).map((line) => line.trim());
}
