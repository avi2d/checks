import { Effect, Schema } from "effect";
import type { Page } from "playwright-core";
import type { Roles, Visit } from "./declaration.ts";
import { attempt, BrowserFailure } from "./page.ts";

const PROPERTIES = ["color", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "font-family"] as const;

type Property = (typeof PROPERTIES)[number];

const LABEL_CHARS = 48;

const Look = Schema.Struct({
  color: Schema.String,
  "font-size": Schema.String,
  "font-weight": Schema.String,
  "line-height": Schema.String,
  "letter-spacing": Schema.String,
  "text-transform": Schema.String,
  "font-family": Schema.String,
});

type Look = typeof Look.Type;

const Text = Schema.Struct({
  role: Schema.NullOr(Schema.String),
  element: Schema.String,
  text: Schema.String,
  look: Look,
  untokened: Schema.Array(Schema.Literals(PROPERTIES)),
});

type Text = typeof Text.Type;

const Reading = Schema.Struct({ tokens: Schema.Int, texts: Schema.Array(Text) });

export type Reading = typeof Reading.Type;

const decodeReading = Schema.decodeUnknownEffect(Reading);

// A reveal on scroll shows its text only once scrolled to, so the page is scrolled through before it is read.
const SCROLL_THROUGH = `(async () => {
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const step = Math.max(1, Math.floor(window.innerHeight / 2));
  for (let at = 0; at < document.documentElement.scrollHeight; at += step) {
    window.scrollTo({ top: at, behavior: "instant" });
    await frames();
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  await frames();
})()`;

// A line height is read as a ratio of the font size and a letter spacing in em of it, so a token in rem and one without a unit compare by what they draw.
// A family is read as the one the stack names first, since the fallbacks after it draw only where that face fails to load.
// A probe sits beside the element it stands for, so em, % and container units resolve where the element resolves them.
const READ_LOOK = `(roles) => {
  for (const animation of document.getAnimations()) {
    if (animation.timeline !== document.timeline) continue;
    try {
      if (animation.effect && animation.effect.getComputedTiming().endTime !== Infinity) animation.finish();
    } catch {}
  }
  const names = new Set();
  const collect = (rules) => {
    for (const rule of rules) {
      if (rule instanceof CSSPropertyRule) names.add(rule.name);
      if (rule.style) {
        for (let index = 0; index < rule.style.length; index += 1) {
          const name = rule.style[index];
          if (name.startsWith("--")) names.add(name);
        }
      }
      if (rule.cssRules) collect(rule.cssRules);
      if (rule.styleSheet) {
        try { collect(rule.styleSheet.cssRules); } catch {}
      }
    }
  };
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    try { collect(sheet.cssRules); } catch {}
  }
  const tokens = [...names];
  const round = (value, places) => String(Math.round(value * 10 ** places) / 10 ** places);
  const lookOf = (style) => {
    const size = parseFloat(style.fontSize);
    return {
      color: style.color,
      "font-size": round(size, 2) + "px",
      "font-weight": style.fontWeight,
      "line-height": style.lineHeight === "normal" ? "normal" : round(parseFloat(style.lineHeight) / size, 3),
      "letter-spacing": style.letterSpacing === "normal" ? "0em" : round(parseFloat(style.letterSpacing) / size, 3) + "em",
      "text-transform": style.textTransform,
      "font-family": /^\\s*("[^"]*"|'[^']*'|[^,]*)/.exec(style.fontFamily)[1].trim(),
    };
  };
  const scrollWidth = document.documentElement.scrollWidth;
  const scrollHeight = document.documentElement.scrollHeight;
  const clip = (rect, box) => ({
    left: Math.max(rect.left, box.left),
    top: Math.max(rect.top, box.top),
    right: Math.min(rect.right, box.right),
    bottom: Math.min(rect.bottom, box.bottom),
  });
  const shows = (node, owner) => {
    const style = getComputedStyle(owner);
    if (style.visibility !== "visible") return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    let rects = [...range.getClientRects()];
    let pageClipsX = true;
    let pageClipsY = true;
    for (let at = owner; at; at = at.parentElement) {
      const around = getComputedStyle(at);
      if (around.opacity === "0") return false;
      const scrollsX = ["auto", "scroll"].includes(around.overflowX);
      const scrollsY = ["auto", "scroll"].includes(around.overflowY);
      if (scrollsX) pageClipsX = false;
      if (scrollsY) pageClipsY = false;
      const clipX = ["hidden", "clip"].includes(around.overflowX);
      const clipY = ["hidden", "clip"].includes(around.overflowY);
      const mask = around.clipPath !== "none" || around.clip !== "auto";
      if (clipX || clipY || mask || scrollsX || scrollsY) {
        const bounds = at.getBoundingClientRect();
        const content = { left: bounds.left - at.scrollLeft, top: bounds.top - at.scrollTop, right: bounds.left - at.scrollLeft + at.scrollWidth, bottom: bounds.top - at.scrollTop + at.scrollHeight };
        rects = rects.map((rect) => ({
          left: (clipX || mask) ? Math.max(rect.left, bounds.left) : scrollsX ? Math.max(rect.left, content.left) : rect.left,
          right: (clipX || mask) ? Math.min(rect.right, bounds.right) : scrollsX ? Math.min(rect.right, content.right) : rect.right,
          top: (clipY || mask) ? Math.max(rect.top, bounds.top) : scrollsY ? Math.max(rect.top, content.top) : rect.top,
          bottom: (clipY || mask) ? Math.min(rect.bottom, bounds.bottom) : scrollsY ? Math.min(rect.bottom, content.bottom) : rect.bottom,
        }));
      }
    }
    const page = { left: -scrollX, top: -scrollY, right: scrollWidth - scrollX, bottom: scrollHeight - scrollY };
    rects = rects.map((rect) => ({
      left: pageClipsX ? Math.max(rect.left, page.left) : rect.left,
      top: pageClipsY ? Math.max(rect.top, page.top) : rect.top,
      right: pageClipsX ? Math.min(rect.right, page.right) : rect.right,
      bottom: pageClipsY ? Math.min(rect.bottom, page.bottom) : rect.bottom,
    }));
    return rects.some((rect) => rect.right - rect.left > 1 && rect.bottom - rect.top > 1);
  };
  const describe = (owner) => {
    const id = owner.id ? "#" + owner.id : "";
    const classes = [...owner.classList].map((one) => "." + one).join("");
    return owner.localName + id + classes;
  };
  const owners = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const owner = node.parentElement;
    if (owner === null || seen.has(owner) || (node.textContent ?? "").trim() === "") continue;
    if (!shows(node, owner)) continue;
    seen.add(owner);
    const style = getComputedStyle(owner);
    owners.push({
      owner,
      role: roles.find(({ selectors }) => selectors.some((selector) => owner.matches(selector)))?.name ?? null,
      element: describe(owner),
      text: (owner.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, ${LABEL_CHARS}),
      look: lookOf(style),
      streams: tokens.map((name) => style.getPropertyValue(name).trim()).filter((stream) => stream !== ""),
      size: style.fontSize,
      parentSize: owner.parentElement ? getComputedStyle(owner.parentElement).fontSize : style.fontSize,
      parentColor: owner.parentElement ? getComputedStyle(owner.parentElement).color : style.color,
    });
  }
  const resolved = new Map();
  const probes = new Map();
  let parents = 0;
  const parentIds = new WeakMap();
  const probeIn = (parent) => {
    let probe = probes.get(parent);
    if (probe === undefined) {
      probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      parent.appendChild(probe);
      probes.set(parent, probe);
    }
    return probe;
  };
  const tokenValue = (entry, property, stream) => {
    const parent = entry.owner.parentElement ?? entry.owner;
    if (!parentIds.has(parent)) parentIds.set(parent, (parents += 1));
    const local = /cq(?:[iwhb]|min|max)|%/.test(stream) ? parentIds.get(parent) : "";
    const key = [property, stream, entry.size, entry.parentSize, entry.parentColor, local].join("|");
    if (resolved.has(key)) return resolved.get(key);
    const probe = probeIn(parent);
    probe.style.cssText = "position:absolute!important;visibility:hidden!important;pointer-events:none!important;transition:none!important;animation:none!important";
    if (property === "line-height" || property === "letter-spacing") probe.style.setProperty("font-size", entry.size, "important");
    probe.style.setProperty(property, stream, "important");
    const value = probe.style.getPropertyValue(property) === "" ? null : lookOf(getComputedStyle(probe))[property];
    resolved.set(key, value);
    return value;
  };
  const exempt = { "letter-spacing": "0em", "text-transform": "none" };
  const texts = owners.map((entry) => {
    const untokened = Object.keys(entry.look).filter((property) => {
      const value = entry.look[property];
      if (exempt[property] === value) return false;
      return !entry.streams.some((stream) => tokenValue(entry, property, stream) === value);
    });
    return { role: entry.role, element: entry.element, text: entry.text, look: entry.look, untokened };
  });
  for (const probe of probes.values()) probe.remove();
  return { tokens: tokens.length, texts };
}`;

export const readLook = Effect.fn("readLook")(function* (page: Page, roles: Roles) {
  yield* attempt("cannot scroll the page through", () => page.evaluate(SCROLL_THROUGH));
  const named = Object.entries(roles).map(([name, selectors]) => ({ name, selectors }));
  const read: unknown = yield* attempt("cannot read the look of the text", () => page.evaluate(`(${READ_LOOK})(${JSON.stringify(named)})`));
  return yield* decodeReading(read).pipe(Effect.mapError(() => new BrowserFailure({ message: "the page gave a reading of its text that does not decode" })));
});

type Reference = {
  readonly look: Look;
  readonly element: string;
  readonly text: string;
  readonly path: string;
};

export type FirstLooks = Map<string, Reference>;

type LookReport = {
  readonly found: readonly string[];
  readonly inventory: readonly string[];
};

const named = ({ element, text }: { readonly element: string; readonly text: string }): string => `${element} "${text}"`;

const alike = (count: number): string => (count > 1 ? ` and ${count - 1} more alike` : "");

function grouped<A>(items: readonly A[], keyOf: (item: A) => string): readonly (readonly [A, number])[] {
  const groups = new Map<string, [A, number]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item, 1]);
    else group[1] += 1;
  }
  return [...groups.values()];
}

const differences = (look: Look, reference: Look): readonly Property[] => PROPERTIES.filter((property) => look[property] !== reference[property]);

function roleDrift(texts: readonly Text[], firstLooks: FirstLooks, visit: Visit): readonly string[] {
  const found: string[] = [];
  const roles = [...new Set(texts.flatMap(({ role }) => (role === null ? [] : [role])))];
  for (const role of roles) {
    const key = `${visit.viewport.name}|${visit.state.name}|${role}`;
    const played = texts.filter((text) => text.role === role);
    const [first] = played;
    if (first !== undefined && !firstLooks.has(key)) firstLooks.set(key, { look: first.look, element: first.element, text: first.text, path: visit.route.path });
    const reference = firstLooks.get(key);
    if (reference === undefined) continue;
    const drifting = played.filter(({ look }) => differences(look, reference.look).length > 0);
    for (const [text, count] of grouped(drifting, ({ look }) => JSON.stringify(look))) {
      const where = reference.path === visit.route.path ? "" : ` at ${reference.path}`;
      const changed = differences(text.look, reference.look).map((property) => `${property} ${text.look[property]}, not ${reference.look[property]}`);
      found.push(`role ${role} ${named(text)}${alike(count)} differs from ${named(reference)}${where} in ${changed.join("; ")}`);
    }
  }
  return found;
}

export function judgeLook(reading: Reading, firstLooks: FirstLooks, visit: Visit): LookReport {
  const { texts, tokens } = reading;
  if (texts.length === 0) return { found: ["scanned no visible text"], inventory: [`${tokens} token(s)`] };
  const unmatched = texts.filter(({ role }) => role === null);
  const untokened = texts.flatMap((text) => text.untokened.map((property) => ({ ...text, property, value: text.look[property] })));
  const found = [
    ...roleDrift(texts, firstLooks, visit),
    ...grouped(unmatched, ({ element }) => element).map(([text, count]) => `${named(text)}${alike(count)} matches no role`),
    ...grouped(untokened, ({ property, value }) => `${property} ${value}`).map(
      ([text, count]) => `${text.property} ${text.value} of ${named(text)}${alike(count)} equals no declared token`,
    ),
  ];
  const roleCounts = grouped(texts.flatMap(({ role }) => (role === null ? [] : [role])), (role) => role).map(([role, count]) => `${role} ${count}`);
  const inventory = [...roleCounts, ...(unmatched.length === 0 ? [] : [`no role ${unmatched.length}`]), `${tokens} token(s)`];
  return { found, inventory };
}
