#!/usr/bin/env bun
import { Effect, Layer } from "effect";
import { main } from "../../../src/dependencies/advisories.ts";
import { Scanner } from "../../../src/dependencies/osv-scanner.ts";

export const GATE_WITH_FAKE_SCANNER = import.meta.path;
export const FAKE_SCANNER_PATH = "FAKE_OSV_SCANNER";

if (import.meta.main) {
  const binary = process.env[FAKE_SCANNER_PATH] ?? "";
  main(Layer.succeed(Scanner, Scanner.of({ binary: () => Effect.succeed(binary) })));
}
