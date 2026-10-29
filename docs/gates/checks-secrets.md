---
kind: reference
audience: consumers
---
# checks-secrets

`checks-secrets` is the gate that fails a range whose commits add a secret, such as an API token, a private key, a VPN key or a proxy link that carries its credential.
A private pack adds terms no public file may carry, such as a person's name, an employer's domain, host names and IP ranges.

## What it checks

It scans the lines each commit in the range adds, in every file the commit adds or modifies, with gitleaks.
In a merge commit it scans the lines the merge's own resolution adds, such as a key written while resolving a conflict, and not what the merge brings in from the other parent.
It exits 2 when a commit it scans is an octopus merge, one with three or more parents, because git gives no resolution diff for one.
It scans the message of each commit in the range with the rules and the private pack [checks-pr-text](checks-pr-text.md) runs on a pull request's text.
A merge commit's own message is scanned too, though the file scan skips what the merge brings in from the other parent.
It fails on each secret the scan finds, and names its file, its line, the rule that matched and the commit that added it.
A finding in a message names `the message` and its line in place of a file, where the subject is line 1.
A secret one commit adds and a later commit in the range removes still fails, because the first commit still holds it.
It guards new changes only, and never scans a commit before the range, so a secret already in the history takes no part.

It runs gitleaks' default rules, which know the API keys and tokens of common services and private keys in PEM form, and eight rules of the kit's own that report a secret:

| Rule | What it matches | What passes |
| --- | --- | --- |
| `wireguard-key` | a WireGuard or AmneziaWG private or pre-shared key value, 44 base64 characters, under a name that ends in `PrivateKey`, `PresharedKey` or `psk`, such as a real key after `PrivateKey =`, `"privateKey":`, `wg_private_key:` or `client_psk:` | a placeholder such as `<private-key>` or `${WG_PRIVATE_KEY}` |
| `wireguard-key-file` | a line that holds only a WireGuard or AmneziaWG key, 44 base64 characters, in a file whose name holds `priv`, `preshared`, `pre_shared`, `pre-shared` or `psk`, such as the `privatekey` file `wg genkey \| tee privatekey` writes, whatever else the name holds | a bare key in a file with any other name, such as `publickey` or `peer.pub`, and a placeholder such as `<private-key>` |
| `wireguard-dot-key-file` | a line that holds only a WireGuard or AmneziaWG key in a file whose name ends in `.key`, such as `wg0.key` | a file whose name ends in `pub.key` or `public.key`, such as `server-public.key`, unless `wireguard-key-file` matches its name |
| `proxy-userinfo-link` | a `vless://`, `vmess://`, `ss://`, `trojan://`, `hysteria://`, `hysteria2://`, `hy2://`, `tuic://`, `socks://`, `socks5://`, `socks5h://`, `wireguard://` or `wg://` link whose credential before an `@` has a Shannon entropy above 2.5 bits per character, such as a real password before the `@` of a `trojan://` link or a real private key before the `@` of a `wireguard://` link, and a template reference with real text around it, such as a literal user before `:${PASS}` or a non-empty default in `${PASS:-…}` | a link with no credential such as `socks5://127.0.0.1:1080`, a low-entropy credential such as `pw@` or `user@`, a placeholder credential such as `vless://<uuid>@<host>`, a credential that is only template references, such as `{password}`, `$PASS`, `{{ password }}` or `%(password)s` naming a variable that starts with a letter or underscore, or any `${…}` interpolation except a shell default such as `${PASS:-value}`, such as `${pass}`, `${pass:-}`, `${pass:?message}` or `${encodeURIComponent(pass)}`, including a user part such as `$USER:$PASS@`, and a link to `example.com`, `example.net`, `example.org`, a host under `.example`, `.invalid` or `.test`, or `localhost` |
| `proxy-base64-link` | a `vmess://`, `ss://` or `ssr://` link whose payload is 16 or more base64 characters with a Shannon entropy above 4.2 bits per character, whatever follows it | a placeholder such as `vmess://<base64-config>`, a link to a host and port such as `ss://vpn.home.net:8388`, and a payload an `@` follows, which `proxy-userinfo-link` judges |
| `proxy-query-credential-first` | the first `auth`, `auth_str`, `obfsParam`, `obfs-password`, `password` or `pk` query value of one of the links `proxy-userinfo-link` names or an `ssr://` link, whose Shannon entropy is above 2.5 bits per character, such as a real password in the `auth` of a `hysteria://` link or a real private key in the `pk` of a `wg://` link, whatever parameters come before or after it | a low-entropy value such as `auth=pw`, a placeholder value such as `auth=<password>`, a value that is only template references as `proxy-userinfo-link` describes, such as `auth={auth}`, `auth=${HY_AUTH:?set HY_AUTH}` or `auth=${encodeURIComponent("a b")}`, and a link to one of the example hosts above |
| `proxy-query-credential-last` | the last of these query values in such a link, judged the same way, so a real value after a low-entropy or template one still fails | what passes `proxy-query-credential-first` |
| `proxy-subscription-url` | 16 or more token characters with a Shannon entropy above 3.0 bits per character after the `sub`, `subs`, `subscribe`, `subscription` or `link` path segment of an `http` or `https` URL, or in any `token`, `key`, `uuid` or `id` query value on a line that holds such a URL, each judged on its own | a `token`, `key`, `uuid` or `id` value on a line with no such URL, and a URL to one of the example hosts above |

A ninth rule, `proxy-subscription-path`, reports nothing: it finds the URL `proxy-subscription-url` needs on the same line.

These rules do not catch:

- a real query value between two others of these parameters in one link whose values are low-entropy or template references, such as a real `auth` between an `obfsParam=pw` or `obfsParam=${OBFS}` and a `password=pw`
- a real `auth`, `auth_str`, `obfsParam`, `obfs-password`, `password` or `pk` query value of an `http` or `https` URL, or of a scheme the table does not name, because the kit's query rules judge share links only, and gitleaks' default rules catch such a value only now and then
- a credential that begins with `${` and is not a shell default such as `${PASS:-value}`, `${PASS-value}`, `${PASS:=value}` or `${PASS:+value}`, because it reads as an interpolation, even when it holds a fallback such as `${auth ?? "value"}`

No setting accepts a finding.
It ignores a repository's `.gitleaks.toml`, its `.gitleaksignore` and every `gitleaks:allow` comment.
It skips the paths gitleaks' default config skips, such as lockfiles, images and `node_modules/`.
It scans what a commit adds to its files and its message, and not its author, which [checks-commit-identity](checks-commit-identity.md) judges.

## The private pack

The private pack is a JSON file of terms that lives outside every public repository, and `CHECKS_SECRETS_PACK` names its path.
The kit ships no pack and no term, so a public repository can run the pack without carrying what it hides.
With `CHECKS_SECRETS_PACK` unset the gate runs the kit's rules alone, exactly as it does without a pack, and its last line says so.
With it set the gate adds a rule for each kind of term the pack lists.
It fails a range that adds any of them to a file or a commit message.

Each key is optional, and each holds a list of strings:

| Key | Rule | What it matches |
| --- | --- | --- |
| `names` | `private-name` | a person's name form, such as a full name, a handle or a login |
| `domains` | `private-domain` | an employer's or any other domain, also inside an email address or a subdomain |
| `hosts` | `private-host` | a host name |
| `runners` | `private-runner` | a CI runner's name |
| `ipRanges` | `private-ip-range` | an IPv4 address inside a CIDR range, such as `192.0.2.0/24`, or a single IPv4 address |

A pack with obviously fake terms reads like this:

```json
{
  "names": ["Pat Example", "pexample"],
  "domains": ["employer.example"],
  "hosts": ["build-01.corp.example"],
  "runners": ["runner-blue-7"],
  "ipRanges": ["192.0.2.0/24", "198.51.100.7"]
}
```

A term matches in any case, and the spaces inside it match any run of ASCII whitespace or Unicode space separators.
A term's end that is an ASCII letter, digit or underscore matches only at a word boundary, so `pexample` does not match inside `pexamples`.
An address matches only as a whole, so `192.0.2.0/24` does not match `1192.0.2.5`.
An IPv6 range has no key, so a pack lists its prefix under `hosts` as its addresses are written, such as `2001:db8:`.
The gitleaks default allowlist skips paths such as lockfiles, go.mod and go.sum, images and documents such as PDFs.
It also skips node_modules and some Go and Ruby vendor paths, so the pack terms are not searched there.
A lockfile's resolved URLs can carry a private registry host, so keep such a host out of lockfiles, go.mod and go.sum by other means.
The pack scans each commit message, trailers included, and checks-commit-identity also judges the author, the committer and Co-authored-by trailers.

The gate exits 2, and scans nothing, when `CHECKS_SECRETS_PACK` is set but the pack cannot serve:

- the variable is set to an empty value, as a CI secret that is missing expands
- the file is missing, unreadable or a directory
- the file is not JSON or holds a key the table does not name
- a term is blank or holds a control character, or a range is not IPv4
- the pack lists no term at all

No report or error prints a matched term text or the pack path, because a public CI log would publish either.
A finding names its file, its line and its rule, and the description of each pack rule says only which kind of term matched.
A finding location prints as it stands, such as a file name or a link.
So a term inside a file name or a repository name shows there.
That location is already public in the scanned commit.

The pack lives where only its owner reads it.
On a laptop it is a file outside every checkout, and the shell profile exports its path:

```sh
export CHECKS_SECRETS_PACK="$HOME/.config/checks/secrets-pack.json"
```

In GitHub Actions a repository or organisation secret holds the JSON, and the job writes it to a file before the gate runs:

```yaml
- name: write the private pack
  env:
    PACK: ${{ secrets.CHECKS_SECRETS_PACK }}
  run: |
    printf '%s' "$PACK" > "$RUNNER_TEMP/secrets-pack.json"
    echo "CHECKS_SECRETS_PACK=$RUNNER_TEMP/secrets-pack.json" >> "$GITHUB_ENV"
- run: bun run lint
```

A fork's `pull_request` run gets no secret, so the file is empty and the gate exits 2 rather than pass without the pack.
Unlike [checks-pr-text](checks-pr-text.md), this gate has no skip: a job that writes the pack from an unset secret exits 2.
[checks-pr-text](checks-pr-text.md) scans a pull request's title, body and comments with the same pack.

## What it reads

It reads the commits of the range and their messages from git, not the working tree.
It needs git 2.36 or newer, which diffs a merge against the merge git would make on its own, and it exits 2 on an older git.
It reads its rules from `src/delivery/gitleaks.toml` in the installed package.
It reads the path of the private pack from `CHECKS_SECRETS_PACK`.
It writes the kit's rules and the pack's into one config, and each commit message into a file of its own.
Each goes in a temporary directory it deletes when the scan ends.

It runs the gitleaks release `src/delivery/gitleaks.ts` pins, by the SHA-256 of each platform's archive and of the binary inside it.
On first use it downloads the archive from the scanner's GitHub release and unpacks the binary into `~/.cache/avi2dg-checks/gitleaks/<version>/`.
It checks the binary's SHA-256 again on every run and exits 2 on a copy that differs.
Builds are pinned for macOS and Linux, each on x64 and arm64.
On any other platform it exits 2, and no setting runs a scanner other than the pinned build.
A cold cache downloads about 8 MB.

## Arguments

```sh
checks-secrets <base-ref> <head-ref>
checks-secrets <ref>
```

With two arguments it scans each commit from the merge base of the two refs to the head.
With one it scans that commit alone.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no commit in the range adds a secret, in its files or its message |
| 1 | a commit in the range adds a secret, in its files or its message |
| 2 | a ref does not resolve, or a commit it scans is an octopus merge, or no verified scanner is at hand, or git is older than 2.36, or gitleaks fails, or `CHECKS_SECRETS_PACK` is set and the pack cannot serve |

## Sample output

```
secrets: the range adds 3 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:
  vpn/links.txt:1 proxy-userinfo-link in e19e45c2: A proxy share link that carries its credential before the @, such as vless://, trojan://, socks5:// or wireguard://
  vpn/wg0.conf:2 wireguard-key in e19e45c2: A WireGuard or AmneziaWG private or pre-shared key
  vpn/wg0.conf:7 wireguard-key in e19e45c2: A WireGuard or AmneziaWG private or pre-shared key
secrets: CHECKS_SECRETS_PACK is unset, so the kit's rules ran without a private pack
```

With a pack set, a finding of the pack names the kind of term and never the term:

```
secrets: the range adds 2 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:
  docs/setup.md:12 private-domain in 4f1c09ab: A domain the private pack lists
  the message:3 private-name in 4f1c09ab: A name form the private pack lists
secrets: the kit's rules and the private pack CHECKS_SECRETS_PACK names ran
```

The report never prints a secret.

## When it runs

`checks-lint` runs it over each pull request's range in every repository, as [checks-lint](checks-lint.md) says.
A local `bun run lint` runs it over the commits the branch adds, so it fails before a push.

## Related topics

- [checks-lint](checks-lint.md)
- [checks-pr-text](checks-pr-text.md)
- [Why it is shaped this way](../design.md)
