/** Pure date helpers (no Obsidian dependency, unit-testable). */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local ISO without timezone: matches the helper's yyyy-MM-dd'T'HH:mm:ss parser. */
export function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Stable per-day id, also the cache key. */
export function dayStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Extract a date from a note basename with a (year, month, day) regex. */
export function parseDateFromBasename(name: string, pattern: string): Date | null {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return null;
  }
  const m = re.exec(name);
  if (!m || m.length < 4) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return startOfDay(dt);
}

export function prettyDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function period(d: Date): string {
  return d.getHours() < 12 ? "AM" : "PM";
}

/** "6 PM", "6:30 PM" — drops :00 to save width. */
export function compactTime(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? `:${pad(m)}` : ""} ${period(d)}`;
}

/** "6–9 PM", "6–9:30 PM", "11 AM–1 PM". */
export function compactTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const end = compactTime(e);
  if (period(s) === period(e)) {
    const start = compactTime(s).replace(/ [AP]M$/, "");
    return `${start}–${end}`;
  }
  return `${compactTime(s)}–${end}`;
}
