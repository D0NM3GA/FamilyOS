/**
 * Where the item sheet goes back to: the list or the Pantry, keeping the Pantry's section
 * chip and search so closing (or saving) an item found by searching doesn't lose the search.
 * It ends up in a redirect, so nothing else survives: no other path, host or parameter.
 */

const PAGES = ["/groceries", "/groceries/pantry"];
const KEPT = ["filter", "q"];
const ORIGIN = "http://sheet.invalid";

export function sheetReturnPath(raw: unknown, add: { item?: string } = {}): string {
  let url: URL;
  try {
    url = new URL(typeof raw === "string" ? raw : "", ORIGIN);
  } catch {
    return "/groceries";
  }
  // "//elsewhere.com/groceries" and absolute URLs parse to another origin.
  if (url.origin !== ORIGIN || !PAGES.includes(url.pathname)) return "/groceries";

  const query = new URLSearchParams();
  for (const key of KEPT) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value.slice(0, 120));
  }
  if (add.item) query.set("item", add.item);
  const s = query.toString();
  return s ? `${url.pathname}?${s}` : url.pathname;
}
