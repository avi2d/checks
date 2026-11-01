import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { isRecord } from "../../src/delivery/workflow-references.ts";

const CHECKOUT = join(import.meta.dir, "..", "..");

export type DocWorkflow = {
  readonly page: string;
  readonly name: string;
  readonly text: string;
  readonly document: Readonly<Record<string, unknown>>;
};

function fencedWorkflows(page: string, text: string): readonly DocWorkflow[] {
  return text
    .split("```")
    .filter((_, index) => index % 2 === 1)
    .map((fence) => fence.replace(/^[a-z]+\n/, ""))
    .flatMap((body) => {
      let parsed: unknown;
      try {
        parsed = Bun.YAML.parse(body);
      } catch {
        return [];
      }
      return isRecord(parsed) && typeof parsed["name"] === "string" && "on" in parsed ? [{ page, name: parsed["name"], text: body, document: parsed }] : [];
    });
}

export async function docWorkflows(): Promise<readonly DocWorkflow[]> {
  const pages = await Array.fromAsync(new Glob("docs/**/*.md").scan({ cwd: CHECKOUT }));
  const read = await Promise.all(pages.map(async (page) => fencedWorkflows(page, await readFile(join(CHECKOUT, page), "utf8"))));
  return read.flat();
}

export async function pageWorkflow(page: string, name: string): Promise<string> {
  const found = fencedWorkflows(page, await readFile(join(CHECKOUT, page), "utf8")).find((workflow) => workflow.name === name);
  if (found === undefined) throw new Error(`${page} holds no ${name} workflow`);
  return found.text;
}
