import { Effect, Option, Schema } from "effect";

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  message: Schema.String,
  status: Schema.Finite,
}) {}

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiCall = {
  readonly base: string;
  readonly path: string;
  readonly method: Method;
  readonly token: string;
  readonly body: unknown;
};

const ErrorBody = Schema.Struct({
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
  message: Schema.optional(Schema.String),
});

const decodeErrorBody = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorBody));

export function reasonOf(text: string): string {
  const reasons = Option.match(decodeErrorBody(text), {
    onNone: () => [],
    onSome: ({ errors, message }) => [...(errors ?? []).map((error) => error.message), ...(message === undefined ? [] : [message])],
  });
  return reasons.length === 0 ? "" : `: ${reasons.join("; ")}`;
}

// The message names the path alone, since the base can hold an account the caller keeps as a secret.
export const callApi = Effect.fn("callApi")(function* ({ base, path, method, token, body }: ApiCall) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "avi2d-workflows",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    catch: (cause) => new ApiError({ message: `${method} ${path} did not answer: ${String(cause)}`, status: 0 }),
  });
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => new ApiError({ message: `${method} ${path} broke off its answer: ${String(cause)}`, status: response.status }),
  });
  if (!response.ok) return yield* new ApiError({ message: `${method} ${path} answered HTTP ${response.status}${reasonOf(text)}`, status: response.status });
  return text;
});

export const callApiFor = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, call: ApiCall): Effect.Effect<S["Type"], ApiError> =>
  callApi(call).pipe(
    Effect.flatMap((text) =>
      Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(
        Effect.mapError(() => new ApiError({ message: `${call.method} ${call.path} answered a body of another shape`, status: 200 })),
      ),
    ),
  );
