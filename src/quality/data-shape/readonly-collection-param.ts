import type { CreateRule, ESTree } from "@oxlint/plugins";

type Watched = {
  readonly name: string;
  readonly type: ESTree.TSType;
  readonly methods: ReadonlySet<string>;
};

type Frame = {
  readonly watched: readonly Watched[];
  readonly mutated: Set<string>;
};

const ARRAY_METHODS: ReadonlySet<string> = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const COLLECTION_METHODS: ReadonlySet<string> = new Set(["set", "delete", "clear", "add"]);

const READONLY_NAMES: ReadonlySet<string> = new Set(["ReadonlyArray", "ReadonlyMap", "ReadonlySet"]);

function isArrayType(type: ESTree.TSType | undefined): boolean {
  if (type === undefined) return false;
  if (type.type === "TSArrayType") return true;
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && type.typeName.name === "Array";
}

function isMapOrSet(type: ESTree.TSType | undefined): boolean {
  return (
    type?.type === "TSTypeReference" &&
    type.typeName.type === "Identifier" &&
    (type.typeName.name === "Map" || type.typeName.name === "Set")
  );
}

type Named = { readonly name: string; readonly type: ESTree.TSType | undefined };

function namedOf(param: ESTree.ParamPattern): Named | undefined {
  if (param.type === "Identifier") return { name: param.name, type: param.typeAnnotation?.typeAnnotation };
  if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
    return { name: param.left.name, type: param.left.typeAnnotation?.typeAnnotation };
  }
  return undefined;
}

function isReadonlyType(type: ESTree.TSType | undefined): boolean {
  if (type?.type === "TSTypeOperator") return type.operator === "readonly";
  return (
    type?.type === "TSTypeReference" &&
    type.typeName.type === "Identifier" &&
    READONLY_NAMES.has(type.typeName.name)
  );
}

function declaredFunctions(program: ESTree.Program): Map<string, readonly ESTree.ParamPattern[]> {
  const found = new Map<string, readonly ESTree.ParamPattern[]>();
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type === "FunctionDeclaration" && declaration.id !== null) {
      found.set(declaration.id.name, declaration.params);
    }
  }
  return found;
}

function isPassThrough(parent: ESTree.Node | null, child: ESTree.Node): parent is ESTree.Node {
  if (parent === null) return false;
  if (parent.type === "ConditionalExpression") return parent.test !== child;
  return (
    parent.type === "LogicalExpression" ||
    parent.type === "TSAsExpression" ||
    parent.type === "TSSatisfiesExpression" ||
    parent.type === "TSNonNullExpression"
  );
}

function valuePosition(node: ESTree.Node): ESTree.Node {
  let current = node;
  while (isPassThrough(current.parent, current)) current = current.parent;
  return current;
}

function watch(params: readonly ESTree.ParamPattern[]): Watched[] {
  const found: Watched[] = [];
  for (const param of params) {
    const named = namedOf(param);
    if (named === undefined || named.type === undefined) continue;
    if (isArrayType(named.type)) found.push({ name: named.name, type: named.type, methods: ARRAY_METHODS });
    else if (isMapOrSet(named.type)) found.push({ name: named.name, type: named.type, methods: COLLECTION_METHODS });
  }
  return found;
}

function fixOf(type: ESTree.TSType, text: string): string {
  return type.type === "TSArrayType" ? `readonly ${text}` : `Readonly${text}`;
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Type a collection parameter the function never mutates as readonly" },
  },
  create(context) {
    const stack: Frame[] = [];
    let functions = new Map<string, readonly ESTree.ParamPattern[]>();

    const mark = (name: string, method: string | undefined): void => {
      for (let index = stack.length - 1; index >= 0; index--) {
        const frame = stack[index];
        if (frame === undefined) continue;
        const param = frame.watched.find((one) => one.name === name);
        if (param === undefined) continue;
        if (method === undefined || param.methods.has(method)) frame.mutated.add(name);
        return;
      }
    };

    const enter = (node: ESTree.Function | ESTree.ArrowFunctionExpression): void => {
      stack.push({ watched: watch(node.body === null ? [] : node.params), mutated: new Set() });
    };

    const leave = (): void => {
      const frame = stack.pop();
      if (frame === undefined) return;
      for (const param of frame.watched) {
        if (frame.mutated.has(param.name)) continue;
        const text = context.sourceCode.getText(param.type);
        context.report({
          node: param.type,
          message: `parameter \`${param.name}\` is typed \`${text}\` but this function never mutates it. Type it \`${fixOf(param.type, text)}\` instead.`,
        });
      }
    };

    const call = (node: ESTree.CallExpression): void => {
      const { callee } = node;
      if (callee.type !== "MemberExpression") return;
      const { object, property } = callee;
      if (object.type !== "Identifier" || property.type !== "Identifier") return;
      mark(object.name, property.name);
    };

    const passedReadonly = (site: ESTree.CallExpression | ESTree.NewExpression, argument: ESTree.Node): boolean => {
      if (site.callee.type !== "Identifier") return false;
      const params = functions.get(site.callee.name);
      const index = site.arguments.findIndex((one) => one === argument);
      const param = params?.[index];
      return param !== undefined && isReadonlyType(namedOf(param)?.type);
    };

    const escapes = (node: ESTree.Node): boolean => {
      const value = valuePosition(node);
      const { parent } = value;
      if (parent === null) return false;
      if (parent.type === "CallExpression" || parent.type === "NewExpression") {
        return parent.callee !== value && !passedReadonly(parent, value);
      }
      if (parent.type === "VariableDeclarator") return parent.init === value;
      if (parent.type === "AssignmentExpression") return parent.right === value;
      if (parent.type === "Property") return parent.value === value;
      if (parent.type === "ArrowFunctionExpression") return parent.body === value;
      return parent.type === "ArrayExpression" || parent.type === "ReturnStatement";
    };

    const written = (target: ESTree.AssignmentTarget | ESTree.SimpleAssignmentTarget): void => {
      if (target.type !== "MemberExpression") return;
      if (target.object.type !== "Identifier") return;
      mark(target.object.name, undefined);
    };

    return {
      Program: (node) => {
        functions = declaredFunctions(node);
      },
      Identifier: (node) => {
        if (escapes(node)) mark(node.name, undefined);
      },
      FunctionDeclaration: enter,
      FunctionExpression: enter,
      ArrowFunctionExpression: enter,
      "FunctionDeclaration:exit": leave,
      "FunctionExpression:exit": leave,
      "ArrowFunctionExpression:exit": leave,
      CallExpression: call,
      AssignmentExpression: (node) => {
        written(node.left);
      },
      UpdateExpression: (node) => {
        written(node.argument);
      },
    };
  },
};

export default rule;
