---
kind: how-to
audience: consumers
---
# Test the screens of one block

A repository owner follows these steps to picture one block at the kit's screen sizes in Chromium and WebKit, and to approve its pictures.

## Before you begin

- `playwright-core` installed at the version the kit's `package.json` lists among its `peerDependencies`.
- Playwright's Chromium headless shell and WebKit, installed with `bunx playwright-core install --with-deps chromium-headless-shell webkit`.
- A `test:pixel` script set to `checks-test --tier=pixel`, as [checks-test-layout](../gates/checks-test-layout.md) says.

## Add a suite

To add a suite for one block:

1. Write a test file for Chromium under `tests/pixel/`, named for the block and the engine:

   ```ts
   import { join } from "node:path";
   import { blockScreens } from "@avi2dg/checks/block-screens.ts";

   blockScreens("chromium", {
     block: "footer",
     fixtures: join(import.meta.dir, "..", "fixtures", "footer-screens"),
     url: "http://localhost:4321/",
     selector: ".footer",
   });
   ```

1. Write the same file for `"webkit"` beside it.
1. Add `*.new.png` to `.gitignore`.
1. Run `bun run test:pixel`, which fails at each size until its first pictures are approved.
1. Approve them as [Approve new pictures](#approve-new-pictures) says.

`blockScreens` registers one test for each size, and each test opens the page in a fresh browser context for its device.
It waits for the fonts and every animation that ends, runs `setup` and takes the picture with animations stopped.

| Key | What it takes |
| --- | --- |
| `block` | the name each test opens with |
| `fixtures` | the folder of approved pictures, which holds one folder for each engine |
| `url` | the page that shows the block, or a function that returns a promise of it |
| `selector` | the element in the picture, which is the whole window when the key is left out |
| `setup` | a function that gets the page after it settles and before its picture, such as one that opens a menu |
| `sizes` | `anchor`, the default, or `full`, the sets [Screen sizes](../gates/checks-browser.md#screen-sizes) lists |
| `devices` | more devices of the repository's own, each made with `emulatedDevice` or `windowDevice` |
| `tolerance` | `channel`, how far a color channel may move before its pixel counts as changed, and `share`, the share of pixels that may change, both 0 when the key is left out |
| `timeoutMs` | how long each size may take, 60 seconds when the key is left out |

Each picture is compared with `<fixtures>/<engine>/<device>.png`, where the device name is lowercased and each run of other characters becomes one hyphen, as in `iphone-se-375x667.png`.
A phone picture comes from a phone the kit emulates, such as an iPhone SE at 375 by 667.
A picture that differs from its approved picture, or that has none, fails its test.
The failure names the device, its size and the engine, and the new picture is written beside the approved one as `<device>.new.png`.
A picture that matches removes any `.new.png` beside it.

## Approve new pictures

To approve the pictures of a block that changed on purpose:

1. Run `bun run test:pixel` and look at each `.new.png` it writes.
1. Run `APPROVE_SCREENS=1 bun run test:pixel`, which replaces each approved picture with the new one and removes its `.new.png`.
1. Look at every changed file in the fixtures folder before you commit it.

Approve mode passes every size, so it runs only once each new picture looks right.

## Build a suite from the parts

A repository whose test already opens the page uses the parts `blockScreens` is built from:

1. Take the devices from `screenDevices("anchor")`, and add the repository's own with `emulatedDevice` or `windowDevice`.
1. Open each page in a browser context with the device's `options`.
1. Wait with `settled(page)`, and take the picture with `pictureOf(page, selector)`.
1. Pass the picture to `matchesApproved(picture, { fixtures, engine, device, tolerance })`, which resolves to `AS_APPROVED` or to the failure, and expect `AS_APPROVED`.

## Related topics

- [checks-browser](../gates/checks-browser.md)
- [checks-test-layout](../gates/checks-test-layout.md)
