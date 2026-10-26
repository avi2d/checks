# checks

`@avi2dg/checks` turns each rule a reviewer would otherwise have to remember into a program that runs on every pull request.
One command, `checks-lint`, judges a TypeScript repository's code, tests, commits, CI wiring and docs, and each failure names the file or line to fix.
Every Bun repository it holds moves to a new rule by upgrading one package, rather than by copying configs between repositories.

## Before you begin

- A git repository, whose history the range gates read.
- Bun, at the version the kit's `.bun-version` pins.

## Install

To hold a repository to the kit:

1. Add the kit:

   ```sh
   bun add -d @avi2dg/checks
   ```

1. Pin the Bun version the kit runs on:

   ```sh
   cp node_modules/@avi2dg/checks/.bun-version .bun-version
   ```

1. Run the gates:

   ```sh
   bunx checks-lint
   ```

Each gate that fails names the file it needs, and [Set up a repository](docs/how-to/set-up-a-repository.md) writes every one.
A repository the kit holds ends with `checks-lint: <count> gate(s) pass`.

## Find the page you need

| To | Read |
| --- | --- |
| write every file the gates ask for | [Set up a repository](docs/how-to/set-up-a-repository.md) |
| move to a newer release | [Upgrade the kit](docs/how-to/upgrade-the-kit.md) |
| turn on the CSS checks | [Turn on the CSS families](docs/how-to/turn-on-the-css-families.md) |
| look up a gate or a bin | [The bins](docs/bins.md) |
| look up a shared config | [Native settings](docs/configs/native-settings.md) |
| find a file the package ships | [The shipped files](docs/shipped-files.md) |
| learn why the kit is shaped this way | [Why it is shaped this way](docs/design.md) |

## Related topics

- [CHANGELOG.md](CHANGELOG.md)
