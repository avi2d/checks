import { expect, test } from "bun:test";
import { compareReport, PAGE_OF, planCells, type PlannedCheckName } from "../../../src/quality/browser/schedule.ts";

const isPlanned = (name: string): name is PlannedCheckName => Object.hasOwn(PAGE_OF, name);

const scheduled = (names: readonly PlannedCheckName[]) =>
  names.map((name) => ({ name, ...PAGE_OF[name] }));

test("axe does not reload the visit or inject scripts before nesting reads the page", () => {
  const { shared, separate } = planCells(scheduled(["targets", "axe", "nesting"]));
  expect(shared.map(({ name }) => name)).toEqual(["targets", "nesting", "axe"]);
  expect(separate).toEqual([]);
});

test("every other check loads its own page rather than joining the shared one", () => {
  const names = Object.keys(PAGE_OF).filter(isPlanned).filter((name) => name !== "targets" && name !== "nesting" && name !== "axe");
  expect(names).toEqual(["layout", "keyboard", "motion", "html", "links", "assets", "contrast", "weight", "shift", "look", "hook"]);
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
