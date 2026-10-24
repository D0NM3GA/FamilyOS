import { PRODUCT_NAME } from "@/lib/app-name";

/**
 * Phase 53: ready-to-use pointers into the family's own Microsoft 365 admin pages, filled in
 * from what the app already knows (its client id, its enterprise app's object id, the alert
 * mailbox). Pure text: nothing here calls Microsoft. Anything that isn't the shape Microsoft
 * uses comes back null, so a stray value never lands in a link or a command.
 */

const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAILBOX = /^[^@\s'"`$;|&<>()]+@[^@\s'"`$;|&<>()]+\.[^@\s'"`$;|&<>()]+$/;

export const isGuid = (v: string | null | undefined): v is string => typeof v === "string" && GUID.test(v);

/** The app's Users and groups page in the Entra admin center, where its roles are given out. */
export function entraUsersAndGroupsUrl(servicePrincipalId: string | null | undefined, clientId: string | null | undefined): string | null {
  if (!isGuid(servicePrincipalId) || !isGuid(clientId)) return null;
  return `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/~/UsersAndGroups/objectId/${servicePrincipalId.toLowerCase()}/appId/${clientId.toLowerCase()}`;
}

/**
 * Exchange Online PowerShell that lets the app send as this one mailbox (RBAC for Applications,
 * README "Alerts"). The scope's name uses the product name, never the family's.
 */
export function mailboxPowerShell(clientId: string | null | undefined, servicePrincipalId: string | null | undefined, mailbox: string): string | null {
  if (!isGuid(clientId) || !isGuid(servicePrincipalId) || !MAILBOX.test(mailbox)) return null;
  const scope = `${PRODUCT_NAME} mailbox`;
  return [
    "Connect-ExchangeOnline",
    `New-ServicePrincipal -AppId ${clientId} -ObjectId ${servicePrincipalId} -DisplayName "${PRODUCT_NAME}"`,
    `New-ManagementScope -Name "${scope}" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '${mailbox}'"`,
    `New-ManagementRoleAssignment -App ${clientId} -Role "Application Mail.Send" -CustomResourceScope "${scope}"`,
    `Test-ServicePrincipalAuthorization -Identity ${clientId} -Resource ${mailbox}`,
  ].join("\n");
}
