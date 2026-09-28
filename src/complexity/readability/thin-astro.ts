import type { CreateRule, ESTree } from "@oxlint/plugins";

function unwrapped(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function isAstroProps(value: ESTree.Expression): boolean {
  return (
    value.type === "MemberExpression" &&
    value.computed === false &&
    value.object.type === "Identifier" &&
    value.object.name === "Astro" &&
    value.property.type === "Identifier" &&
    value.property.name === "props"
  );
}

function readsProps(expression: ESTree.Expression, bound: ReadonlySet<string>): boolean {
  const value = unwrapped(expression);
  if (value.type === "MemberExpression") return isAstroProps(value) || readsProps(value.object, bound);
  return value.type === "Identifier" && bound.has(value.name);
}

function boundNames(pattern: ESTree.BindingPattern, found: Set<string>): void {
  switch (pattern.type) {
    case "Identifier":
      found.add(pattern.name);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        if (property.type === "Property") boundNames(property.value, found);
        else boundNames(property.argument, found);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element === null) continue;
        if (element.type === "RestElement") boundNames(element.argument, found);
        else boundNames(element, found);
      }
      break;
    case "AssignmentPattern":
      boundNames(pattern.left, found);
      break;
  }
}

function isTypeDeclaration(statement: ESTree.Statement): boolean {
  const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  return declaration?.type === "TSInterfaceDeclaration" || declaration?.type === "TSTypeAliasDeclaration";
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow logic in .astro frontmatter: only imports, props and markup" },
  },
  create(context) {
    if (!context.filename.endsWith(".astro")) return {};
    const bound = new Set<string>();
    return {
      Program(node) {
        for (const statement of node.body) {
          if (
            statement.type === "ImportDeclaration" ||
            statement.type === "EmptyStatement" ||
            isTypeDeclaration(statement)
          ) {
            continue;
          }
          if (
            statement.type === "VariableDeclaration" &&
            statement.declarations.length > 0 &&
            statement.declarations.every(
              (declarator) => declarator.init !== null && readsProps(declarator.init, bound),
            )
          ) {
            for (const declarator of statement.declarations) boundNames(declarator.id, bound);
            continue;
          }
          context.report({
            node: statement,
            message:
              "frontmatter holds more than imports and props: move this statement into a .ts file and import it, so the .astro file holds only imports, props and markup",
          });
        }
      },
    };
  },
};

export default rule;
