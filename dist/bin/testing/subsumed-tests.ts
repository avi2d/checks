#!/usr/bin/env bun
import { launch } from "../../../src/core/native-launch.ts";
const source = Bun.fileURLToPath(import.meta.resolve("../../../src/testing/subsumed-tests.ts"));
launch("checks-subsumed-tests", source);
