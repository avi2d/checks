import { Schema } from "effect";
import { Quality, type Feature } from "./quality-file.ts";

export type ForbiddenRule = {
  readonly name: string;
  readonly severity: "error";
  readonly comment: string;
  readonly from: { readonly pathNot: readonly string[] };
  readonly to: { readonly path: string; readonly pathNot: readonly string[] };
};

const TESTS = "^tests/";

function escaped(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function globPattern(glob: string): string {
  const segments = glob.split("/");
  const body = segments.map((segment, index) => {
    if (segment === "**") return "(?:[^/]+/)*";
    const pattern = segment.split("*").map(escaped).join("[^/]*");
    return index === segments.length - 1 ? pattern : `${pattern}/`;
  });
  return `^${body.join("")}$`;
}

function rulesFor(features: readonly Feature[]): readonly ForbiddenRule[] {
  return features.map(({ name, root, entries, allowFrom = [] }) => ({
    name: `feature-${name}-entries`,
    severity: "error",
    comment: `Outside ${root}/, ${name} is imported through ${entries.join(", ")}. Import one of those, or list the importer in the feature's allowFrom in quality.json.`,
    from: { pathNot: [`^${escaped(root)}/`, TESTS, ...allowFrom.map(globPattern)] },
    to: { path: `^${escaped(root)}/`, pathNot: entries.map((entry) => `^${escaped(entry)}$`) },
  }));
}

// dependency-cruiser loads its config synchronously, so the declaration decodes synchronously here.
const decode = Schema.decodeUnknownSync(Quality);

export function featureRules(quality: unknown): readonly ForbiddenRule[] {
  return rulesFor(decode(quality, { onExcessProperty: "error" }).features ?? []);
}
