import { PRODUCT_NAME } from "@/lib/app-name";

/**
 * How this server introduces itself to outside services that ask for a contact in the
 * User-Agent (api.weather.gov's terms, Open Food Facts): the product's name, never the
 * family's, and the address of whoever runs this install from CONTACT_EMAIL, so the repo
 * itself carries no one's real address. NWS_CONTACT_EMAIL is the setting's older name.
 */
export function outboundUserAgent(): string {
  const contact = process.env.CONTACT_EMAIL?.trim() || process.env.NWS_CONTACT_EMAIL?.trim() || "no-contact-set@example.com";
  return `${PRODUCT_NAME}/0.1 (${contact})`;
}
