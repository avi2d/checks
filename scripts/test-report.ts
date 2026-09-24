import { Effect, Schema } from "effect";

export type Outcome = "passed" | "failed" | "skipped" | "todo";

export type TestResult = {
  readonly file: string;
  readonly name: string;
  readonly line: number;
  readonly outcome: Outcome;
};

export class ReportError extends Schema.TaggedError<ReportError>()("ReportError", {
  message: Schema.String,
}) {}

type Element = {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: Element[];
};

// bun's console prints a test inside describe blocks as "outer > inner > name".
export const NAME_SEPARATOR = " > ";

export function reporterArgs(outfile: string): readonly string[] {
  return ["--reporter=junit", `--reporter-outfile=${outfile}`];
}

const MARKUP =
  /<(?:\?[\s\S]*?\?>|!--[\s\S]*?-->|!\[CDATA\[[\s\S]*?\]\]>|(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"<]*")*)\s*(\/?)>)/g;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"<]*)"/g;
const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9A-Fa-f]+));/g;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeSuite = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String }));
const decodeCase = Schema.decodeUnknownEffect(
  Schema.Struct({ name: Schema.String, file: Schema.String, line: Schema.NumberFromString.check(Schema.isInt()) }),
);

function unescape(text: string): string {
  return text.replace(ENTITY, (_, named: string | undefined, decimal: string | undefined, hex: string | undefined) => {
    if (named !== undefined) return NAMED_ENTITIES[named] ?? "";
    return String.fromCodePoint(decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number.parseInt(decimal, 10));
  });
}

function attributesOf(source: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(ATTRIBUTE)) {
    if (name !== undefined && value !== undefined) attributes[name] = unescape(value);
  }
  return attributes;
}

const parseElements = Effect.fnUntraced(function* (xml: string): Effect.fn.Return<Element, ReportError> {
  const malformed = (reason: string) => new ReportError({ message: `the junit report is malformed: ${reason}` });
  const document: Element = { tag: "", attributes: {}, children: [] };
  const open: Element[] = [document];
  let consumed = 0;
  for (const match of xml.matchAll(MARKUP)) {
    if (xml.slice(consumed, match.index).includes("<")) return yield* malformed(`stray < before offset ${match.index}`);
    consumed = match.index + match[0].length;
    const [, closing, tag, attributes, selfClosing] = match;
    if (tag === undefined) continue;
    const parent = open.at(-1);
    if (parent === undefined) return yield* malformed(`<${tag}> after the root closed`);
    if (closing === "/") {
      if (parent.tag !== tag) return yield* malformed(`</${tag}> closes <${parent.tag}>`);
      open.pop();
      continue;
    }
    const element: Element = { tag, attributes: attributesOf(attributes ?? ""), children: [] };
    parent.children.push(element);
    if (selfClosing !== "/") open.push(element);
  }
  if (xml.slice(consumed).includes("<")) return yield* malformed("stray < after the last element");
  if (open.length !== 1) return yield* malformed(`<${open.at(-1)?.tag}> never closes`);
  const [root, ...extra] = document.children;
  if (root?.tag !== "testsuites" || extra.length > 0) return yield* malformed("the root is not one <testsuites>");
  return root;
});

function outcomeOf(testcase: Element): Outcome {
  const skipped = testcase.children.find((child) => child.tag === "skipped");
  if (skipped !== undefined) return skipped.attributes["message"] === "TODO" ? "todo" : "skipped";
  return testcase.children.some((child) => child.tag === "failure" || child.tag === "error") ? "failed" : "passed";
}

const collect = Effect.fnUntraced(function* (
  suite: Element,
  describes: readonly string[],
  results: TestResult[],
): Effect.fn.Return<void, ReportError> {
  const unreadable = (tag: string) => (cause: { readonly message: string }) =>
    new ReportError({ message: `the junit report holds a <${tag}> bun never writes: ${cause.message}` });
  for (const child of suite.children) {
    if (child.tag === "testsuite") {
      const { name } = yield* decodeSuite(child.attributes).pipe(Effect.mapError(unreadable(child.tag)));
      yield* collect(child, [...describes, name], results);
    } else if (child.tag === "testcase") {
      const { name, file, line } = yield* decodeCase(child.attributes).pipe(Effect.mapError(unreadable(child.tag)));
      results.push({ file, name: [...describes, name].join(NAME_SEPARATOR), line, outcome: outcomeOf(child) });
    }
  }
});

// A top-level <testsuite> is named for its file, so only the describe blocks nested in it join a test's name.
export const parseReport = Effect.fn("parseReport")(function* (xml: string) {
  const root = yield* parseElements(xml);
  const results: TestResult[] = [];
  for (const fileSuite of root.children) {
    if (fileSuite.tag === "testsuite") yield* collect(fileSuite, [], results);
  }
  return results;
});
