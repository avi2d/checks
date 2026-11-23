import { expect, test } from "bun:test";
import { planShard, runsInShard, type RouteWork } from "../../../src/quality/browser/shard.ts";

const work = (path: string, ...checks: string[]): RouteWork => ({ path, checks: new Map(checks.map((check) => [check, 1])) });

const routesOf = (plan: { readonly routes: ReadonlySet<string> }) => [...plan.routes].toSorted();

test("two shards split routes by measured time rather than by route count", () => {
  const routes = [work("/", "targets", "axe"), work("/a/", "axe"), work("/b/", "axe"), work("/c/", "axe")];
  const timings = { "/": { targets: 100, axe: 500 }, "/a/": { axe: 300 }, "/b/": { axe: 200 }, "/c/": { axe: 100 } };
  expect(routesOf(planShard(routes, timings, { index: 1, count: 2 }))).toEqual(["/"]);
  expect(routesOf(planShard(routes, timings, { index: 2, count: 2 }))).toEqual(["/a/", "/b/", "/c/"]);
});

test("a route with no recorded timing costs the mean of its check elsewhere rather than nothing", () => {
  const routes = [work("/", "axe"), work("/a/", "axe"), work("/b/", "axe"), work("/new/", "axe")];
  const timings = { "/": { axe: 1000 }, "/a/": { axe: 600 }, "/b/": { axe: 500 } };
  expect(routesOf(planShard(routes, timings, { index: 1, count: 2 }))).toEqual(["/", "/b/"]);
  expect(routesOf(planShard(routes, timings, { index: 2, count: 2 }))).toEqual(["/a/", "/new/"]);
});

test("every route lands in exactly one shard, so none is dropped or walked twice", () => {
  const routes = ["/", "/a/", "/b/", "/c/", "/d/"].map((path) => work(path, "layout", "axe"));
  const plans = [1, 2, 3].map((index) => planShard(routes, {}, { index, count: 3 }));
  const owned = plans.flatMap(routesOf);
  expect(owned.toSorted()).toEqual(["/", "/a/", "/b/", "/c/", "/d/"]);
});

test("look reads every route in exactly one shard rather than splitting its comparison across shards", () => {
  const routes = [work("/", "axe", "look"), work("/a/", "axe", "look"), work("/b/", "axe", "look")];
  const timings = { "/": { axe: 400, look: 300 }, "/a/": { axe: 400, look: 300 }, "/b/": { axe: 400, look: 300 } };
  const plans = [1, 2].map((index) => planShard(routes, timings, { index, count: 2 }));
  const looking = plans.filter(({ look }) => look);
  expect(looking).toHaveLength(1);
  for (const path of ["/", "/a/", "/b/"]) {
    expect(plans.filter((plan) => runsInShard(plan, path, "look"))).toHaveLength(1);
    expect(plans.filter((plan) => runsInShard(plan, path, "axe"))).toHaveLength(1);
  }
});

test("with no timing recorded, a route costs its visits rather than counting each route alike", () => {
  const routes = [work("/", "axe"), work("/a/", "axe"), { path: "/b/", checks: new Map([["axe", 2]]) }];
  expect(routesOf(planShard(routes, {}, { index: 1, count: 2 }))).toEqual(["/b/"]);
  expect(routesOf(planShard(routes, {}, { index: 2, count: 2 }))).toEqual(["/", "/a/"]);
});

test("more shards than work leaves a shard empty rather than walking a route twice", () => {
  const plan = planShard([work("/", "axe")], {}, { index: 2, count: 2 });
  expect(plan.routes.size).toBe(0);
  expect(plan.look).toBe(false);
});
