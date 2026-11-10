import { describe, expect, test } from "vitest";
import { productionAppUrlProblem } from "./app-url";

const prod = (url?: string) => productionAppUrlProblem({ NODE_ENV: "production", BETTER_AUTH_URL: url });

describe("BETTER_AUTH_URL in production", () => {
  test("https is fine, and http only on this machine", () => {
    expect(prod("https://family.example")).toBeNull();
    expect(prod("http://localhost:3100")).toBeNull();
    expect(prod("http://127.0.0.1:3000")).toBeNull();
    expect(prod("http://[::1]:3000")).toBeNull();
    expect(prod("http://family.example")).toMatch(/https/);
    expect(prod("http://localhost.family.example")).toMatch(/https/);
  });

  test("missing or not an address is refused", () => {
    expect(prod(undefined)).toMatch(/isn't set/);
    expect(prod("  ")).toMatch(/isn't set/);
    expect(prod("family.example")).toMatch(/web address/);
  });

  test("development and the build are left alone", () => {
    expect(productionAppUrlProblem({ NODE_ENV: "development", BETTER_AUTH_URL: "http://dev.example:3000" })).toBeNull();
    expect(productionAppUrlProblem({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBeNull();
  });
});
