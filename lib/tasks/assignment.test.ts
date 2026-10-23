import { describe, expect, test } from "vitest";
import { pickAssignee, type PriorInstance } from "./assignment";

const POOL = ["alice", "bob", "carol"];

describe("pickAssignee — FIXED", () => {
  test("always returns the first person in the pool, regardless of history", () => {
    const history: PriorInstance[] = [
      { assignedToId: "carol", dueDate: new Date(2026, 0, 1) },
      { assignedToId: "bob", dueDate: new Date(2026, 0, 2) },
    ];
    expect(pickAssignee("FIXED", POOL, history)).toBe("alice");
    expect(pickAssignee("FIXED", POOL, [])).toBe("alice");
  });
});

describe("pickAssignee — ROUND_ROBIN", () => {
  test("starts at the first pool member when there's no history", () => {
    expect(pickAssignee("ROUND_ROBIN", POOL, [])).toBe("alice");
  });

  test("advances to the next person after the most recent assignment", () => {
    const history: PriorInstance[] = [{ assignedToId: "alice", dueDate: new Date(2026, 0, 1) }];
    expect(pickAssignee("ROUND_ROBIN", POOL, history)).toBe("bob");
  });

  test("wraps around from the last pool member back to the first", () => {
    const history: PriorInstance[] = [{ assignedToId: "carol", dueDate: new Date(2026, 0, 1) }];
    expect(pickAssignee("ROUND_ROBIN", POOL, history)).toBe("alice");
  });

  test("uses the most recent assignment by dueDate, not array order", () => {
    const history: PriorInstance[] = [
      { assignedToId: "carol", dueDate: new Date(2026, 0, 3) },
      { assignedToId: "alice", dueDate: new Date(2026, 0, 1) },
      { assignedToId: "bob", dueDate: new Date(2026, 0, 2) },
    ];
    // most recent is carol (Jan 3) -> next is alice (wraps)
    expect(pickAssignee("ROUND_ROBIN", POOL, history)).toBe("alice");
  });

  test("ignores history entries for people no longer in the pool", () => {
    const history: PriorInstance[] = [{ assignedToId: "dave", dueDate: new Date(2026, 0, 5) }];
    expect(pickAssignee("ROUND_ROBIN", POOL, history)).toBe("alice");
  });
});

describe("pickAssignee — LEAST_ASSIGNED", () => {
  test("picks whoever has the fewest prior assignments", () => {
    const history: PriorInstance[] = [
      { assignedToId: "alice", dueDate: new Date(2026, 0, 1) },
      { assignedToId: "alice", dueDate: new Date(2026, 0, 2) },
      { assignedToId: "bob", dueDate: new Date(2026, 0, 3) },
    ];
    expect(pickAssignee("LEAST_ASSIGNED", POOL, history)).toBe("carol");
  });

  test("ties break to the first pool member with the minimum count", () => {
    const history: PriorInstance[] = [{ assignedToId: "alice", dueDate: new Date(2026, 0, 1) }];
    // alice=1, bob=0, carol=0 -> bob wins the tie (comes first in pool order after alice)
    expect(pickAssignee("LEAST_ASSIGNED", POOL, history)).toBe("bob");
  });

  test("with no history, everyone is tied at zero and the first pool member wins", () => {
    expect(pickAssignee("LEAST_ASSIGNED", POOL, [])).toBe("alice");
  });
});

describe("pickAssignee — empty pool", () => {
  test("returns null for every strategy when there's no one to assign", () => {
    expect(pickAssignee("FIXED", [], [])).toBeNull();
    expect(pickAssignee("ROUND_ROBIN", [], [])).toBeNull();
    expect(pickAssignee("LEAST_ASSIGNED", [], [])).toBeNull();
  });
});
