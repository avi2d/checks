// src/testing/unit-test-order.ts
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node-shared";
import { Console, Effect as Effect2, FileSystem, Layer, Path, Schema as Schema2 } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

// src/testing/test-report.ts
import { Effect, Schema } from "effect";

class ReportError extends Schema.TaggedError()("ReportError", {
  message: Schema.String
}) {
}
var NAME_SEPARATOR = " > ";
function reporterArgs(outfile) {
  return ["--reporter=junit", `--reporter-outfile=${outfile}`];
}
var MARKUP = /<(?:\?[\s\S]*?\?>|!--[\s\S]*?-->|!\[CDATA\[[\s\S]*?\]\]>|(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"<]*")*)\s*(\/?)>)/g;
var ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"<]*)"/g;
var ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9A-Fa-f]+));/g;
var NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
var decodeSuite = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String }));
var decodeCase = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String, file: Schema.String, line: Schema.NumberFromString.check(Schema.isInt()) }));
var decodeCrash = Schema.decodeUnknownEffect(Schema.Struct({ file: Schema.String }));
var decodeTimed = Schema.decodeUnknownEffect(Schema.Struct({ file: Schema.String, time: Schema.FiniteFromString }));
function unescape(text) {
  return text.replace(ENTITY, (_, named, decimal, hex) => {
    if (named !== undefined)
      return NAMED_ENTITIES[named] ?? "";
    return String.fromCodePoint(decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number.parseInt(decimal, 10));
  });
}
function attributesOf(source) {
  const attributes = {};
  for (const [, name, value] of source.matchAll(ATTRIBUTE)) {
    if (name !== undefined && value !== undefined)
      attributes[name] = unescape(value);
  }
  return attributes;
}
var malformed = (reason) => new ReportError({ message: `the junit report is malformed: ${reason}` });
var takeTag = Effect.fnUntraced(function* (open, match) {
  const [, closing, tag, attributes, selfClosing] = match;
  if (tag === undefined)
    return;
  const parent = open.at(-1);
  if (parent === undefined)
    return yield* malformed(`<${tag}> after the root closed`);
  if (closing === "/") {
    if (parent.tag !== tag)
      return yield* malformed(`</${tag}> closes <${parent.tag}>`);
    open.pop();
    return;
  }
  const element = { tag, attributes: attributesOf(attributes ?? ""), children: [] };
  parent.children.push(element);
  if (selfClosing !== "/")
    open.push(element);
});
var parseElements = Effect.fnUntraced(function* (xml) {
  const document = { tag: "", attributes: {}, children: [] };
  const open = [document];
  let consumed = 0;
  for (const match of xml.matchAll(MARKUP)) {
    if (xml.slice(consumed, match.index).includes("<"))
      return yield* malformed(`stray < before offset ${match.index}`);
    consumed = match.index + match[0].length;
    yield* takeTag(open, match);
  }
  if (xml.slice(consumed).includes("<"))
    return yield* malformed("stray < after the last element");
  if (open.length !== 1)
    return yield* malformed(`<${open.at(-1)?.tag}> never closes`);
  const [root, ...extra] = document.children;
  if (root?.tag !== "testsuites" || extra.length > 0)
    return yield* malformed("the root is not one <testsuites>");
  return root;
});
function outcomeOf(testcase) {
  const skipped = testcase.children.find((child) => child.tag === "skipped");
  if (skipped !== undefined)
    return skipped.attributes["message"] === "TODO" ? "todo" : "skipped";
  return testcase.children.some((child) => child.tag === "failure" || child.tag === "error") ? "failed" : "passed";
}
function crashed(testcase) {
  return testcase.attributes["line"] === undefined && outcomeOf(testcase) === "failed";
}
var collect = Effect.fnUntraced(function* (suite, describes, report) {
  const unreadable = (tag) => (cause) => new ReportError({ message: `the junit report holds a <${tag}> bun never writes: ${cause.message}` });
  for (const child of suite.children) {
    if (child.tag === "testsuite") {
      const { name } = yield* decodeSuite(child.attributes).pipe(Effect.mapError(unreadable(child.tag)));
      yield* collect(child, [...describes, name], report);
    } else if (child.tag === "testcase" && crashed(child)) {
      const { file } = yield* decodeCrash(child.attributes).pipe(Effect.mapError(unreadable(child.tag)));
      report.crashedFiles.push(file);
    } else if (child.tag === "testcase") {
      const { name, file, line } = yield* decodeCase(child.attributes).pipe(Effect.mapError(unreadable(child.tag)));
      report.results.push({ file, name: [...describes, name].join(NAME_SEPARATOR), line, outcome: outcomeOf(child) });
    }
  }
});
var parseReport = Effect.fn("parseReport")(function* (xml) {
  const root = yield* parseElements(xml);
  const results = [];
  const crashedFiles = [];
  for (const fileSuite of root.children) {
    if (fileSuite.tag === "testsuite")
      yield* collect(fileSuite, [], { results, crashedFiles });
  }
  return { results, crashedFiles };
});
var fileSeconds = Effect.fn("fileSeconds")(function* (xml) {
  const root = yield* parseElements(xml);
  const seconds = new Map;
  for (const fileSuite of root.children) {
    if (fileSuite.tag !== "testsuite")
      continue;
    const { file, time } = yield* decodeTimed(fileSuite.attributes).pipe(Effect.mapError((cause) => new ReportError({ message: `the junit report holds a <testsuite> with no file or time: ${cause.message}` })));
    seconds.set(file, time);
  }
  return seconds;
});

// src/testing/unit-test-order.ts
class OrderError extends Schema2.TaggedError()("OrderError", {
  message: Schema2.String
}) {
}
var NON_RUNS = ["--help", "-h", "--version"];
function ordersTests(command, args) {
  return command === "run" && !args.some((arg) => NON_RUNS.includes(arg) || arg === "--ignoreStatic");
}
function fastestFirst(seconds) {
  return [...seconds].toSorted(([file, time], [other, otherTime]) => time - otherTime || file.localeCompare(other)).map(([file]) => file);
}
function inRunOrder(listed, timed) {
  const known = new Set(listed);
  const first = new Set(timed.filter((file) => known.has(file)));
  const rest = listed.filter((file) => !first.has(file));
  return [...[...first, ...rest].map((file) => `./${file}`), ...listed];
}
var timedFiles = Effect2.fn("timedFiles")(function* (listed) {
  const fs = yield* FileSystem.FileSystem;
  const outfile = (yield* Path.Path).join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-order-" }), "junit.xml");
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = ["test", ...listed.map((file) => `./${file}`), ...reporterArgs(outfile)];
  const exitCode = yield* spawner.exitCode(ChildProcess.make("bun", args, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));
  if (exitCode !== ChildProcessSpawner.ExitCode(0))
    return yield* new OrderError({ message: `bun test exited ${exitCode} while timing the unit tests` });
  return fastestFirst(yield* fileSeconds(yield* fs.readFileString(outfile)));
}, Effect2.scoped);
var NodeServices = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));
var runOrder = (listed) => Effect2.runPromise(timedFiles(listed).pipe(Effect2.map((timed) => inRunOrder(listed, timed)), Effect2.catch((failure) => Console.error(`checks: ${failure.message}, so each static mutant runs the unit tests in Bun's default directory order`).pipe(Effect2.as(listed))), Effect2.provide(NodeServices)));
export {
  fastestFirst,
  inRunOrder,
  ordersTests,
  runOrder
};
