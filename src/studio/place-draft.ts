import { POI_LIMITS, type PoiDetail, type UpdatePoiBody } from '../../shared/types';

// Editable state of an existing place (the /studio/place/:id form), what is wrong with it, and the PATCH body for what changed.

export interface PlaceDraft {
  name: string;
  category: string;
  aliases: string[];
  /** what has been typed into the alias box but not added yet; it is saved with the rest */
  aliasText: string;
  /** as typed, so a half-written number does not jump around */
  radius: string;
}

export function draftOf(p: PoiDetail): PlaceDraft {
  return { name: p.name, category: p.category, aliases: mergeAliases([], p.aliases ?? []), aliasText: '', radius: String(p.radius) };
}

/** The server splits a string of aliases on these. */
export const splitAliases = (text: string): string[] =>
  text
    .split(/[,，;；、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function mergeAliases(list: readonly string[], add: readonly string[]): string[] {
  const out = [...list];
  for (const a of add) if (!out.includes(a)) out.push(a);
  return out;
}

/** The aliases the place will have once saved: the added ones plus whatever is still in the box. */
export const aliasesOf = (d: PlaceDraft): string[] => mergeAliases(d.aliases, splitAliases(d.aliasText));

/** Matching radius in metres, or null when the text is not a number within the range the API takes. */
export function parseRadius(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= POI_LIMITS.radiusMin && n <= POI_LIMITS.radiusMax ? n : null;
}

export interface PlaceProblems {
  name?: string;
  aliases?: string;
  radius?: string;
}

const chars = (s: string) => [...s].length;

/** What the server would refuse, in the server's words, so the form can say so before sending. */
export function problemsOf(d: PlaceDraft): PlaceProblems {
  const out: PlaceProblems = {};
  const name = chars(d.name.trim());
  if (name < 1 || name > POI_LIMITS.nameMax) out.name = `地点名称不能为空，且最多 ${POI_LIMITS.nameMax} 个字符`;
  if (aliasesOf(d).length > POI_LIMITS.aliasCount) out.aliases = `别名最多 ${POI_LIMITS.aliasCount} 个`;
  if (parseRadius(d.radius) === null) out.radius = `匹配半径需要在 ${POI_LIMITS.radiusMin} 到 ${POI_LIMITS.radiusMax} 米之间`;
  return out;
}

/** Only the fields that differ from the saved place. */
export function diffDraft(base: PlaceDraft, cur: PlaceDraft): UpdatePoiBody {
  const body: UpdatePoiBody = {};
  const name = cur.name.trim();
  if (name !== base.name.trim()) body.name = name;
  if (cur.category !== base.category) body.category = cur.category;
  const radius = parseRadius(cur.radius);
  if (radius !== null && radius !== parseRadius(base.radius)) body.radius = radius;
  const aliases = aliasesOf(cur);
  if (JSON.stringify(aliases) !== JSON.stringify(aliasesOf(base))) body.aliases = aliases;
  return body;
}

// The radius slider steps through round numbers, which include the default of every category (`CATEGORY_RADIUS`);
// a straight 10 to 5000 scale would put everyone's 30 to 600 into the first tenth of the track.
export const RADIUS_STOPS = [
  10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000
];

/** The step closest to a radius, by ratio. */
export function nearestStop(radius: number): number {
  let best = 0;
  for (let i = 1; i < RADIUS_STOPS.length; i++) {
    if (Math.abs(Math.log(radius / RADIUS_STOPS[i])) < Math.abs(Math.log(radius / RADIUS_STOPS[best]))) best = i;
  }
  return best;
}
