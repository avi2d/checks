declare module "postcss-value-parser" {
  interface ValueNode {
    readonly type: string;
    readonly value: string;
  }

  interface ParsedValue {
    walk(visit: (node: ValueNode) => false | undefined): void;
  }

  function parse(value: string): ParsedValue;

  export default parse;
}
