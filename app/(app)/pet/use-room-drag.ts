"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { ROOM_H, ROOM_W } from "@/lib/pet/room";

/**
 * Phase 56: dragging things into, around and out of the room. A drag starts on a pointer
 * down (an item in the room, or one in the toy box tray) and follows the pointer anywhere on
 * the page; on letting go it says where, in room units, or null if that was outside the room.
 * A press that barely moves isn't a drag, so a tap still works as a tap.
 *
 * Phase 56.1: where it's held stays under the pointer. `grab` is how far the thing's bottom
 * center (where it stands, lib/pet/room.ts) is from the pointer, so the point reported is where
 * it would stand, not where the pointer is, and nothing jumps when it's picked up.
 */

export type Dragged = { rowId: string; itemId: string };

export type DragState = Dragged & {
  /** Where the pointer is on the page, for the picture that follows it. */
  client: { x: number; y: number };
  /** Where it would stand in the room (room units), or null while the pointer is outside it. */
  point: { x: number; y: number } | null;
};

/** From the pointer to where the dragged thing stands, in room units. */
export type Grab = { dx: number; dy: number };

/** Pixels a press has to move before it counts as a drag. */
const DRAG_START_PX = 6;

export function useRoomDrag(room: RefObject<HTMLElement | null>, onDrop: (dragged: Dragged, point: { x: number; y: number } | null) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const press = useRef<{ item: Dragged; startX: number; startY: number; moved: boolean } | null>(null);
  // The latest drop handler, so a drag in progress uses the screen as it is when it ends.
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  });

  // Inside the room's border, where the drawing is: the border isn't part of the room.
  const inRoom = useCallback(
    (x: number, y: number) => {
      const el = room.current;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const left = box.left + el.clientLeft;
      const top = box.top + el.clientTop;
      if (x < left || x > left + el.clientWidth || y < top || y > top + el.clientHeight) return null;
      return { x: ((x - left) / el.clientWidth) * ROOM_W, y: ((y - top) / el.clientHeight) * ROOM_H };
    },
    [room],
  );

  /** How far a press is from a point in the room, in room units (for a grab). */
  const toRoomUnits = useCallback(
    (x: number, y: number) => {
      const el = room.current;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { x: ((x - box.left - el.clientLeft) / el.clientWidth) * ROOM_W, y: ((y - box.top - el.clientTop) / el.clientHeight) * ROOM_H };
    },
    [room],
  );

  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  const start = useCallback(
    (event: ReactPointerEvent<Element>, item: Dragged, grab: Grab = { dx: 0, dy: 0 }) => {
      if (event.button !== 0) return;
      // A press that might be a drag neither starts selecting text nor moves focus (to the page's
      // main area, the nearest focusable thing around a picture in the toy box).
      event.preventDefault();
      stop.current();
      const standsAt = (x: number, y: number) => {
        const point = inRoom(x, y);
        return point && { x: point.x + grab.dx, y: point.y + grab.dy };
      };
      press.current = { item, startX: event.clientX, startY: event.clientY, moved: false };

      const move = (e: PointerEvent) => {
        const current = press.current;
        if (!current) return;
        if (!current.moved && Math.hypot(e.clientX - current.startX, e.clientY - current.startY) < DRAG_START_PX) return;
        if (!current.moved) {
          // No text selection under a drag that started over words.
          window.getSelection()?.removeAllRanges();
          document.body.style.userSelect = "none";
        }
        current.moved = true;
        setDrag({ ...current.item, client: { x: e.clientX, y: e.clientY }, point: standsAt(e.clientX, e.clientY) });
      };
      const up = (e: PointerEvent) => {
        const current = press.current;
        stop.current();
        if (!current?.moved) return;
        // The click that follows letting go isn't a tap on whatever it was dropped on (or on
        // the button the drag started from, which a touch keeps hold of).
        const swallow = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
        dropRef.current(current.item, standsAt(e.clientX, e.clientY));
      };
      const cancel = () => stop.current();

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      stop.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        press.current = null;
        document.body.style.userSelect = "";
        setDrag(null);
      };
    },
    [inRoom],
  );

  return { drag, start, toRoomUnits };
}
