"use server";

import { parseItemRef } from "@/lib/work-items/history";
import { completeInstance, skipInstance, uncompleteInstance, unskipInstance } from "./chores/actions";
import { setAssignmentStatus, setTaskStatus } from "./school/actions";

/**
 * Phase 59.4a: the status pill in the list view and the side panel, for any kind of item. It only
 * picks the domain's own action, which checks everything itself: who may, which household, and
 * what the item is now.
 */
export async function setWorkItemStatus(ref: string, from: string, to: string): Promise<{ milestone?: number | null } | void> {
  const item = parseItemRef(ref);
  if (!item) throw new Error("Unknown item");
  if (item.type === "CHORE") {
    if (to === "DONE") return completeInstance(item.id);
    if (to === "SKIPPED") return skipInstance(item.id);
    if (to === "PENDING" && from === "DONE") return uncompleteInstance(item.id);
    if (to === "PENDING" && from === "SKIPPED") return unskipInstance(item.id);
    throw new Error("Unknown status");
  }
  if (item.type === "ASSIGNMENT") {
    if (to !== "TODO" && to !== "DONE" && to !== "MISSING") throw new Error("Unknown status");
    return setAssignmentStatus(item.id, to);
  }
  if (to !== "OPEN" && to !== "DONE") throw new Error("Unknown status");
  return setTaskStatus(item.id, to);
}
