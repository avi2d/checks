import { expect, test } from "bun:test";
import effectLanguageService from "../presets/effect.language-service.json" with { type: "json" };
import effectOxlint from "../presets/effect.oxlint.json" with { type: "json" };
import { fragmentsFor, OXLINT_FRAGMENT, TSCONFIG_FRAGMENT } from "../scripts/quality.ts";

test("without sources.effect there is nothing to generate", () => {
  expect(fragmentsFor({})).toEqual([]);
  expect(fragmentsFor({ sources: { production: ["src/**/*.ts"] } })).toEqual([]);
});

test("each fragment holds the declared paths under the kit's presets, and the exempt files outside them", () => {
  const [oxlint, tsconfig] = fragmentsFor({ sources: { effect: { paths: ["src/**/*.ts"], exempt: ["src/host/*.ts"] } } });
  expect(oxlint).toEqual({
    file: OXLINT_FRAGMENT,
    extendedBy: ".oxlintrc.json",
    reader: "oxlint",
    content: {
      $schema: "./node_modules/oxlint/configuration_schema.json",
      plugins: ["typescript", "oxc", "eslint", "import"],
      overrides: [
        {
          files: ["src/**/*.ts"],
          excludeFiles: ["src/host/*.ts"],
          plugins: ["typescript", "oxc", "eslint", "import", "node", "promise", "unicorn"],
          rules: effectOxlint.rules,
        },
      ],
    },
  });
  expect(tsconfig).toEqual({
    file: TSCONFIG_FRAGMENT,
    extendedBy: "tsconfig.json",
    reader: "the language service",
    content: {
      compilerOptions: {
        plugins: [
          {
            name: "@effect/language-service",
            overrides: [
              { include: ["src/**/*.ts"], exclude: ["src/host/*.ts"], options: effectLanguageService },
            ],
          },
        ],
      },
    },
  });

  const [unexempt] = fragmentsFor({ sources: { effect: { paths: ["src/**/*.ts"] } } });
  expect(JSON.stringify(unexempt?.content)).not.toContain("excludeFiles");
});
