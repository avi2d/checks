import { expect, test } from "bun:test";
import { compareReport, PAGE_OF, planCells, type PlannedCheckName } from "../../../src/quality/browser/schedule.ts";

const scheduled = (names: readonly PlannedCheckName[]) =>
  names.map((name) => {
    const page = PAGE_OF[name];
    return page.sharing === "shared"
      ? { name, mode: "shared" as const, alone: page.alone }
      : { name, mode: "independent" as const, alone: page.alone };
  });

test("target discovery and nesting share one load within a visit rather than opening separate pages", () => {
  const { shared, separate } = planCells(scheduled(["targets", "nesting"]));
  expect(shared.map(({ name }) => name)).toEqual(["targets", "nesting"]);
  expect(separate).toEqual([]);
});

test("every other check loads its own page rather than joining the shared one", () => {
  const names = (Object.keys(PAGE_OF) as readonly PlannedCheckName[]).filter((name) => name !== "targets" && name !== "nesting");
  expect(names).toEqual(["layout", "keyboard", "motion", "axe", "html", "links", "assets", "contrast", "weight", "shift", "look", "hook"]);
  expect(names.filter((name) => PAGE_OF[name].alone)).toEqual(["motion", "hook"]);
  for (const name of names) {
    const { shared, separate } = planCells([...scheduled(["targets", "nesting"]), ...scheduled([name])]);
    expect(shared.map(({ name: check }) => check)).toEqual(["targets", "nesting"]);
    expect(separate.map(({ name: check }) => check)).toEqual([name]);
  }
});

test("keyboard keeps its report place ahead of nesting rather than following the shared load", () => {
  const indexed = scheduled(["targets", "keyboard", "nesting"]).map((check, checkIndex) => ({ ...check, visitIndex: 0, checkIndex }));
  const { shared, separate } = planCells(indexed);
  const readings = [
    ...shared.map((check) => ({ visitIndex: 0, checkIndex: check.checkIndex, name: check.name })),
    ...separate.map((check) => ({ visitIndex: 0, checkIndex: check.checkIndex, name: check.name })),
  ].sort(compareReport);
  expect(readings.map(({ name }) => name)).toEqual(["targets", "keyboard", "nesting"]);
});
