import { guardLocalTests } from "../core/local-tests.ts";

await guardLocalTests().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
