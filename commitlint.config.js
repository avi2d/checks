export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // GitHub squash merges append " (#12)", pushing long headers past 100.
    "header-max-length": [2, "always", 120],
  },
};
