import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/graph/app-token", () => ({ getAppGraphToken: async () => "app-token", GRAPH_SCOPE: "scope", invalidateAppToken: vi.fn() }));

const { readEntraAssignments, EntraGraphError } = await import("@/lib/entra-graph");
const { invalidateAppToken } = await import("@/lib/graph/app-token");

const GRAPH = "https://graph.microsoft.com/v1.0";
const CLIENT = "11111111-2222-4333-8444-555555555555";
const ADMIN_ROLE = "aaaaaaaa-0000-4000-8000-000000000001";
const ADULT_ROLE = "aaaaaaaa-0000-4000-8000-000000000002";
const KID_ROLE = "aaaaaaaa-0000-4000-8000-000000000003";
const OFF_ROLE = "aaaaaaaa-0000-4000-8000-000000000004";
const DEFAULT_ROLE = "00000000-0000-0000-0000-000000000000";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A small Graph: routes by path, each answer a function so a test can change one. */
function graph(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const answer = routes[url];
    if (!answer) throw new Error(`unexpected ${url}`);
    return answer();
  });
}

const sp = () =>
  json({
    id: "sp-1",
    appRoles: [
      { id: ADMIN_ROLE, value: "Admin", isEnabled: true },
      { id: ADULT_ROLE, value: "Adult", isEnabled: true },
      { id: KID_ROLE, value: "Kid", isEnabled: true },
      { id: OFF_ROLE, value: "Admin", isEnabled: false },
    ],
  });
const SP_URL = `${GRAPH}/servicePrincipals(appId='${CLIENT}')?$select=id,appRoles`;
const ASSIGN_URL = `${GRAPH}/servicePrincipals/sp-1/appRoleAssignedTo?$select=principalId,principalType,appRoleId`;

describe("readEntraAssignments", () => {
  test("direct users and a group's direct members; Admin beats Adult; Kid, disabled, default and app assignments give nothing", async () => {
    const fetchFn = graph({
      [SP_URL]: sp,
      [ASSIGN_URL]: () =>
        json({
          value: [
            { principalId: "DAD-OID", principalType: "User", appRoleId: ADMIN_ROLE },
            { principalId: "adults-group", principalType: "Group", appRoleId: ADULT_ROLE },
            { principalId: "kid-oid", principalType: "User", appRoleId: KID_ROLE },
            { principalId: "off-oid", principalType: "User", appRoleId: OFF_ROLE },
            { principalId: "default-oid", principalType: "User", appRoleId: DEFAULT_ROLE },
            { principalId: "app-oid", principalType: "ServicePrincipal", appRoleId: ADMIN_ROLE },
          ],
          "@odata.nextLink": `${ASSIGN_URL}&$skiptoken=2`,
        }),
      [`${ASSIGN_URL}&$skiptoken=2`]: () => json({ value: [{ principalId: "mom-oid", principalType: "User", appRoleId: ADMIN_ROLE }] }),
      [`${GRAPH}/groups/adults-group/members`]: () =>
        json({
          value: [
            { "@odata.type": "#microsoft.graph.user", id: "mom-oid" },
            { "@odata.type": "#microsoft.graph.user", id: "grandma-oid" },
            // A group inside the group: Entra doesn't pass the assignment down, nor does this.
            { "@odata.type": "#microsoft.graph.group", id: "nested-group" },
          ],
        }),
    });
    const assigned = await readEntraAssignments({ fetchFn, token: async () => "t", clientId: CLIENT });
    expect(Object.fromEntries(assigned)).toEqual({ "dad-oid": "ADMIN", "mom-oid": "ADMIN", "grandma-oid": "ADULT" });
    expect(fetchFn.mock.calls.map((c) => String(c[0]))).not.toContain(`${GRAPH}/groups/nested-group/members`);
  });

  test("a missing permission, an outage, a strange answer or a page elsewhere is an error, never a short list", async () => {
    const read = (routes: Record<string, () => Response>) => readEntraAssignments({ fetchFn: graph(routes), token: async () => "t", clientId: CLIENT });
    await expect(read({ [SP_URL]: sp, [ASSIGN_URL]: () => json({}, 403) })).rejects.toMatchObject({ code: "permission" });
    await expect(read({ [SP_URL]: () => json({}, 503) })).rejects.toMatchObject({ code: "unavailable" });
    await expect(read({ [SP_URL]: () => json({}, 429) })).rejects.toMatchObject({ code: "unavailable" });
    await expect(read({ [SP_URL]: () => json({ id: "sp-1" }) })).rejects.toMatchObject({ code: "unexpected" });
    await expect(read({ [SP_URL]: sp, [ASSIGN_URL]: () => json({ value: [], "@odata.nextLink": "https://evil.example.com/next" }) })).rejects.toMatchObject({
      code: "unexpected",
    });
    await expect(read({ [SP_URL]: sp, [ASSIGN_URL]: () => json({ notAList: true }) })).rejects.toMatchObject({ code: "unexpected" });
    await expect(
      readEntraAssignments({
        fetchFn: vi.fn(async () => {
          throw new Error("offline");
        }),
        token: async () => "t",
        clientId: CLIENT,
      }),
    ).rejects.toBeInstanceOf(EntraGraphError);
    await expect(readEntraAssignments({ fetchFn: graph({}), token: async () => "t", clientId: "not-a-guid" })).rejects.toMatchObject({ code: "config" });
    await expect(readEntraAssignments({ fetchFn: graph({}), token: async () => "t", clientId: "-".repeat(36) })).rejects.toMatchObject({ code: "config" });
    // A secret that no longer works is the app's settings, not Entra being away.
    await expect(
      readEntraAssignments({
        fetchFn: graph({ [SP_URL]: sp }),
        token: async () => {
          throw new Error("token endpoint 401");
        },
        clientId: CLIENT,
      }),
    ).rejects.toMatchObject({ code: "config" });
  });

  test("a 401 gets one fresh token and one retry", async () => {
    let first = true;
    const fetchFn = graph({
      [SP_URL]: () => {
        if (first) {
          first = false;
          return json({}, 401);
        }
        return sp();
      },
      [ASSIGN_URL]: () => json({ value: [{ principalId: "dad-oid", principalType: "User", appRoleId: ADMIN_ROLE }] }),
    });
    expect(Object.fromEntries(await readEntraAssignments({ fetchFn, token: async () => "t", clientId: CLIENT }))).toEqual({ "dad-oid": "ADMIN" });
    expect(invalidateAppToken).toHaveBeenCalled();
    await expect(readEntraAssignments({ fetchFn: graph({ [SP_URL]: () => json({}, 401) }), token: async () => "t", clientId: CLIENT })).rejects.toMatchObject({
      code: "permission",
    });
  });
});
