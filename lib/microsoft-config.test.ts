import { describe, expect, it } from "vitest";
import { microsoftConfigFrom } from "./microsoft-config";

const all = { MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "secret", MICROSOFT_TENANT_ID: "00000000-0000-4000-8000-000000000000" };

describe("Phase 40.1b: Microsoft sign-in is optional", () => {
  it("is off when none of it is set", () => {
    expect(microsoftConfigFrom({})).toBeNull();
    expect(microsoftConfigFrom({ MICROSOFT_CLIENT_ID: " ", MICROSOFT_CLIENT_SECRET: "", MICROSOFT_TENANT_ID: undefined })).toBeNull();
  });

  it("is on when all three are set", () => {
    expect(microsoftConfigFrom(all)).toEqual({ clientId: "id", clientSecret: "secret", tenantId: all.MICROSOFT_TENANT_ID });
  });

  it("stops on half a setup, naming what's missing", () => {
    expect(() => microsoftConfigFrom({ ...all, MICROSOFT_CLIENT_SECRET: "" })).toThrow(/MICROSOFT_CLIENT_SECRET missing/);
    expect(() => microsoftConfigFrom({ MICROSOFT_TENANT_ID: all.MICROSOFT_TENANT_ID })).toThrow(/MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET missing/);
  });

  it("takes the tenant's id or its domain, not a URL", () => {
    expect(() => microsoftConfigFrom({ ...all, MICROSOFT_TENANT_ID: "https://login.microsoftonline.com/x" })).toThrow(/not a URL/);
    expect(microsoftConfigFrom({ ...all, MICROSOFT_TENANT_ID: "parkers.onmicrosoft.com" })?.tenantId).toBe("parkers.onmicrosoft.com");
  });

  it("keeps sign-in pinned to one tenant", () => {
    for (const shared of ["common", "Organizations", "consumers"]) {
      expect(() => microsoftConfigFrom({ ...all, MICROSOFT_TENANT_ID: shared })).toThrow(/own tenant/);
    }
  });
});
