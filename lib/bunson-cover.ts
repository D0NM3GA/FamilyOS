/** What someone could mean to tap under the corner mascot. */
const TAPPABLE = "a, button, input, select, textarea, label, summary, [role=button]";

type Box = { left: number; top: number; right: number; bottom: number };

/** Five spots across his tap area: inset, so a neighbor only touching his edge doesn't count. */
export function coverPoints({ left, top, right, bottom }: Box): [number, number][] {
  const x1 = left + 4;
  const x2 = right - 4;
  const y1 = top + 4;
  const y2 = bottom - 4;
  return [
    [x1, y1],
    [x2, y1],
    [x1, y2],
    [x2, y2],
    [(left + right) / 2, (top + bottom) / 2],
  ];
}

/** Whether he's sitting over something tappable. His own button doesn't count. */
export function coversControl(box: Box, elementsAt: (x: number, y: number) => Element[], own: Element): boolean {
  if (box.right - box.left <= 0 || box.bottom - box.top <= 0) return false;
  return coverPoints(box).some(([x, y]) =>
    elementsAt(x, y).some((el) => !own.contains(el) && el.closest(TAPPABLE) !== null),
  );
}
