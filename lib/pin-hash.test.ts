import { describe, expect, it } from "vitest";
import argon2 from "argon2";
import { hashPin, verifyPin } from "./pin-hash";

describe("PIN hashing", () => {
  it("argon2id with the spelled-out settings, and a right PIN needs no rehash", async () => {
    const hash = await hashPin("482913");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
    expect(await verifyPin(hash, "482913")).toEqual({ ok: true, rehashed: null });
    expect(await verifyPin(hash, "482914")).toEqual({ ok: false, rehashed: null });
  });

  it("a PIN hashed with older, weaker settings is upgraded the next time it's used", async () => {
    const old = await argon2.hash("1234", { type: argon2.argon2i, memoryCost: 4096, timeCost: 2, parallelism: 1 });
    const result = await verifyPin(old, "1234");
    expect(result.ok).toBe(true);
    expect(result.rehashed).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
    expect(await verifyPin(result.rehashed!, "1234")).toEqual({ ok: true, rehashed: null });
    // A wrong PIN never triggers one.
    expect(await verifyPin(old, "4321")).toEqual({ ok: false, rehashed: null });
  });
});
