import { describe, expect, it } from "vitest";
import { appRoleSql, urlParts } from "../scripts/app-role.mjs";

const owner = "postgresql://familyos:ownerpw@db:5432/familyos?schema=public";

describe("the app's database login (Phase 61c)", () => {
  it("does nothing when both URLs are the same login", () => {
    expect(appRoleSql(owner, owner).skip).toMatch(/same login/);
  });

  it("grants data rights only, and defaults for the owner's later tables", () => {
    const { roleSql, grantSql, role } = appRoleSql("postgresql://familyos_app:apppw@db/familyos?schema=public", owner);
    const sql = String(roleSql) + String(grantSql);
    // The password is never in the script that grants (a failing grant is logged whole).
    expect(String(grantSql)).not.toContain("apppw");
    expect(role).toBe("familyos_app");
    expect(sql).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "familyos_app";`);
    expect(sql).toContain(`REVOKE INSERT, UPDATE, DELETE ON TABLE "public"."_prisma_migrations" FROM "familyos_app";`);
    expect(sql).toContain(`ALTER DEFAULT PRIVILEGES FOR ROLE "familyos" IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "familyos_app";`);
    expect(sql).toContain("NOSUPERUSER NOCREATEDB NOCREATEROLE");
    expect(sql).not.toMatch(/GRANT (ALL|CREATE)/);
  });

  it("decodes the password and quotes it so it can't end the statement", () => {
    const pw = "it's; DROP TABLE person;--";
    const { roleSql } = appRoleSql(`postgresql://familyos_app:${encodeURIComponent(pw)}@db:5432/familyos`, owner);
    expect(roleSql).toContain(`PASSWORD 'it''s; DROP TABLE person;--';`);
    expect(urlParts(`postgresql://a:${encodeURIComponent("p@ss/w:rd%")}@h/d`).password).toBe("p@ss/w:rd%");
  });

  it("refuses odd names, a missing password and a different database", () => {
    expect(() => appRoleSql("postgresql://App-User:pw@db:5432/familyos", owner)).toThrow(/lowercase/);
    expect(() => appRoleSql("postgresql://familyos_app@db:5432/familyos", owner)).toThrow(/password/);
    expect(() => appRoleSql("postgresql://familyos_app:pw@db:5432/other", owner)).toThrow(/same database/);
  });
});
