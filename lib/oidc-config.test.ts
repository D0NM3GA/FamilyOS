import { describe, expect, test } from "vitest";
import { oidcConfigFrom } from "./oidc-config";

const full = {
  OIDC_DISCOVERY_URL: "https://id.example.com/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "familyos",
  OIDC_CLIENT_SECRET: "s3cret",
  OIDC_NAME: "Example ID",
};

describe("oidcConfigFrom", () => {
  test("none set is off; all set is on, with the default scopes", () => {
    expect(oidcConfigFrom({})).toBeNull();
    expect(oidcConfigFrom(full)).toEqual({
      name: "Example ID",
      discoveryUrl: full.OIDC_DISCOVERY_URL,
      clientId: "familyos",
      clientSecret: "s3cret",
      scopes: ["openid", "email", "profile"],
    });
  });

  test("some but not all stops, naming what's missing", () => {
    expect(() => oidcConfigFrom({ ...full, OIDC_CLIENT_SECRET: " " })).toThrow("OIDC_CLIENT_SECRET missing");
  });

  test("https only, except a test provider on this machine outside production", () => {
    expect(() => oidcConfigFrom({ ...full, OIDC_DISCOVERY_URL: "http://id.example.com/.well-known/openid-configuration" })).toThrow("https://");
    expect(oidcConfigFrom({ ...full, OIDC_DISCOVERY_URL: "http://127.0.0.1:5556/.well-known/openid-configuration" })?.discoveryUrl).toContain("127.0.0.1");
    expect(() =>
      oidcConfigFrom({ ...full, NODE_ENV: "production", OIDC_DISCOVERY_URL: "http://127.0.0.1:5556/.well-known/openid-configuration" }),
    ).toThrow("https://");
    expect(() => oidcConfigFrom({ ...full, OIDC_DISCOVERY_URL: "https://user:pw@id.example.com/x" })).toThrow("user name or password");
    expect(() => oidcConfigFrom({ ...full, OIDC_DISCOVERY_URL: "not a url" })).toThrow("isn't a web address");
  });

  test("a short, plain name, and scopes that include openid and email", () => {
    expect(() => oidcConfigFrom({ ...full, OIDC_NAME: "<b>Evil</b>" })).toThrow("OIDC_NAME");
    expect(() => oidcConfigFrom({ ...full, OIDC_NAME: "x".repeat(31) })).toThrow("OIDC_NAME");
    expect(oidcConfigFrom({ ...full, OIDC_SCOPES: "openid email groups" })?.scopes).toEqual(["openid", "email", "groups"]);
    expect(() => oidcConfigFrom({ ...full, OIDC_SCOPES: "openid profile" })).toThrow('"email"');
  });
});
