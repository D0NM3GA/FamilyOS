"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { ROOM_H, ROOM_W } from "@/lib/pet/room";

/**
 * Phase 56: dragging things into, around and out of the room. A drag starts on a pointer
 * down (an item in the room, or one in the toy box tray) and follows the pointer anywhere on
 * the page; on letting go it says where, in room units, or null if that was outside the room.
 * A press that barely moves isn't a drag, so a tap still works as a tap.
 */

export type Dragged = { rowId: string; itemId: string };

export type DragState = Dragged & {
  /** Where the pointer is on the page, for the picture that follows it. */
  client: { x: number; y: number };
  /** Where it is in the room (room units), or null while it's outside the room. */
  point: { x: number; y: number } | null;
};

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

  const inRoom = useCallback(
    (x: number, y: number) => {
      const box = room.current?.getBoundingClientRect();
      if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      return { x: ((x - box.left) / box.width) * ROOM_W, y: ((y - box.top) / box.height) * ROOM_H };
    },
    [room],
  );

  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>, item: Dragged) => {
      if (event.button !== 0) return;
      stop.current();
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
        setDrag({ ...current.item, client: { x: e.clientX, y: e.clientY }, point: inRoom(e.clientX, e.clientY) });
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
        dropRef.current(current.item, inRoom(e.clientX, e.clientY));
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

  return { drag, start };
}
