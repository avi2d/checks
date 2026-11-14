import { expect, test } from "bun:test";
import { ConfigProvider, Effect } from "effect";
import { cellsAtOnce, walkCells, type Cell } from "../../../src/quality/browser/cells.ts";

type Watch = { running: number; peak: number; aloneSawOthers: boolean; finished: string[] };

function watched(watch: Watch, name: string, alone: boolean, millis: number): Cell<string, never> {
  const reading = Effect.gen(function* () {
    watch.running += 1;
    watch.peak = Math.max(watch.peak, watch.running);
    if (alone && watch.running > 1) watch.aloneSawOthers = true;
    yield* Effect.sleep(`${millis} millis`);
    watch.running -= 1;
    watch.finished.push(name);
    return name;
  });
  return { reading, alone };
}

function walk(spec: readonly { name: string; alone?: boolean; millis: number }[], concurrency: number) {
  const watch: Watch = { running: 0, peak: 0, aloneSawOthers: false, finished: [] };
  const cells = spec.map(({ name, alone = false, millis }) => watched(watch, name, alone, millis));
  return Effect.runPromise(walkCells(cells, concurrency)).then((results) => ({ results, watch }));
}

const TEN = Array.from({ length: 10 }, (_, index) => ({ name: `cell ${index}`, millis: 5 + ((index * 7) % 4) * 10 }));

test("results come back in the listed order even when later cells finish first, rather than in finishing order", async () => {
  const { results, watch } = await walk(TEN, 4);
  expect(results).toEqual(TEN.map(({ name }) => name));
  expect(watch.finished).not.toEqual(results);
});

test("no more cells run at once than the cap, rather than all ten together", async () => {
  expect((await walk(TEN, 4)).watch.peak).toBe(4);
  expect((await walk(TEN, 1)).watch.peak).toBe(1);
});

test("a cell marked alone runs with nothing beside it and keeps its place, rather than joining the batch", async () => {
  const spec = [...TEN.slice(0, 3), { name: "motion", alone: true, millis: 5 }, ...TEN.slice(3, 6)];
  const { results, watch } = await walk(spec, 4);
  expect(watch.aloneSawOthers).toBe(false);
  expect(results).toEqual(spec.map(({ name }) => name));
});

function cap(env: Record<string, string>) {
  return Effect.runPromise(cellsAtOnce.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))));
}

test("the cap is four when CHECKS_BROWSER_CELLS is unset, rather than unbounded", async () => {
  expect(await cap({})).toBe(4);
});

test("CHECKS_BROWSER_CELLS sets the cap, rather than being ignored", async () => {
  expect(await cap({ CHECKS_BROWSER_CELLS: "2" })).toBe(2);
});

test.each(["0", "-1", "2.5", "four"])("CHECKS_BROWSER_CELLS=%s is refused naming the variable, rather than walking with a broken cap", async (value) => {
  expect(cap({ CHECKS_BROWSER_CELLS: value })).rejects.toThrow("CHECKS_BROWSER_CELLS");
});
