---
kind: reference
audience: consumers
---
# checks-secrets

`checks-secrets` is the gate that fails a range whose commits add a secret, such as an API token, a private key, a VPN key or a proxy link that carries its credential.

## What it checks

It scans the lines each commit in the range adds, in every file the commit adds or modifies, with gitleaks.
It fails on each secret the scan finds, and names its file, its line, the rule that matched and the commit that added it.
A secret one commit adds and a later commit in the range removes still fails, because the first commit still holds it.
It guards new changes only, and never scans a commit before the range, so a secret already in the history takes no part.

It runs gitleaks' default rules, which know the API keys and tokens of common services and private keys in PEM form, and seven rules of the kit's own:

| Rule | What it matches | What passes |
| --- | --- | --- |
| `wireguard-key` | a WireGuard or AmneziaWG private or pre-shared key value, 44 base64 characters, under a name that ends in `PrivateKey`, `PresharedKey` or `psk`, such as a real key after `PrivateKey =`, `"privateKey":`, `wg_private_key:` or `client_psk:` | a placeholder such as `<private-key>` or `${WG_PRIVATE_KEY}` |
| `wireguard-key-file` | a line that holds only a WireGuard or AmneziaWG key, 44 base64 characters, in a file whose name holds `priv`, `preshared`, `pre_shared`, `pre-shared` or `psk`, such as the `privatekey` file `wg genkey \| tee privatekey` writes, whatever else the name holds | a bare key in a file with any other name, such as `publickey` or `peer.pub`, and a placeholder such as `<private-key>` |
| `wireguard-dot-key-file` | a line that holds only a WireGuard or AmneziaWG key in a file whose name ends in `.key`, such as `wg0.key` | a file whose name ends in `pub.key` or `public.key`, such as `server-public.key`, unless `wireguard-key-file` matches its name |
| `proxy-userinfo-link` | a `vless://`, `vmess://`, `ss://`, `trojan://`, `hysteria://`, `hysteria2://`, `hy2://`, `tuic://`, `socks://`, `socks5://`, `socks5h://`, `wireguard://` or `wg://` link whose credential before an `@` has a Shannon entropy above 2.5 bits per character, such as a real password before the `@` of a `trojan://` link or a real private key before the `@` of a `wireguard://` link, and a template reference with real text around it, such as a literal user before `:${PASS}` or a non-empty default in `${PASS:-…}` | a link with no credential such as `socks5://127.0.0.1:1080`, a low-entropy credential such as `pw@` or `user@`, a placeholder credential such as `vless://<uuid>@<host>`, a credential that is only template references, each naming a variable that starts with a letter or underscore, such as `{password}`, `${pass}`, `${pass:-}`, `${pass:?message}`, `$PASS`, `{{ password }}` or `%(password)s`, including a user part such as `$USER:$PASS@`, and a link to `example.com`, `example.net`, `example.org`, a host under `.example`, `.invalid` or `.test`, or `localhost` |
| `proxy-base64-link` | a `vmess://`, `ss://` or `ssr://` link whose payload is 16 or more base64 characters with a Shannon entropy above 4.2 bits per character, whatever follows it | a placeholder such as `vmess://<base64-config>`, a link to a host and port such as `ss://vpn.home.net:8388`, and a payload an `@` follows, which `proxy-userinfo-link` judges |
| `proxy-query-credential` | each `auth`, `auth_str`, `obfsParam`, `obfs-password`, `password` or `pk` query value, in a link of any scheme, whose Shannon entropy is above 2.5 bits per character, judged on its own whatever other parameters the link carries, such as a real password in the `auth` of a `hysteria://` link or a real private key in the `pk` of a `wg://` link | a low-entropy value such as `auth=pw`, a placeholder value such as `auth=<password>`, a value that is only a template reference as `proxy-userinfo-link` describes, such as `auth={auth}`, `auth=${HY_AUTH:?set HY_AUTH}` or `pk=${peer.privateKey}`, and any of these parameters on a line that holds a link to one of the example hosts above carrying one of them |
| `proxy-subscription-url` | 16 or more token characters with a Shannon entropy above 3.0 bits per character after the `sub`, `subs`, `subscribe`, `subscription` or `link` path segment of an `http` or `https` URL, or in any `token`, `key`, `uuid` or `id` query value on a line that holds such a URL, each judged on its own | a `token`, `key`, `uuid` or `id` value on a line with no such URL, and a URL to one of the example hosts above |

No setting accepts a finding.
It ignores a repository's `.gitleaks.toml`, its `.gitleaksignore` and every `gitleaks:allow` comment.
It skips the paths gitleaks' default config skips, such as lockfiles, images and `node_modules/`.

## What it reads

It reads the commits of the range from git, not the working tree.
It reads its rules from `src/delivery/gitleaks.toml` in the installed package.

It runs gitleaks 8.30.1, pinned by the SHA-256 of each platform's archive and of the binary inside it.
On first use it downloads the archive from the scanner's GitHub release and unpacks the binary into `~/.cache/avi2dg-checks/gitleaks/8.30.1/`.
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
| 0 | no commit in the range adds a secret |
| 1 | a commit in the range adds a secret |
| 2 | a ref does not resolve, or no verified scanner is at hand, or gitleaks fails |

## Sample output

```
secrets: the range adds 3 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:
  vpn/links.txt:1 proxy-userinfo-link in e19e45c2: A proxy share link that carries its credential before the @, such as vless://, trojan://, socks5:// or wireguard://
  vpn/wg0.conf:2 wireguard-key in e19e45c2: A WireGuard or AmneziaWG private or pre-shared key
  vpn/wg0.conf:7 wireguard-key in e19e45c2: A WireGuard or AmneziaWG private or pre-shared key
```

The report never prints a secret.

## When it runs

`checks-lint` runs it over each pull request's range in every repository, as [checks-lint](checks-lint.md) says.
A local `bun run lint` runs it over the commits the branch adds, so it fails before a push.

## Related topics

- [checks-lint](checks-lint.md)
- [Why it is shaped this way](../design.md)
