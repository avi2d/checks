import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { Schema } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const PLUGIN = join(CHECKOUT, "dist", "index.js");
const OXLINT = join(CHECKOUT, "node_modules", ".bin", "oxlint");

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function lint(files: Readonly<Record<string, string>>, max: number): Promise<{ exitCode: number; text: string }> {
  dir = await mkdtemp(join(tmpdir(), "checks-cognitive-"));
  await writeFile(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      plugins: [],
      categories: { correctness: "off" },
      jsPlugins: [PLUGIN],
      rules: { "effect-channel/cognitive-complexity": ["error", { max }] },
    }),
  );
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  const result = await $`${OXLINT} -c .oxlintrc.json -f json .`.cwd(dir).nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() };
}

const Diagnostic = Schema.Struct({
  message: Schema.String,
  labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) })),
});
const Report = Schema.fromJsonString(Schema.Struct({ diagnostics: Schema.Array(Diagnostic) }));

function diagnostics(text: string): { line: number; message: string }[] {
  const { diagnostics: found } = Schema.decodeSync(Report)(text);
  return found
    .filter((diagnostic) => diagnostic.message.includes("cognitive complexity"))
    .map((diagnostic) => ({ line: diagnostic.labels[0]?.span.line ?? 0, message: diagnostic.message }))
    .toSorted((a, b) => (a.message < b.message ? -1 : 1));
}

const GET_WORDS = `export function getWords(number) {
  switch (number) {
    case 1:
      return "one";
    case 2:
      return "a couple";
    case 3:
      return "a few";
    default:
      return "lots";
  }
}
`;

const SUM_OF_PRIMES = `export function sumOfPrimes(max) {
  let total = 0;
  OUT: for (let i = 1; i <= max; ++i) {
    for (let j = 2; j < i; ++j) {
      if (i % j === 0) {
        continue OUT;
      }
    }
    total += i;
  }
  return total;
}
`;

const NESTED = `export function myMethod() {
  try {
    if (condition1) {
      for (let i = 0; i < 10; i++) {
        while (condition2) {
          work();
        }
      }
    }
  } catch (e) {
    if (condition2) {
      recover();
    }
  }
}

export function myMethod2() {
  const run = () => {
    if (condition1) {
      work();
    }
  };
  return run;
}
`;

const TO_REGEXP = `const SPECIAL_CHARS = "(){}[]";
function isSlash(ch) {
  return ch === "/" || ch === "\\\\";
}
export function toRegexp(antPattern, directorySeparator) {
  const escapedDirectorySeparator = "\\\\" + directorySeparator;
  let sb = "^";
  let i = antPattern.startsWith("/") || antPattern.startsWith("\\\\") ? 1 : 0;
  while (i < antPattern.length) {
    const ch = antPattern.charAt(i);
    if (SPECIAL_CHARS.indexOf(ch) !== -1) {
      sb += "\\\\" + ch;
    } else if (ch === "*") {
      if (i + 1 < antPattern.length && antPattern.charAt(i + 1) === "*") {
        if (i + 2 < antPattern.length && isSlash(antPattern.charAt(i + 2))) {
          sb += "(?:.*)";
          i += 2;
        } else {
          sb += ".*";
          i += 1;
        }
      } else {
        sb += "[^]*?";
      }
    } else if (ch === "?") {
      sb += "[^]";
    } else if (isSlash(ch)) {
      sb += escapedDirectorySeparator;
    } else {
      sb += ch;
    }
    i++;
  }
  sb += "$";
  return sb;
}
`;

const SAVE = `export function save(options, callback) {
  const self = this;
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  options || (options = {});
  self._validate(self.toJSON(), function (err) {
    if (err) {
      callback && callback.call(null, err);
      return;
    }
    self.sync(self.isNew() ? "create" : "update", options, function (err2, response) {
      const facade = { options: options, response: response };
      let parsed;
      if (err2) {
        facade.error = err2;
        facade.src = "save";
        self.fire("error", facade);
      } else {
        if (!self._saveEvent) {
          self._saveEvent = self.publish("save", { preventable: false });
        }
        if (response) {
          parsed = facade.parsed = self._parse(response);
          self.setAttrs(parsed, options);
        }
        self.changed = {};
        self.fire("save", facade);
      }
      callback && callback.apply(null, arguments);
    });
  });
  return self;
}
`;

const JAVA_LIKE = `export function javaLike(classType, symbols) {
  if (classType.isUnknown()) {
    return "unknown";
  }
  let unknownFound = false;
  for (const overrideSymbol of symbols) {
    if (overrideSymbol.isKind("MTH") && !overrideSymbol.isStatic()) {
      if (canOverride(overrideSymbol)) {
        const overriding = checkParams(overrideSymbol, classType);
        if (overriding === null) {
          if (!unknownFound) {
            unknownFound = true;
          }
        } else if (overriding) {
          return overrideSymbol;
        }
      }
    }
  }
  if (unknownFound) {
    return "unknown";
  }
  return null;
}
`;

const MIXED_OPERATORS = `export function mixed(a, b, c, d, e, f) {
  if (a && b && c || d || e && f) {
    return 1;
  }
  return 0;
}
export function negated(a, b, c) {
  if (a && !(b && c)) {
    return 1;
  }
  return 0;
}
`;

const RETRY_LOOP = `export function retryLoop(store, txn) {
  while (true) {
    try {
      poll(store);
      break;
    } catch (error) {
      try {
        const backoff = waitTime(error);
        if (backoff > 0 && txn.active) {
          sleep(backoff);
        }
      } catch (fatal) {
        throw fatal;
      }
    }
  }
}
`;

test("the paper's worked examples score what the paper prints, with each nested function scored apart", async () => {
  const { text } = await lint(
    {
      "get-words.js": GET_WORDS,
      "sum-of-primes.js": SUM_OF_PRIMES,
      "nested.js": NESTED,
      "to-regexp.js": TO_REGEXP,
      "save.js": SAVE,
      "java-like.js": JAVA_LIKE,
      "mixed.js": MIXED_OPERATORS,
      "retry.js": RETRY_LOOP,
    },
    1,
  );
  const found = diagnostics(text);
  expect(found).toEqual([
    { line: 8, message: "function `anonymous` has a cognitive complexity of 3. Maximum allowed is 1." },
    { line: 13, message: "function `anonymous` has a cognitive complexity of 7. Maximum allowed is 1." },
    { line: 1, message: "function `javaLike` has a cognitive complexity of 19. Maximum allowed is 1." },
    { line: 1, message: "function `mixed` has a cognitive complexity of 4. Maximum allowed is 1." },
    { line: 1, message: "function `myMethod` has a cognitive complexity of 9. Maximum allowed is 1." },
    { line: 7, message: "function `negated` has a cognitive complexity of 3. Maximum allowed is 1." },
    { line: 1, message: "function `retryLoop` has a cognitive complexity of 10. Maximum allowed is 1." },
    { line: 1, message: "function `save` has a cognitive complexity of 2. Maximum allowed is 1." },
    { line: 1, message: "function `sumOfPrimes` has a cognitive complexity of 7. Maximum allowed is 1." },
    { line: 5, message: "function `toRegexp` has a cognitive complexity of 20. Maximum allowed is 1." },
  ]);
}, 60_000);

const NAMING = `export const result = items.map((item) => {
  if (item.a && item.b) {
    return 1;
  }
  return 0;
});
export const handlers = {
  run: () => {
    if (ready && armed) {
      fire();
    }
  },
};
export const walk = (node) => {
  node.kids.forEach(
    (kid) => (kid.leaf ? 0 : walk(kid)),
  );
};
export class Form {
  handleSubmit = () => {
    if (this.ready && this.armed) {
      this.handleSubmit();
    }
  };
}
export const table = {
  [kind]: () => {
    if (ready && armed || live) {
      kind();
    }
  },
};
export const api = {
  parse(text) {
    if (text) {
      return parse(text, options);
    }
  },
};
export function visit(node) {
  if (node) {
    this.visit(node.next);
  }
}
`;

test("a function takes its name only from its direct parent, and recursion only through its own binding", async () => {
  const { text } = await lint({ "naming.js": NAMING }, 1);
  expect(diagnostics(text)).toEqual([
    { line: 1, message: "function `anonymous` has a cognitive complexity of 2. Maximum allowed is 1." },
    { line: 27, message: "function `anonymous` has a cognitive complexity of 3. Maximum allowed is 1." },
    { line: 20, message: "function `handleSubmit` has a cognitive complexity of 3. Maximum allowed is 1." },
    { line: 8, message: "function `run` has a cognitive complexity of 2. Maximum allowed is 1." },
  ]);
}, 60_000);

const DESCRIBE = `describe("totals", () => {
${Array.from({ length: 8 }, (_, index) => `  test("case ${index}", () => {\n    if (total(${index}) > 0) {\n      expect(total(${index})).toBe(${index});\n    }\n  });\n`).join("")}});
`;

test("a describe callback holding eight flat tests passes, since each test scores apart", async () => {
  const { exitCode, text } = await lint({ "totals.test.js": DESCRIBE }, 15);
  expect(diagnostics(text)).toEqual([]);
  expect(exitCode).toBe(0);
}, 60_000);

test("flat guards, switches and shorthand pass while a tangled nest fails", async () => {
  const guards = Array.from({ length: 15 }, (_, index) => `  if (x === ${index}) return ${index};\n`).join("");
  const green = await lint({ "guards.js": `export function guards(x) {\n${guards}  return -1;\n}\n` }, 15);
  expect(diagnostics(green.text)).toEqual([]);
  expect(green.exitCode).toBe(0);

  const red = await lint({ "settle.js": TANGLED }, 15);
  expect(diagnostics(red.text)).toEqual([
    { line: 1, message: "function `settle` has a cognitive complexity of 16. Maximum allowed is 15." },
  ]);
  expect(red.exitCode).not.toBe(0);
}, 60_000);

const TANGLED = `export function settle(order) {
  if (order !== null) {
    if (order.paid || order.credit) {
      for (const line of order.lines) {
        if (line.taxable && line.shipped || line.gift) {
          charge(line);
        } else if (line.refunded || line.voided) {
          refund(line);
        } else {
          skip(line);
        }
      }
      return "settled";
    }
    return "unpaid";
  }
  return "missing";
}
`;

test("red on a tangled function, green once it is flattened", async () => {
  const red = await lint({ "settle.js": TANGLED }, 15);
  expect(red.exitCode).not.toBe(0);
  expect(diagnostics(red.text)).toEqual([
    { line: 1, message: "function `settle` has a cognitive complexity of 16. Maximum allowed is 15." },
  ]);

  const flattened = `export function settle(order) {
  if (order === null) return "missing";
  if (!order.paid) return "unpaid";
  for (const line of order.lines) {
    if (line.taxable) charge(line);
  }
  return "settled";
}
`;
  const green = await lint({ "settle.js": flattened }, 15);
  expect(diagnostics(green.text)).toEqual([]);
  expect(green.exitCode).toBe(0);
}, 60_000);
