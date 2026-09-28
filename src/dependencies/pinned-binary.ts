import { Crypto, Effect, Encoding, FileSystem, Path, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { collect } from "../core/git.ts";

const EXECUTABLE_MODE = 0o755;

export type Asset =
  | { readonly kind: "binary"; readonly url: string; readonly sha256: string }
  | { readonly kind: "tar.gz"; readonly url: string; readonly sha256: string; readonly member: string; readonly memberSha256: string };

class PinnedBinaryError extends Schema.TaggedError<PinnedBinaryError>()("PinnedBinaryError", {
  message: Schema.String,
}) {}

function installedSha256(asset: Asset): string {
  return asset.kind === "binary" ? asset.sha256 : asset.memberSha256;
}

const sha256Of = Effect.fn("sha256Of")(function* (bytes: Uint8Array) {
  const crypto = yield* Crypto.Crypto;
  return Encoding.encodeHex(yield* crypto.digest("SHA-256", bytes));
});

const verified = Effect.fn("verified")(function* (binary: string, sha256: string) {
  const fs = yield* FileSystem.FileSystem;
  const found = yield* sha256Of(yield* fs.readFile(binary));
  if (found !== sha256) {
    return yield* new PinnedBinaryError({ message: `${binary} has SHA-256 ${found}, not the pinned ${sha256}; delete it and rerun` });
  }
  return binary;
});

const download = Effect.fn("download")(function* (url: string) {
  const response = yield* HttpClient.get(url).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
  return new Uint8Array(yield* response.arrayBuffer);
}, Effect.provide(FetchHttpClient.layer));

const unpacked = Effect.fn("unpacked")(function* (asset: Asset, bytes: Uint8Array, staging: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const staged = path.join(staging, path.basename(asset.url));
  yield* fs.writeFile(staged, bytes);
  if (asset.kind === "binary") return staged;
  const { stderr, exitCode } = yield* collect("tar", ["-xzf", staged, "-C", staging, asset.member]).pipe(
    Effect.mapError((cause) => new PinnedBinaryError({ message: `cannot run tar: ${cause.message}` })),
  );
  if (exitCode !== 0) {
    return yield* new PinnedBinaryError({ message: `cannot unpack ${asset.member} from ${asset.url}: ${stderr.trim()}` });
  }
  const member = path.join(staging, asset.member);
  const found = yield* sha256Of(yield* fs.readFile(member));
  if (found !== asset.memberSha256) {
    return yield* new PinnedBinaryError({
      message: `${asset.member} in ${asset.url} has SHA-256 ${found}, not the pinned ${asset.memberSha256}, so nothing was installed`,
    });
  }
  return member;
});

// The binary lands through a rename in its own directory, so a concurrent run sees it whole or not at all.
export const installPinned = Effect.fn("installPinned")(function* (asset: Asset, binary: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (yield* fs.exists(binary)) return yield* verified(binary, installedSha256(asset));
  const bytes = yield* download(asset.url).pipe(
    Effect.mapError((cause) => new PinnedBinaryError({ message: `cannot download ${asset.url}: ${cause.message}` })),
  );
  const found = yield* sha256Of(bytes);
  if (found !== asset.sha256) {
    return yield* new PinnedBinaryError({ message: `${asset.url} has SHA-256 ${found}, not the pinned ${asset.sha256}, so nothing was installed` });
  }
  yield* fs.makeDirectory(path.dirname(binary), { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: path.dirname(binary), prefix: `.${path.basename(binary)}-` });
  const staged = yield* unpacked(asset, bytes, staging);
  yield* fs.chmod(staged, EXECUTABLE_MODE);
  yield* fs.rename(staged, binary);
  return binary;
}, Effect.scoped);
