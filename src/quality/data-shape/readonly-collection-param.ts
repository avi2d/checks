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
  const target = param.type === "TSParameterProperty" ? param.parameter : param;
  if (target.type === "Identifier") return { name: target.name, type: target.typeAnnotation?.typeAnnotation };
  if (target.type === "AssignmentPattern" && target.left.type === "Identifier") {
    return { name: target.left.name, type: target.left.typeAnnotation?.typeAnnotation };
  }
  return undefined;
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

    const written = (target: ESTree.AssignmentTarget | ESTree.SimpleAssignmentTarget): void => {
      if (target.type !== "MemberExpression") return;
      if (target.object.type !== "Identifier") return;
      mark(target.object.name, undefined);
    };

    return {
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
