#!/usr/bin/env bun
import { launch } from "../../../src/core/native-launch.ts";
const source = Bun.fileURLToPath(import.meta.resolve("../../../src/delivery/release-preflight.ts"));
launch("checks-release-preflight", source);
