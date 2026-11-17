import { Config, Effect, Schema } from "effect";

export class InputMissing extends Schema.TaggedError<InputMissing>()("InputMissing", {
  message: Schema.String,
}) {}

export const optionalInput = (variable: string): Config.Config<string> => Config.String(variable).pipe(Config.withDefault(""));

// GitHub does not enforce a composite action's required inputs, so an unset one arrives empty.
export const requiredInput = Effect.fn("requiredInput")(function* (action: string, input: string, variable: string) {
  const value = yield* optionalInput(variable);
  if (value === "") return yield* new InputMissing({ message: `${action} needs the ${input} input, and it is empty` });
  return value;
});
