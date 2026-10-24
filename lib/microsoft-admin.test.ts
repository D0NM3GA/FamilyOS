import { describe, expect, it } from "vitest";
import { entraUsersAndGroupsUrl, mailboxPowerShell } from "./microsoft-admin";

const CLIENT = "11111111-2222-4333-8444-555555555555";
const SP = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";

describe("Microsoft admin pointers (Phase 53)", () => {
  it("links to the app's Users and groups page in Entra, ids only", () => {
    expect(entraUsersAndGroupsUrl(SP, CLIENT)).toBe(
      `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/~/UsersAndGroups/objectId/${SP.toLowerCase()}/appId/${CLIENT}`,
    );
    expect(entraUsersAndGroupsUrl(null, CLIENT)).toBeNull();
    expect(entraUsersAndGroupsUrl(SP, undefined)).toBeNull();
    expect(entraUsersAndGroupsUrl("../../evil", CLIENT)).toBeNull();
  });

  it("fills in the Exchange PowerShell with the ids and the mailbox, and nothing else", () => {
    const text = mailboxPowerShell(CLIENT, SP, "alerts@example.com")!;
    expect(text.split("\n")).toEqual([
      "Connect-ExchangeOnline",
      `New-ServicePrincipal -AppId ${CLIENT} -ObjectId ${SP} -DisplayName "FamilyOS"`,
      `New-ManagementScope -Name "FamilyOS mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'alerts@example.com'"`,
      `New-ManagementRoleAssignment -App ${CLIENT} -Role "Application Mail.Send" -CustomResourceScope "FamilyOS mailbox"`,
      `Test-ServicePrincipalAuthorization -Identity ${CLIENT} -Resource alerts@example.com`,
    ]);
  });

  it("won't put a value that could break out of the command into it", () => {
    expect(mailboxPowerShell(CLIENT, SP, "a'; Remove-Mailbox x@example.com")).toBeNull();
    expect(mailboxPowerShell(CLIENT, SP, "a$(x)@example.com")).toBeNull();
    expect(mailboxPowerShell("not-a-guid", SP, "alerts@example.com")).toBeNull();
    expect(mailboxPowerShell(CLIENT, null, "alerts@example.com")).toBeNull();
  });
});
