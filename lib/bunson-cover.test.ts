import { describe, expect, it } from "vitest";
import { coverPoints, coversControl } from "./bunson-cover";

const el = (tappable: boolean) => ({ closest: () => (tappable ? {} : null) }) as unknown as Element;
const own = { contains: (other: Element) => other === mine } as unknown as Element;
const mine = el(true);
const box = { left: 100, top: 100, right: 140, bottom: 124 };

describe("coversControl", () => {
  it("is true when something tappable is under him", () => {
    expect(coversControl(box, () => [mine, el(false), el(true)], own)).toBe(true);
  });
  it("ignores his own button and plain content", () => {
    expect(coversControl(box, () => [mine, el(false)], own)).toBe(false);
  });
  it("is false with no size, when he's hidden by a page's own moment", () => {
    expect(coversControl({ left: 0, top: 0, right: 0, bottom: 0 }, () => [el(true)], own)).toBe(false);
  });
  it("finds a control under only one spot", () => {
    const [x, y] = coverPoints(box)[4];
    expect(coversControl(box, (px, py) => (px === x && py === y ? [el(true)] : []), own)).toBe(true);
  });
});
