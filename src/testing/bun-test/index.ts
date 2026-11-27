import type { CreateRule, ESTree, Plugin, Scope, SourceCode, Variable } from "@oxlint/plugins";

type TestFunction = ESTree.ArrowFunctionExpression | ESTree.Function;
type Invocation = ESTree.CallExpression | ESTree.NewExpression;
type CallsByFunction = ReadonlyMap<TestFunction, readonly Invocation[]>;

const TEST_METHODS: ReadonlySet<string> = new Set(["only", "concurrent", "serial", "failing"]);
const CURRIED_METHODS: ReadonlySet<string> = new Set(["each", "if", "skipIf", "todoIf", "failingIf", "concurrentIf", "serialIf"]);

function binding(source: SourceCode, node: ESTree.Node): Variable | undefined {
  if (node.type !== "Identifier") return undefined;
  let scope: Scope | null = source.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return undefined;
}

function memberName(node: ESTree.MemberExpression): string | undefined {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") return node.property.value;
  return undefined;
}

function bunImport(source: SourceCode, node: ESTree.Node): string | undefined {
  const definition = binding(source, node)?.defs[0];
  if (definition?.parent?.type !== "ImportDeclaration" || definition.parent.source.value !== "bun:test") return undefined;
  const specifier = definition.node;
  if (specifier.type === "ImportNamespaceSpecifier") return "*";
  if (specifier.type !== "ImportSpecifier") return undefined;
  return specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
}

function bunExport(source: SourceCode, node: ESTree.Node): string | undefined {
  if (node.type === "MemberExpression" && bunImport(source, node.object) === "*") return memberName(node);
  return bunImport(source, node);
}

function isTestCallee(source: SourceCode, node: ESTree.Node): boolean {
  const imported = bunExport(source, node);
  if (imported === "test" || imported === "it") return true;
  if (node.type === "MemberExpression") return hasTestMethod(source, node, TEST_METHODS);
  return node.type === "CallExpression" && hasTestMethod(source, node.callee, CURRIED_METHODS);
}

function hasTestMethod(source: SourceCode, node: ESTree.Node, methods: ReadonlySet<string>): boolean {
  if (node.type !== "MemberExpression") return false;
  const method = memberName(node);
  return method !== undefined && methods.has(method) && isTestCallee(source, node.object);
}

function isFunction(node: ESTree.Node | null | undefined): node is TestFunction {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression" || node?.type === "FunctionDeclaration";
}

function enclosingFunction(node: ESTree.Node): TestFunction | undefined {
  let parent = node.parent;
  while (parent !== null) {
    if (isFunction(parent)) return parent;
    parent = parent.parent;
  }
  return undefined;
}

function localFunction(source: SourceCode, node: ESTree.Node | undefined): TestFunction | undefined {
  if (isFunction(node)) return node;
  if (node?.type !== "Identifier") return undefined;
  const variable = binding(source, node);
  if (variable?.defs.length !== 1 || variable.references.some((ref) => ref.isWrite() && !ref.init)) return undefined;
  const definition = variable.defs[0]?.node;
  if (isFunction(definition)) return definition;
  if (definition?.type === "VariableDeclarator" && definition.id.type === "Identifier" && isFunction(definition.init)) return definition.init;
  return undefined;
}

function isAssertion(source: SourceCode, { callee }: ESTree.CallExpression): boolean {
  if (callee.type !== "MemberExpression") return false;
  if (memberName(callee) === "unreachable" && bunExport(source, callee.object) === "expect") return true;
  let receiver = callee.object;
  while (receiver.type === "MemberExpression") receiver = receiver.object;
  return receiver.type === "CallExpression" && bunExport(source, receiver.callee) === "expect";
}

function hasAssertion(
  source: SourceCode,
  calls: CallsByFunction,
  fn: TestFunction,
  seen: Set<TestFunction>,
): boolean {
  if (seen.has(fn)) return false;
  seen.add(fn);
  return (calls.get(fn) ?? []).some((call) => {
    if (call.type === "CallExpression") {
      if (isAssertion(source, call)) return true;
      const helper = localFunction(source, call.callee);
      if (helper !== undefined && hasAssertion(source, calls, helper, seen)) return true;
    }
    return call.arguments.some((arg) => isFunction(arg) && hasAssertion(source, calls, arg, seen));
  });
}

const requireAssertion: CreateRule = {
  create(context) {
    const source = context.sourceCode;
    if (!source.ast.body.some((node) => node.type === "ImportDeclaration" && node.source.value === "bun:test")) return {};
    const calls = new Map<TestFunction, Invocation[]>();
    const tests: ESTree.CallExpression[] = [];
    function recordInvocation(node: Invocation): void {
      const fn = enclosingFunction(node);
      if (fn === undefined) return;
      const bodyCalls = calls.get(fn);
      if (bodyCalls === undefined) calls.set(fn, [node]);
      else bodyCalls.push(node);
    }
    return {
      CallExpression(node) {
        if (isTestCallee(source, node.callee)) tests.push(node);
        recordInvocation(node);
      },
      NewExpression: recordInvocation,
      "Program:exit"() {
        for (const test of tests) {
          const bodies = [test.arguments[1], test.arguments[2]].flatMap((node) => {
            const fn = localFunction(source, node);
            if (fn !== undefined) return [fn];
            if (node?.type === "CallExpression" || node?.type === "NewExpression") return node.arguments.flatMap((arg) => isFunction(arg) ? [arg] : []);
            return [];
          });
          if (bodies.some((body) => hasAssertion(source, calls, body, new Set()))) continue;
          context.report({ node: test.callee, message: "Add a Bun expect matcher to this test or to a helper it calls in this file." });
        }
      },
    };
  },
};

const plugin: Plugin = {
  meta: { name: "bun-test" },
  rules: { "require-assertion": requireAssertion },
};

export default plugin;
