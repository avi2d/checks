import type { Plugin } from "@oxlint/plugins";
import readonlyCollectionParam from "./readonly-collection-param.ts";
import schemaTwin from "./schema-twin.ts";

const plugin: Plugin = {
  meta: { name: "data-shape" },
  rules: {
    "readonly-collection-param": readonlyCollectionParam,
    "schema-twin": schemaTwin,
  },
};

export default plugin;
