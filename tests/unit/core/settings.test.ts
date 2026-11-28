import { expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { FlakeCron } from "../../../src/core/settings.ts";

const decodeFlakeCron = Schema.decodeUnknownOption(FlakeCron);

test("generated schema retains the platform description and binary pattern instead of dropping them", async () => {
  const schema = await Bun.file(new URL("../../../dist/checks.schema.json", import.meta.url)).json();
  const properties = schema.properties.workflows.properties.platformPackages.properties;
  expect(properties.platforms.description).toBe("The platforms to build on and publish a package for.");
  expect(properties.binary.pattern).toBe("^[a-z0-9][a-z0-9._-]*$");
});

test.each([
  "*/5 * * * *",
  "* * * * *",
  "0 */2 * * *",
  "0,30 5 * * *",
  "0 3,15 * * *",
  "0-30 5 * * *",
  "0 3-15 * * *",
])("flakeCron rejects multiple daily start times in %s", (cron) => {
  expect(Option.isNone(decodeFlakeCron(cron))).toBe(true);
});

test.each(["60 5 * * *", "0 24 * * *", "23 5 * *", "23 5 * * 1 extra"])("flakeCron rejects invalid clock fields or field counts in %s", (cron) => {
  expect(Option.isNone(decodeFlakeCron(cron))).toBe(true);
});

test.each(["0 0 * * *", "59 23 * * *", "23 5 * * 1", "23 5 * * MON,THU"])("flakeCron does not reject a daily or weekly schedule in %s", (cron) => {
  expect(decodeFlakeCron(cron)).toEqual(Option.some(cron));
});
