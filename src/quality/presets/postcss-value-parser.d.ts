declare module "postcss-value-parser" {
  interface ValueNode {
    readonly type: string;
    readonly value: string;
  }

  interface ParsedValue {
    readonly nodes: readonly ValueNode[];
  }

  function parse(value: string): ParsedValue;

  namespace parse {
    function stringify(node: ValueNode): string;
  }

  export default parse;
}
