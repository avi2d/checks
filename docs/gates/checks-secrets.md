---
kind: reference
audience: consumers
---
# checks-secrets

`checks-secrets` is the gate that fails a range whose commits add a secret, such as an API token, a private key, a VPN key or a proxy link that carries its credential.

## What it checks

It scans the lines each commit in the range adds, in every file the commit adds or modifies, with gitleaks.
It fails on each secret the scan finds, and names its file, its line, the rule that matched and the commit that added it.
A secret one rule matches twice at the same place, once as written and once percent-decoded, counts once.
A secret one commit adds and a later commit in the range removes still fails, because the first commit still holds it.
It guards new changes only, and never scans a commit before the range, so a secret already in the history takes no part.

It runs gitleaks' default rules, which know the API keys and tokens of common services and private keys in PEM form, and six rules of the kit's own:

| Rule | What it matches | What passes |
| --- | --- | --- |
| `wireguard-key` | a WireGuard or AmneziaWG private or pre-shared key value, 44 base64 characters, under a name that ends in `PrivateKey`, `PresharedKey` or `psk`, such as `PrivateKey = <key>`, `"privateKey": "<key>"`, `wg_private_key: <key>` or `client_psk: <key>` | a placeholder such as `<private-key>` or `${WG_PRIVATE_KEY}` |
| `wireguard-key-file` | a line that holds only a WireGuard or AmneziaWG key, 44 base64 characters, in a file whose name holds `privatekey`, `private_key`, `privkey`, `presharedkey`, `pre_shared_key` or `psk`, or ends in `.key`, such as the `privatekey` file `wg genkey \| tee privatekey` writes | a file whose name ends in a public-key name, such as `publickey`, `client.pubkey`, `server-public.key` or `server_pub.key`, a bare key in a file with any other name, such as `peer.pub`, and a placeholder such as `<private-key>` |
| `proxy-userinfo-link` | a `vless://`, `vmess://`, `ss://`, `trojan://`, `hysteria://`, `hysteria2://`, `hy2://`, `tuic://`, `socks://`, `socks5://`, `socks5h://`, `wireguard://` or `wg://` link whose credential before an `@` has a Shannon entropy above 2.5 bits per character, such as `trojan://<password>@<host>:443` or `wireguard://<private-key>@<host>:51820` | a link with no credential such as `socks5://127.0.0.1:1080`, a low-entropy credential such as `pw@` or `user@`, a placeholder credential such as `vless://<uuid>@<host>` or `trojan://${TROJAN_PASSWORD}@<host>`, and a link to `example.com`, `example.net`, `example.org`, a host under `.example`, `.invalid` or `.test`, or `localhost` |
| `proxy-base64-link` | a `vmess://`, `ss://` or `ssr://` link whose payload is 16 or more base64 characters with a Shannon entropy above 4.2 bits per character, whatever follows it | a placeholder such as `vmess://<base64-config>`, a link to a host and port such as `ss://vpn.home.net:8388`, and a payload an `@` follows, which `proxy-userinfo-link` judges |
| `proxy-query-credential` | a link of any scheme above whose `auth`, `auth_str`, `obfsParam`, `obfs-password`, `password` or `pk` query value is set, with or without a credential before an `@`, such as `hysteria://<host>:443?auth=<password>` or `wg://<host>:51820?pk=<private-key>` | a placeholder value such as `auth=<password>` or `auth=${HYSTERIA_AUTH}`, and a link to one of the example hosts above |
| `proxy-subscription-url` | an `http` or `https` URL whose `sub`, `subs`, `subscribe`, `subscription` or `link` path segment or `token`, `key`, `uuid` or `id` query value carries 16 or more token characters | a URL to one of the example hosts above |

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
