import { bunStep, runStepsMain, type Step } from "./run-steps.ts";

type Bundle = { readonly entries: readonly string[]; readonly outdir: string; readonly external: boolean };

const BUNDLES: readonly Bundle[] = [
  { entries: ["src/quality/effect-channel/index.ts"], outdir: "dist/effect-channel", external: false },
  { entries: ["src/complexity/readability/index.ts"], outdir: "dist/readability", external: false },
  { entries: ["src/quality/data-shape/index.ts"], outdir: "dist/data-shape", external: false },
  { entries: ["src/testing/mutation-guard-plugin.ts", "src/testing/mutation-refusal.ts"], outdir: "dist/mutation", external: true },
  {
    entries: ["src/quality/presets/oxlint.ts", "src/quality/presets/knip.ts", "src/quality/presets/dependency-cruiser.ts", "src/quality/presets/stylelint.ts"],
    outdir: "dist/presets",
    external: true,
  },
];

const bundleStep = ({ entries, outdir, external }: Bundle): Step =>
  bunStep("build", ...entries, "--outdir", outdir, "--target", "node", "--format", "esm", ...(external ? ["--packages", "external"] : []));

const WRITERS = ["scripts/configs-write.ts", "src/quality/effect-scope.ts", "scripts/doc-templates-write.ts", "src/delivery/changelog-write.ts", "scripts/doc-blocks-write.ts", "scripts/launchers-write.ts"];

runStepsMain([...BUNDLES.map(bundleStep), ["tsc", "-p", "tsconfig.presets.json"], ...WRITERS.map((writer) => bunStep(writer))]);
