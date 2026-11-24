import { Config, Schema } from "effect";

export const ciCores = Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), "CI_CORES").pipe(Config.option);
