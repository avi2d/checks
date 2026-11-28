import { randomBytes } from "node:crypto";

const ENTROPY_FLOOR = 3.0;

const entropy = (text: string) =>
  [...Map.groupBy(text, (character) => character).values()].reduce((sum, { length }) => sum - (length / text.length) * Math.log2(length / text.length), 0);

// The secret rules refuse a body whose entropy is under 2.5 to 3.0, and a plain random hex string can fall under that.
export const hex = (bytes: number): string => {
  const text = randomBytes(bytes).toString("hex");
  return entropy(text) >= ENTROPY_FLOOR ? text : hex(bytes);
};
