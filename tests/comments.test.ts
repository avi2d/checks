import { expect, test } from "bun:test";
import { comments, refused } from "../scripts/comments.ts";

test("code that is not a comment is not read as one", () => {
  const source = [
    'const glob = "**/*.ts";',
    'const line = `// @ts-expect-error`;',
    "const escaped = `a \\` ADR-0007 b`;",
    "const pattern = /[/*]#123/g;",
    "const divided = width / 2 / 3;",
    "const chosen = ok ? a / b : /#456/.test(x);",
  ].join("\n");
  expect(refused("src/probe.ts", source)).toEqual([]);
  expect(comments("src/probe.ts", source)).toEqual([]);
});

test("a shell `#` is a comment only where it opens a word", () => {
  const source = [
    "#!/usr/bin/env bash",
    "(( ${#WRITTEN[@]} )) && note \"wrote ${#WRITTEN[@]} of #12\"",
    "printf '%s\\n' 'a backslash \\ and #34'",
    "run --tag=a#b",
    "quiet; # the real one",
  ].join("\n");
  expect(comments("run.sh", source)).toEqual([
    { line: 1, text: "#!/usr/bin/env bash" },
    { line: 5, text: "# the real one" },
  ]);
});

test("a comment is reported with the line it sits on, whatever came before it", () => {
  const source = ['const a = "/* not here */";', "", "/* two", "   lines */", "// last", "const b = 1;"].join("\n");
  expect(comments("src/probe.ts", source)).toEqual([
    { line: 3, text: "/* two\n   lines */" },
    { line: 5, text: "// last" },
  ]);
});

test("a machine-read directive is refused wherever it sits", () => {
  expect(refused("src/probe.ts", "// @ts-expect-error the types are wrong\nconst a = 1;")).toEqual([
    "src/probe.ts:1 carries the machine-read directive `@ts-expect-error`. Fix what the tool is reporting, or stop running the tool on this file",
  ]);
  for (const directive of ["@ts-ignore", "prettier-ignore", "eslint-disable-next-line no-eval", "biome-ignore lint"]) {
    expect(refused("src/probe.ts", `// ${directive}\n`), directive).not.toEqual([]);
  }
  expect(refused("run.sh", "# eslint-disable\n"), "a directive in a hash comment").not.toEqual([]);
});

test("a record or a ticket in a comment is refused, and the pointer is named", () => {
  expect(refused("src/probe.ts", "// The bundle guard reads runtime imports (ADR-0013).")).toEqual([
    'src/probe.ts:1 points at a record or a ticket ("ADR-0013"). Drop the pointer: a record is reached by searching docs/adr, and the story of the change goes in the commit message',
  ]);
  for (const pointer of ["ADR 24", "docs/adr/0021-x.md", "see #41", "avi2d/skills#11", "RFC-2119", "/pull/68"]) {
    expect(refused("src/probe.ts", `// A line about ${pointer} and nothing else.`), pointer).not.toEqual([]);
  }
});

test("a doc block is refused and a line comment carrying a fact is not", () => {
  expect(refused("src/probe.ts", "/**\n * Loads the bodies.\n */\nexport const load = () => 1;")).toEqual([
    "src/probe.ts:1 opens a doc block. Make the code say it, or put what the types cannot hold on a line comment in the fewest words that carry it",
  ]);
  expect(refused("src/probe.ts", "// The caller holds the lock across the whole of this.\n")).toEqual([]);
});

test("a licence header is a licence term and survives every check", () => {
  const header = "/**\n * Copyright (c) 2026 the authors. See LICENSE, or github.com/x/y/pull/12.\n */\n";
  expect(refused("src/probe.ts", header)).toEqual([]);
  expect(refused("src/probe.ts", "// SPDX-License-Identifier: Apache-2.0\n")).toEqual([]);
  expect(
    refused("src/probe.ts", "// A copy of this is fine, said the author of ADR-0001.\n"),
    "a comment merely mentioning a copy is not licence content",
  ).not.toEqual([]);
});

test("a file that opens with a multi-line rationale block is refused, wherever the comment syntax puts the `#`", () => {
  const essay = [
    "# The suite, run somewhere that is not the machine that wrote it.",
    "#",
    "# Half of what this repository tests is a claim about what a clone gets, and",
    "# until this file every one of those claims only ever ran on a checkout that",
    "# already existed, which is the one place they cannot fail.",
    "",
    "name: suite",
  ].join("\n");
  expect(refused("suite.yml", essay)).toEqual([
    "suite.yml:1 opens with a 5-line rationale block. A record this long belongs in docs/adr or the repo's decision log, and the code does not point at it",
  ]);
});

test("a wrapped one-sentence comment at the top of a file is not an essay", () => {
  const short = [
    "# Pinned rather than latest: a suite that changes when nothing in",
    "# this repository changed reports on bun, not on the commit.",
    "",
    "bun-version: 1.3.13",
  ].join("\n");
  expect(refused("action.yml", short)).toEqual([]);
});

test("an opening block only counts when it opens the file, not when it merely opens a later section", () => {
  const source = [
    "name: suite",
    "",
    "# A long-enough run of lines to cross the essay threshold on its own, were",
    "# this the file's own opening rather than a block attached to a later key",
    "# that happens to need the same number of wrapped lines to say one thing.",
    "jobs: {}",
  ].join("\n");
  expect(refused("suite.yml", source)).toEqual([]);
});

test("a long opening block that is licence content is not an essay", () => {
  const header = [
    "# Copyright (c) 2026 the authors.",
    "# Licensed under the Apache License, Version 2.0.",
    "# See LICENSE for the full text and every condition it carries.",
    "",
    "name: x",
  ].join("\n");
  expect(refused("action.yml", header)).toEqual([]);
});

test("yaml and toml read `#` comments, trailing or on their own line", () => {
  expect(comments("a.yaml", "key: 1 # trailing\n# own line\n")).toEqual([
    { line: 1, text: "# trailing" },
    { line: 2, text: "# own line" },
  ]);
  expect(comments("a.toml", 'name = "x" # trailing\n')).toEqual([{ line: 1, text: "# trailing" }]);
});

test("code the checks cannot read is named rather than passed over", () => {
  expect(() => comments("src/main.pl", "# a comment")).toThrow(
    "src/main.pl is code the comment checks cannot read: add a comment syntax for .pl to scripts/comments.ts",
  );
});
