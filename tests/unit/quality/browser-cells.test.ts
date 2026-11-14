import { expect, test } from "bun:test";
import { Effect } from "effect";
import { walkCells, type Cell } from "../../../src/quality/browser/cells.ts";

type Watch = { running: number; peak: number; aloneSawOthers: boolean; aloneRunning: number; finished: string[] };

function watched(watch: Watch, name: string, alone: boolean, millis: number): Cell<string, never> {
  const reading = Effect.gen(function* () {
    watch.running += 1;
    watch.peak = Math.max(watch.peak, watch.running);
    if (alone) {
      if (watch.running > 1) watch.aloneSawOthers = true;
      watch.aloneRunning += 1;
    } else if (watch.aloneRunning > 0) {
      watch.aloneSawOthers = true;
    }
    yield* Effect.sleep(`${millis} millis`);
    watch.running -= 1;
    if (alone) watch.aloneRunning -= 1;
    watch.finished.push(name);
    return name;
  });
  return { reading, alone };
}

function walk(spec: readonly { name: string; alone?: boolean; millis: number }[], concurrency: number) {
  const watch: Watch = { running: 0, peak: 0, aloneSawOthers: false, aloneRunning: 0, finished: [] };
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
