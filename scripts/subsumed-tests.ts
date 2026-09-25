#!/usr/bin/env bun
import { Console, Effect, FileSystem } from "effect";
import { runMain, Usage } from "./main.ts";
import { type KillRun, parseKillRun, ReportError } from "./mutation-compare.ts";

export type KillSets = ReadonlyMap<string, ReadonlySet<string>>;

export type Subsumed = {
  readonly test: string;
  readonly kills: number;
  readonly subsumedBy: string;
  readonly subsumerKills: number;
};

export type IdenticalGroup = {
  readonly tests: readonly string[];
  readonly kills: number;
};

export type Cover = {
  readonly members: readonly string[];
  readonly tests: number;
  readonly kills: number;
};

export type Report = {
  readonly files: readonly string[];
  readonly subsumed: readonly Subsumed[];
  readonly identical: readonly IdenticalGroup[];
  readonly cover: Cover;
};

export type Options = {
  readonly reportPath: string;
};

const USAGE = "usage: subsumed-tests.ts <mutation-report>";

export function killSetsOf(run: KillRun): KillSets {
  const kills = new Map<string, Set<string>>();
  for (const file of run.testFiles.values()) for (const test of file.tests) kills.set(test.id, new Set<string>());
  for (const [path, file] of run.files) {
    file.mutants.forEach((mutant, index) => {
      for (const test of mutant.killedBy ?? []) {
        let set = kills.get(test);
        if (set === undefined) {
          set = new Set<string>();
          kills.set(test, set);
        }
        set.add(`${path}#${index}`);
      }
    });
  }
  return kills;
}

function isSuperset(candidate: ReadonlySet<string>, other: ReadonlySet<string>): boolean {
  if (candidate.size <= other.size) return false;
  for (const kill of other) if (!candidate.has(kill)) return false;
  return true;
}

function subsumerOf(test: string, kills: ReadonlySet<string>, sets: KillSets): { readonly name: string; readonly size: number } | undefined {
  let best: { readonly name: string; readonly size: number } | undefined;
  for (const [other, otherKills] of sets) {
    if (other !== test && isSuperset(otherKills, kills) && (best === undefined || otherKills.size > best.size || (otherKills.size === best.size && other < best.name))) best = { name: other, size: otherKills.size };
  }
  return best;
}

export function findSubsumed(sets: KillSets): readonly Subsumed[] {
  const subsumed: Subsumed[] = [];
  for (const [test, kills] of sets) {
    if (kills.size === 0) continue;
    const subsumer = subsumerOf(test, kills, sets);
    if (subsumer !== undefined) subsumed.push({ test, kills: kills.size, subsumedBy: subsumer.name, subsumerKills: subsumer.size });
  }
  return subsumed;
}

export function findIdentical(sets: KillSets): readonly IdenticalGroup[] {
  const groups = new Map<string, string[]>();
  for (const [test, kills] of sets) {
    if (kills.size === 0) continue;
    const key = [...kills].toSorted().join("\n");
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [test]);
    else group.push(test);
  }
  return [...groups.values()].filter((tests) => tests.length > 1).map((tests) => ({ tests, kills: sets.get(tests[0] ?? "")?.size ?? 0 }));
}

export function greedyCover(sets: KillSets): Cover {
  const uncovered = new Set<string>();
  for (const kills of sets.values()) for (const kill of kills) uncovered.add(kill);
  const total = uncovered.size;
  const members: string[] = [];
  const names = [...sets.keys()].toSorted();
  while (uncovered.size > 0) {
    let best: string | undefined;
    let bestCount = 0;
    for (const name of names) {
      const kills = sets.get(name);
      if (kills === undefined || members.includes(name)) continue;
      let count = 0;
      for (const kill of kills) if (uncovered.has(kill)) count++;
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    if (best === undefined) break;
    members.push(best);
    for (const kill of sets.get(best) ?? []) uncovered.delete(kill);
  }
  return { members, tests: sets.size, kills: total };
}

function testNames(run: KillRun): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const [path, file] of run.testFiles) for (const test of file.tests) names.set(test.id, qualified(path, test.name));
  return names;
}

// The bun runner writes names that already open with their file.
function qualified(path: string, name: string): string {
  return path === "" || name.startsWith(`${path} > `) ? name : `${path} > ${name}`;
}

const byName = (a: string, b: string) => (a < b ? -1 : 1);

export function analyze(run: KillRun): Report {
  const sets = killSetsOf(run);
  const names = testNames(run);
  const name = (id: string) => names.get(id) ?? id;
  const cover = greedyCover(sets);
  return {
    files: [...run.files.keys()].toSorted(),
    subsumed: findSubsumed(sets)
      .map((one) => ({ ...one, test: name(one.test), subsumedBy: name(one.subsumedBy) }))
      .toSorted((a, b) => byName(a.test, b.test)),
    identical: findIdentical(sets)
      .map((group) => ({ ...group, tests: group.tests.map(name).toSorted(byName) }))
      .toSorted((a, b) => byName(a.tests[0] ?? "", b.tests[0] ?? "")),
    cover: { ...cover, members: cover.members.map(name) },
  };
}

function describeTest(test: string, kills: number): string {
  return `${JSON.stringify(test)} (${kills} kill${kills === 1 ? "" : "s"})`;
}

export function formatReport(report: Report): string {
  const lines = [`subsumed-tests: ${report.files.length} file(s) mutated`];
  for (const file of report.files) lines.push(`  mutated ${file}`);
  lines.push(`subsumed tests (${report.subsumed.length}):`);
  for (const one of report.subsumed) lines.push(`  ${describeTest(one.test, one.kills)} subsumed by ${describeTest(one.subsumedBy, one.subsumerKills)}`);
  lines.push(`identical kill sets (${report.identical.length} group(s)):`);
  for (const group of report.identical) lines.push(`  ${group.tests.map((test) => describeTest(test, group.kills)).join(" = ")}`);
  lines.push(`greedy cover: ${report.cover.members.length} of ${report.cover.tests} test(s) keep all ${report.cover.kills} kill(s)`);
  for (const member of report.cover.members) lines.push(`  cover ${JSON.stringify(member)}`);
  return lines.join("\n");
}

export const bailWarning = (source: string, run: KillRun): Effect.Effect<string | undefined, ReportError> => {
  if (run.bail === "on")
    return Effect.fail(
      new ReportError({
        message: `${source} was built with bail on, since its config.disableBail is not true, so each mutant records only its first killer: rerun Stryker with \`bunx stryker run --disableBail\` and pass the report it writes`,
      }),
    );
  if (run.bail === "unrecorded") return Effect.succeed(`${source} records no config, so nothing shows whether bail was off: build it with \`bunx stryker run --disableBail\``);
  return Effect.succeed(undefined);
};

export const parseArgs = Effect.fnUntraced(function* (argv: readonly string[]): Effect.fn.Return<Options, Usage> {
  const [reportPath, ...extra] = argv.filter((arg) => !arg.startsWith("--"));
  const flag = argv.find((arg) => arg.startsWith("--"));
  if (flag !== undefined) return yield* new Usage({ message: `${USAGE}: unknown flag ${flag}` });
  if (reportPath === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });
  return { reportPath };
});

const load = Effect.fn("load")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(path).pipe(Effect.mapError(() => new ReportError({ message: `cannot read ${path}` })));
  const run = yield* parseKillRun(path, text);
  const warning = yield* bailWarning(path, run);
  if (warning !== undefined) yield* Console.error(`subsumed-tests: warning: ${warning}`);
  return run;
});

const report = Effect.gen(function* () {
  const options = yield* parseArgs(process.argv.slice(2));
  yield* Console.log(formatReport(analyze(yield* load(options.reportPath))));
  return true;
});

if (import.meta.main) runMain("subsumed-tests", report);
