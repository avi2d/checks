import type { Plugin } from "@oxlint/plugins";
import noShellInStrings from "./no-shell-in-strings.ts";
import readonlyCollectionParam from "./readonly-collection-param.ts";
import schemaTwin from "./schema-twin.ts";

const plugin: Plugin = {
  meta: { name: "data-shape" },
  rules: {
    "no-shell-in-strings": noShellInStrings,
    "readonly-collection-param": readonlyCollectionParam,
    "schema-twin": schemaTwin,
  },
};

export default plugin;
