// The chase only reacts to mouse movement — a touch scroll-drag or a pen
// stroke near the bottom of the screen would otherwise drag Bunson along
// with it, since pointermove doesn't distinguish input types on its own. Pen
// hover (buttons === 0, no ink) is excluded too rather than special-cased:
// the surface area of getting that right isn't worth it for an easter egg,
// and a tap/click still reaches Bunson regardless of pointer type — only the
// horizontal follow is mouse-only.
export function chaseAcceptsPointer(pointerType: string): boolean {
  return pointerType === "mouse";
}
