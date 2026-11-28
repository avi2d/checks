import { Schema } from "effect";

const cronFields = [
  { name: "day-of-month", min: 1, max: 31, names: [] },
  { name: "month", min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] },
  { name: "weekday", min: 0, max: 6, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
] as const;

type CronField = (typeof cronFields)[number];

function cronValue(value: string, field: CronField): number | undefined {
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    return number >= field.min && number <= field.max ? number : undefined;
  }
  const index = (field.names as readonly string[]).indexOf(value.toUpperCase());
  return index < 0 ? undefined : index + field.min;
}

function validCronField(value: string, field: CronField): boolean {
  return value.split(",").every((item) => {
    const match = /^(\*|[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)?)(?:\/(\d+))?$/.exec(item);
    if (!match || (match[2] !== undefined && Number(match[2]) === 0)) return false;
    const base = match[1];
    if (base === undefined) return false;
    if (base === "*") return true;
    const [start, end] = base.split("-");
    if (start === undefined) return false;
    const first = cronValue(start, field);
    const last = end === undefined ? first : cronValue(end, field);
    return first !== undefined && last !== undefined && first <= last;
  });
}

const FLAKE_CRON_ANNOTATIONS = {
  description: "The UTC cron expression for the generated flake workflow, limited to at most once a day with one minute and one hour.",
};

export const FlakeCron = Schema.String.annotate(FLAKE_CRON_ANNOTATIONS).check(
  Schema.isPattern(/^[0-5]?[0-9][ \t]+(?:[01]?[0-9]|2[0-3])(?:[ \t]+[^\s]+){3}$/u, { message: "must be a five-field cron expression that runs at most once a day, with one minute from 0 to 59 and one hour from 0 to 23, such as 23 5 * * 1" }),
  Schema.makeFilter((cron) => {
    const fields = cron.split(/[ \t]+/);
    const invalid = cronFields.find((field, index) => !validCronField(fields[index + 2] ?? "", field));
    return invalid === undefined || `has an invalid ${invalid.name} field`;
  }, FLAKE_CRON_ANNOTATIONS),
);

