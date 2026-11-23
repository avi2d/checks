import type { BrowserTimings } from "../../core/settings.ts";

export type Shard = { readonly index: number; readonly count: number };

const SHARD = /^--shard=([1-9]\d*)\/([1-9]\d*)$/;

export function parseShard(arg: string): Shard | undefined {
  const match = SHARD.exec(arg);
  if (match === null) return undefined;
  const index = Number(match[1]);
  const count = Number(match[2]);
  return index <= count ? { index, count } : undefined;
}

const LOOK = "look";

// Each check maps to the count of visits that run it at the route.
export type RouteWork = { readonly path: string; readonly checks: ReadonlyMap<string, number> };

export type ShardPlan = {
  readonly routes: ReadonlySet<string>;
  // Look compares texts across routes, so one shard reads it at every route rather than each reading its own.
  readonly look: boolean;
};

type Item = { readonly routes: readonly string[]; readonly look: boolean; readonly cost: number };

function mean(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, one) => sum + one, 0) / values.length;
}

// A timing sums a check over the route's visits, so with no timing at all a visit counts one.
function costOf(timings: BrowserTimings): (path: string, check: string, visits: number) => number {
  const recorded = Object.values(timings);
  const overall = mean(recorded.flatMap((checks) => Object.values(checks)));
  return (path, check, visits) => timings[path]?.[check] ?? mean(recorded.flatMap((checks) => checks[check] ?? [])) ?? overall ?? visits;
}

function itemsOf(work: readonly RouteWork[], timings: BrowserTimings): readonly Item[] {
  const cost = costOf(timings);
  const routes = work.map(({ path, checks }) => ({
    routes: [path],
    look: false,
    cost: [...checks].filter(([check]) => check !== LOOK).reduce((sum, [check, visits]) => sum + cost(path, check, visits), 0),
  }));
  const looked = work.flatMap(({ path, checks }) => {
    const visits = checks.get(LOOK);
    return visits === undefined ? [] : [cost(path, LOOK, visits)];
  });
  return looked.length === 0 ? routes : [...routes, { routes: [], look: true, cost: looked.reduce((sum, one) => sum + one, 0) }];
}

export function planShard(work: readonly RouteWork[], timings: BrowserTimings, { index, count }: Shard): ShardPlan {
  const loads = Array.from({ length: count }, () => ({ cost: 0, routes: new Set<string>(), look: false }));
  const items = itemsOf(work, timings).map((item, order) => ({ ...item, order })).sort((a, b) => b.cost - a.cost || a.order - b.order);
  for (const item of items) {
    const lightest = loads.reduce((best, load) => (load.cost < best.cost ? load : best));
    lightest.cost += item.cost;
    for (const path of item.routes) lightest.routes.add(path);
    lightest.look ||= item.look;
  }
  const { routes, look } = loads[index - 1] ?? { routes: new Set<string>(), look: false };
  return { routes, look };
}

export function runsInShard(plan: ShardPlan, path: string, check: string): boolean {
  return check === LOOK ? plan.look : plan.routes.has(path);
}
