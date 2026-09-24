# widget

widget turns a list of parts into a bill of materials.
It is for the people who order parts for the workshop.
Use it when a spreadsheet stops keeping up.

## Before you begin

- Bun 1.3.13 or later.

## Install

To install widget:

1. Clone the repository.
1. Run `bun install`.

`bun run widget --version` prints the version.

## Build a bill of materials

To build a bill of materials:

1. Write the parts to `parts.json`.
1. Run `bun run widget parts.json`.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/` | the program |

## Troubleshooting

### `parts.json is not a list`

The file holds an object.
Wrap the parts in a list.

## Related topics

- [The parts format](docs/parts.md)
