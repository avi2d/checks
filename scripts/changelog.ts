import { firstText, parseOutline, VERSION } from "./doc-outline.ts";
import { RELEASED } from "./doc-rules.ts";
import { CHANGE_GROUPS, type ChangeGroup } from "./doc-templates.ts";

export type Bump = {
  readonly sha: string;
  readonly version: string;
  readonly date: string;
};

export type Cut = {
  readonly version: string;
  readonly date: string;
  readonly through: string;
  readonly after: readonly string[];
};

export type Release = {
  readonly version: string;
  readonly date: string;
  readonly subjects: readonly string[];
};

type Entry = {
  readonly group: ChangeGroup;
  readonly text: string;
};

const CONVENTIONAL = /^([a-z]+)(?:\(([^()]*)\))?(!)?: (\S.*)$/;

const GROUP_OF_TYPE = new Map<string, ChangeGroup>([
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["revert", "Reverts"],
]);

// Only the subject is linted, and a squash merge's body is its branch's commit messages,
// so a breaking change is read from the subject's `!` and never from a footer.
function entryOf(subject: string): Entry | undefined {
  const [, type = "", scope = "", breaking, description = ""] = CONVENTIONAL.exec(subject) ?? [];
  const group = breaking === "!" ? "Breaking changes" : GROUP_OF_TYPE.get(type);
  if (group === undefined) return undefined;
  return { group, text: scope === "" ? description : `**${scope}:** ${description}` };
}

// A bump not newer than the release before it is a revert: it cancels every release above the version it
// returns to, except a published one.
function standing(bumps: readonly Bump[], published: ReadonlySet<string>): readonly Bump[] {
  return bumps.reduce<readonly Bump[]>((kept, bump) => {
    const before = kept.at(-1);
    if (before === undefined || Bun.semver.order(bump.version, before.version) === 1) return [...kept, bump];
    return kept.filter(({ version }) => published.has(version) || Bun.semver.order(version, bump.version) !== 1);
  }, []);
}

// The changelog records what was released: a version older than the newest it lists and absent from it
// was never published, so its commits roll into the next release.
export function cuts(
  bumps: readonly Bump[],
  recorded: ReadonlyMap<string, string>,
  published: ReadonlySet<string>,
  pending: Bump | undefined,
): readonly Cut[] {
  const newest = [...recorded.keys()].toSorted(Bun.semver.order).at(-1);
  const candidates = standing(pending === undefined ? bumps : [...bumps, pending], published);
  const released = candidates.filter(
    ({ version }, index) =>
      index === candidates.length - 1 || newest === undefined || recorded.has(version) || Bun.semver.order(version, newest) !== -1,
  );
  return released.map(({ sha, version, date }, index) => ({
    version,
    date: recorded.get(version) ?? date,
    through: sha,
    after: released.slice(0, index).map((earlier) => earlier.sha),
  }));
}

function renderRelease({ version, date, subjects }: Release): readonly string[] {
  const entries = subjects.flatMap((subject) => entryOf(subject) ?? []);
  const groups = CHANGE_GROUPS.flatMap((group) => {
    const listed = entries.filter((entry) => entry.group === group).map(({ text }) => `- ${text}`);
    return listed.length === 0 ? [] : [`### ${group}`, listed.join("\n")];
  });
  return [`## ${version}`, `Released ${date}.`, ...groups];
}

export function renderChangelog(name: string, found: readonly Release[]): string {
  const blocks = [
    "# Changelog",
    `Every release of \`${name}\`, newest first, written by the release from its conventional commits.`,
    ...found.flatMap(renderRelease),
  ];
  return `${blocks.join("\n\n")}\n`;
}

export function releaseDates(text: string): ReadonlyMap<string, string> {
  return new Map(
    parseOutline(text).sections.flatMap(({ heading, body }) => {
      const date = RELEASED.exec(firstText(body)?.text.trim() ?? "")?.[1];
      return VERSION.test(heading.title) && date !== undefined ? [[heading.title, date] as const] : [];
    }),
  );
}
