export const cronFields = [
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

export function validCronField(value: string, field: CronField): boolean {
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

