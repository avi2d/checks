import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../../src/delivery/workflow-references.ts";

const CHECKOUT = join(import.meta.dir, "..", "..");

export async function pageWorkflow(page: string, name: string): Promise<string> {
  const text = await readFile(join(CHECKOUT, page), "utf8");
  const bodies = text
    .split("```")
    .filter((_, index) => index % 2 === 1)
    .map((fence) => fence.replace(/^[a-z]+\n/, ""));
  for (const body of bodies) {
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(body);
    } catch {
      continue;
    }
    if (isRecord(parsed) && parsed["name"] === name) return body;
  }
  throw new Error(`${page} holds no ${name} workflow`);
}
