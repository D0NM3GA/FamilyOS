import { describe, expect, it } from "vitest";
import { ScanGate } from "./scan-gate";

const A = "0049000006582";
const B = "0012345678905";

describe("ScanGate", () => {
  it("needs two identical reads in a row", () => {
    const gate = new ScanGate();
    expect(gate.observe(A, 0)).toBeNull();
    expect(gate.observe(A, 100)).toBe(A);
  });

  it("a blank frame or a different code in between starts over", () => {
    const gate = new ScanGate();
    gate.observe(A, 0);
    expect(gate.observe(null, 50)).toBeNull();
    expect(gate.observe(A, 100)).toBeNull();
    gate.observe(B, 150);
    expect(gate.observe(A, 200)).toBeNull();
    expect(gate.observe(A, 250)).toBe(A);
  });

  it("accepts nothing while a submission is in flight", () => {
    const gate = new ScanGate();
    gate.observe(A, 0);
    gate.observe(A, 100);
    expect(gate.busy).toBe(true);
    for (let t = 200; t < 5000; t += 100) {
      expect(gate.observe(A, t)).toBeNull();
      expect(gate.observe(B, t + 50)).toBeNull();
    }
  });

  it("ignores the same code for the cooldown, timed from when the result came back", () => {
    const gate = new ScanGate(2, 3000);
    gate.observe(A, 0);
    gate.observe(A, 100);
    gate.settle(A, 10_000); // a slow lookup
    gate.observe(A, 12_000);
    expect(gate.observe(A, 12_900)).toBeNull(); // confirmed, but still cooling down
    expect(gate.observe(A, 13_000)).toBe(A);
  });

  it("a different code goes straight through after settling", () => {
    const gate = new ScanGate();
    gate.observe(A, 0);
    gate.observe(A, 100);
    gate.settle(A, 200);
    gate.observe(B, 300);
    expect(gate.observe(B, 400)).toBe(B);
  });

  it("holding the camera on one can adds it once per cooldown, never per frame", () => {
    const gate = new ScanGate(2, 3000);
    let submissions = 0;
    for (let t = 0; t < 10_000; t += 125) {
      const code = gate.observe(A, t);
      if (code) {
        submissions++;
        gate.settle(code, t + 400);
      }
    }
    expect(submissions).toBe(3); // at 125 ms, then the first frames after each 3 s cooldown
  });

  it("after a failed submission the same code can be retried at once", () => {
    const gate = new ScanGate();
    gate.observe(A, 0);
    gate.observe(A, 100);
    gate.release();
    expect(gate.busy).toBe(false);
    gate.observe(A, 200);
    expect(gate.observe(A, 300)).toBe(A);
  });
});
