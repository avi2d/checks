#!/usr/bin/env bun
import { launch } from "../../../src/core/native-launch.ts";
const source = Bun.fileURLToPath(import.meta.resolve("../../../src/quality/no-plain-js.ts"));
launch("checks-no-plain-js", source);
