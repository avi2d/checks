#!/usr/bin/env bun
import { launch } from "../../../src/core/native-launch.ts";
const source = Bun.fileURLToPath(import.meta.resolve("../../../src/testing/whole-tree-run.ts"));
launch("checks-whole-tree-run", source);
