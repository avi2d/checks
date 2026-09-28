import { Schema } from "effect";

export const LOCKFILE = "bun.lock";
export const ACKNOWLEDGEMENTS = "advisory-acks.json";
const ACKNOWLEDGEMENT_DAYS = 30;
const DAY_MS = 86_400_000;
const UNRATED = "unrated";

// Date.parse rolls a day past the month's end, such as 2026-02-30, into the next month, so the round trip catches it.
function isCalendarDay(day: string): boolean {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(day);
}

const Day = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { message: "is not a day such as 2026-10-20" }),
  Schema.makeFilter((day: string) => isCalendarDay(day) || "is not a day of the calendar"),
);

const Acknowledgement = Schema.Struct({
  package: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  until: Day,
  reason: Schema.NonEmptyString,
});

export type Acknowledgement = typeof Acknowledgement.Type;

export const decodeAcknowledgements = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Acknowledgement)));

const Vulnerability = Schema.Struct({
  id: Schema.String,
  aliases: Schema.optionalKey(Schema.Array(Schema.String)),
  summary: Schema.optionalKey(Schema.String),
  database_specific: Schema.optionalKey(Schema.Struct({ severity: Schema.optionalKey(Schema.String) })),
});

const OsvReport = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      source: Schema.Struct({ path: Schema.String }),
      packages: Schema.Array(
        Schema.Struct({
          package: Schema.Struct({ name: Schema.String, version: Schema.String }),
          vulnerabilities: Schema.optionalKey(Schema.Array(Vulnerability)),
        }),
      ),
    }),
  ),
});

type OsvReport = typeof OsvReport.Type;

export const decodeOsvReport = Schema.decodeUnknownEffect(Schema.fromJsonString(OsvReport));

export type Finding = {
  readonly name: string;
  readonly version: string;
  readonly id: string;
  readonly ids: readonly string[];
  readonly severity: string;
  readonly summary: string;
};

// OSV-Scanner leaves a lockfile with no advisory out of its results, so an absent lockfile reads as clean.
export function findingsIn(scanned: OsvReport, lockfile: (path: string) => boolean): readonly Finding[] {
  return scanned.results
    .filter(({ source }) => lockfile(source.path))
    .flatMap(({ packages }) => packages)
    .flatMap(({ package: { name, version }, vulnerabilities = [] }) =>
      vulnerabilities.map((vulnerability) => ({
        name,
        version,
        id: vulnerability.id,
        ids: [vulnerability.id, ...(vulnerability.aliases ?? [])],
        severity: vulnerability.database_specific?.severity?.toLowerCase() ?? UNRATED,
        summary: vulnerability.summary ?? "",
      })),
    );
}

function keysOf(findings: readonly Finding[]): ReadonlySet<string> {
  return new Set(findings.flatMap(({ name, ids }) => ids.map((id) => `${name} ${id}`)));
}

// Keyed by name and id rather than version, so moving between two affected versions adds nothing.
export function introducedBy(base: readonly Finding[], head: readonly Finding[]): readonly Finding[] {
  const known = keysOf(base);
  return head.filter(({ name, ids }) => !ids.some((id) => known.has(`${name} ${id}`)));
}

type AcknowledgementProblem =
  | { readonly kind: "expired"; readonly acknowledgement: Acknowledgement }
  | { readonly kind: "too-far"; readonly acknowledgement: Acknowledgement; readonly latest: string }
  | { readonly kind: "unmatched"; readonly acknowledgement: Acknowledgement };

export type AcknowledgementClock = {
  readonly live: readonly Acknowledgement[];
  readonly problems: readonly AcknowledgementProblem[];
};

type Scope = { readonly kind: "range" } | { readonly kind: "head" };

export type Dates = { readonly head: number; readonly now: number };

// A range reads the head's date so a commit gets one verdict, and --all reads today so an entry expires in an idle repository.
function measuredFrom(scope: Scope, { head, now }: Dates): number {
  return scope.kind === "head" ? now : head;
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, "YYYY-MM-DD".length);
}

export function clockOf(acknowledgements: readonly Acknowledgement[], scope: Scope, dates: Dates): AcknowledgementClock {
  const from = measuredFrom(scope, dates);
  const limit = from + ACKNOWLEDGEMENT_DAYS * DAY_MS;
  const live: Acknowledgement[] = [];
  const problems: AcknowledgementProblem[] = [];
  for (const acknowledgement of acknowledgements) {
    const until = Date.parse(`${acknowledgement.until}T00:00:00Z`);
    if (until <= from) problems.push({ kind: "expired", acknowledgement });
    else if (until > limit) problems.push({ kind: "too-far", acknowledgement, latest: dayOf(limit) });
    else live.push(acknowledgement);
  }
  return { live, problems };
}

function covers(acknowledgement: Acknowledgement, finding: Finding): boolean {
  return acknowledgement.package === finding.name && finding.ids.includes(acknowledgement.id);
}

type Judged = {
  readonly failing: readonly Finding[];
  readonly acknowledged: number;
  readonly predating: number;
  readonly problems: readonly AcknowledgementProblem[];
};

export function judge(base: readonly Finding[], head: readonly Finding[], clock: AcknowledgementClock): Judged {
  const added = introducedBy(base, head);
  const failing = added.filter((finding) => !clock.live.some((acknowledgement) => covers(acknowledgement, finding)));
  const unmatched = clock.live
    .filter((acknowledgement) => !head.some((finding) => covers(acknowledgement, finding)))
    .map((acknowledgement): AcknowledgementProblem => ({ kind: "unmatched", acknowledgement }));
  return {
    failing,
    acknowledged: added.length - failing.length,
    predating: head.length - added.length,
    problems: [...clock.problems, ...unmatched],
  };
}

export type Outcome =
  | { readonly kind: "unchanged"; readonly problems: readonly AcknowledgementProblem[] }
  | { readonly kind: "scanned"; readonly scope: Scope; readonly judged: Judged };

export function passes(outcome: Outcome): boolean {
  if (outcome.kind === "unchanged") return outcome.problems.length === 0;
  return outcome.judged.failing.length === 0 && outcome.judged.problems.length === 0;
}

function problemLine(problem: AcknowledgementProblem): string {
  const { package: name, id, until } = problem.acknowledgement;
  switch (problem.kind) {
    case "expired":
      return `  ${name} ${id} expired on ${until}; upgrade the package, or renew the entry with a new reason`;
    case "too-far":
      return `  ${name} ${id} runs until ${until}, more than ${ACKNOWLEDGEMENT_DAYS} days out; name a day no later than ${problem.latest}`;
    case "unmatched":
      return `  ${name} ${id} matches nothing in ${LOCKFILE} at the head; delete it`;
  }
}

function problemLines(problems: readonly AcknowledgementProblem[]): readonly string[] {
  if (problems.length === 0) return [];
  return [`advisories: ${problems.length} acknowledgement(s) in ${ACKNOWLEDGEMENTS} do not hold:`, ...problems.map(problemLine)];
}

function findingLine({ name, version, id, severity, summary }: Finding): string {
  return `  ${name}@${version} ${id} ${severity}${summary === "" ? "" : `: ${summary}`}`;
}

function scannedLines(scope: Scope, { failing, acknowledged, predating }: Judged): readonly string[] {
  const fix = `upgrade each package, or acknowledge its advisory in ${ACKNOWLEDGEMENTS}:`;
  if (scope.kind === "head") {
    if (failing.length === 0) return [`advisories: ${LOCKFILE} at the head holds no unacknowledged advisory (${acknowledged} acknowledged)`];
    return [`advisories: ${LOCKFILE} at the head holds ${failing.length} unacknowledged advisory(ies); ${fix}`, ...failing.map(findingLine)];
  }
  const counts = `${predating} at the head predate the range, ${acknowledged} acknowledged`;
  if (failing.length === 0) return [`advisories: the range adds no advisory to ${LOCKFILE} (${counts})`];
  return [`advisories: the range adds ${failing.length} advisory(ies) to ${LOCKFILE} (${counts}); ${fix}`, ...failing.map(findingLine)];
}

export function report(outcome: Outcome): string {
  if (outcome.kind === "unchanged") {
    return [`advisories: ${LOCKFILE} is unchanged in the range, so nothing was scanned`, ...problemLines(outcome.problems)].join("\n");
  }
  return [...scannedLines(outcome.scope, outcome.judged), ...problemLines(outcome.judged.problems)].join("\n");
}

// The job summary is Markdown, where an indented line would merge into the paragraph above it.
export function summaryOf(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith("  ") ? `- ${line.trim()}` : line))
    .join("\n");
}
