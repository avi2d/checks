import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..", "..");
const TEST_FILE = /\.test\.tsx?$/;

const directories = (path: string): readonly string[] =>
  readdirSync(resolve(CHECKOUT, path), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

const AREAS = [...directories("src"), "scripts", "package"];

const misplaced = (level: "unit" | "e2e", helpers: readonly string[]): readonly string[] =>
  readdirSync(resolve(CHECKOUT, "tests", level), { recursive: true, encoding: "utf8" })
    .filter((path) => TEST_FILE.test(path))
    .filter((path) => {
      const [folder, ...rest] = path.split("/");
      return rest.length === 0 || folder === undefined || helpers.includes(folder) || !AREAS.includes(folder);
    })
    .map((path) => `tests/${level}/${path}`);

test("a unit or e2e test at the top of its level, or under a folder no src area names, is refused", () => {
  expect(misplaced("unit", [])).toEqual([]);
  expect(misplaced("e2e", ["lib"])).toEqual([]);
});
