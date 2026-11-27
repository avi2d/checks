// src/testing/bun-test/index.ts
var TEST_METHODS = new Set(["only", "concurrent", "serial", "failing"]);
var CURRIED_METHODS = new Set(["each", "if", "skipIf", "todoIf", "failingIf", "concurrentIf", "serialIf"]);
function binding(source, node) {
  if (node.type !== "Identifier")
    return;
  let scope = source.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined)
      return variable;
    scope = scope.upper;
  }
  return;
}
function memberName(node) {
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string")
    return node.property.value;
  return;
}
function bunImport(source, node) {
  const definition = binding(source, node)?.defs[0];
  if (definition?.parent?.type !== "ImportDeclaration" || definition.parent.source.value !== "bun:test")
    return;
  const specifier = definition.node;
  if (specifier.type === "ImportNamespaceSpecifier")
    return "*";
  if (specifier.type !== "ImportSpecifier")
    return;
  return specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
}
function bunExport(source, node) {
  if (node.type === "MemberExpression" && bunImport(source, node.object) === "*")
    return memberName(node);
  return bunImport(source, node);
}
function isTestCallee(source, node) {
  const imported = bunExport(source, node);
  if (imported === "test" || imported === "it")
    return true;
  if (node.type === "MemberExpression")
    return hasTestMethod(source, node, TEST_METHODS);
  return node.type === "CallExpression" && hasTestMethod(source, node.callee, CURRIED_METHODS);
}
function hasTestMethod(source, node, methods) {
  if (node.type !== "MemberExpression")
    return false;
  const method = memberName(node);
  return method !== undefined && methods.has(method) && isTestCallee(source, node.object);
}
function isFunction(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression" || node?.type === "FunctionDeclaration";
}
function enclosingFunction(node) {
  let parent = node.parent;
  while (parent !== null) {
    if (isFunction(parent))
      return parent;
    parent = parent.parent;
  }
  return;
}
function localFunction(source, node) {
  if (isFunction(node))
    return node;
  if (node?.type !== "Identifier")
    return;
  const variable = binding(source, node);
  if (variable?.defs.length !== 1 || variable.references.some((ref) => ref.isWrite() && !ref.init))
    return;
  const definition = variable.defs[0]?.node;
  if (isFunction(definition))
    return definition;
  if (definition?.type === "VariableDeclarator" && definition.id.type === "Identifier" && isFunction(definition.init))
    return definition.init;
  return;
}
function isAssertion(source, { callee }) {
  if (callee.type !== "MemberExpression")
    return false;
  if (memberName(callee) === "unreachable" && bunExport(source, callee.object) === "expect")
    return true;
  let receiver = callee.object;
  while (receiver.type === "MemberExpression")
    receiver = receiver.object;
  return receiver.type === "CallExpression" && bunExport(source, receiver.callee) === "expect";
}
function hasAssertion(source, calls, fn, seen) {
  if (seen.has(fn))
    return false;
  seen.add(fn);
  return (calls.get(fn) ?? []).some((call) => {
    if (isAssertion(source, call))
      return true;
    const helper = localFunction(source, call.callee);
    if (helper !== undefined && hasAssertion(source, calls, helper, seen))
      return true;
    return call.arguments.some((arg) => isFunction(arg) && hasAssertion(source, calls, arg, seen));
  });
}
var requireAssertion = {
  create(context) {
    const source = context.sourceCode;
    if (!source.ast.body.some((node) => node.type === "ImportDeclaration" && node.source.value === "bun:test"))
      return {};
    const calls = new Map;
    const tests = [];
    return {
      CallExpression(node) {
        if (isTestCallee(source, node.callee))
          tests.push(node);
        const fn = enclosingFunction(node);
        if (fn === undefined)
          return;
        const bodyCalls = calls.get(fn);
        if (bodyCalls === undefined)
          calls.set(fn, [node]);
        else
          bodyCalls.push(node);
      },
      "Program:exit"() {
        for (const test of tests) {
          const body = localFunction(source, test.arguments[1]) ?? localFunction(source, test.arguments[2]);
          if (body !== undefined && hasAssertion(source, calls, body, new Set))
            continue;
          context.report({ node: test.callee, message: "Add a Bun expect matcher to this test or to a helper it calls in this file." });
        }
      }
    };
  }
};
var plugin = {
  meta: { name: "bun-test" },
  rules: { "require-assertion": requireAssertion }
};
var bun_test_default = plugin;
export {
  bun_test_default as default
};
