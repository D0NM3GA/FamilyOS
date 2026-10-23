"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isDeletableContact } from "@/lib/people";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult, requireAdult } from "@/lib/authz";
import { PersonColor } from "@/app/generated/prisma/enums";
import { isMembershipLocked } from "@/lib/household-members";

export type PersonFormState = { error?: string };

// Deliberately excludes "ADMIN" — that role is only ever set by the Entra claim sync in
// lib/active-profile.ts, never through this form (see prisma/schema.prisma's PersonRole
// doc comment and docs/BUILD.md Phase 4.5).
const personSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().optional(),
  email: z.string().trim().email("Not a valid email").optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  notesAdultsOnly: z.boolean(),
  isHouseholdMember: z.boolean(),
  role: z.enum(["ADULT", "KID"]).optional(),
  contactCadenceDays: z.coerce.number().int().positive().optional(),
  color: z.enum(PersonColor).optional(),
});

function parsePersonForm(formData: FormData) {
  const cadenceRaw = String(formData.get("contactCadenceDays") ?? "").trim();
  const raw = {
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    notesAdultsOnly: formData.get("notesAdultsOnly") === "on",
    isHouseholdMember: formData.get("isHouseholdMember") === "on",
    role: formData.get("role") ? String(formData.get("role")) : undefined,
    contactCadenceDays: cadenceRaw || undefined,
    color: formData.get("color") ? String(formData.get("color")) : undefined,
  };

  const parsed = personSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  }

  const data = parsed.data;
  return {
    data: {
      firstName: data.firstName,
      lastName: data.lastName || null,
      email: data.email || null,
      phone: data.phone || null,
      notes: data.notes || null,
      notesAdultsOnly: data.notesAdultsOnly,
      isHouseholdMember: data.isHouseholdMember,
      role: data.isHouseholdMember ? (data.role ?? "ADULT") : null,
      contactCadenceDays: data.contactCadenceDays ?? null,
      // Phase 19 sticker color — only household members get one (it drives profile tiles
      // and avatars); null falls back to a stable default (lib/person-color.ts).
      color: data.isHouseholdMember ? (data.color ?? null) : null,
    },
  } as const;
}

export async function createPerson(
  _prevState: PersonFormState,
  formData: FormData,
): Promise<PersonFormState> {
  const authPerson = await requireActiveProfile();
  const result = parsePersonForm(formData);
  if ("error" in result) return { error: result.error };

  // Only adults may add a household member (with a role attached) — a kid profile can
  // still add a plain external contact, just not toggle household-membership/role.
  const data = isAdult(authPerson)
    ? result.data
    : { ...result.data, isHouseholdMember: false, role: null, color: null };

  const person = await prisma.person.create({
    data: { householdId: authPerson.householdId, ...data },
  });

  redirect(`/people/${person.id}`);
}

export async function updatePerson(
  personId: string,
  _prevState: PersonFormState,
  formData: FormData,
): Promise<PersonFormState> {
  // Enforced here too, not just by the edit page's inline gate — this is a bound server
  // action, independently reachable regardless of what the page shows.
  const authPerson = await requireAdult();
  const result = parsePersonForm(formData);
  if ("error" in result) return { error: result.error };

  const existing = await prisma.person.findFirst({
    where: { id: personId, householdId: authPerson.householdId },
    omit: { photo: true },
  });
  if (!existing) return { error: "Person not found." };

  // Anyone SSO-linked to Entra has their role/membership locked here — only
  // lib/active-profile.ts's Entra claim sync may change it, so a form submit that tried to
  // change it (e.g. demoting a linked ADULT to KID) would just be silently flipped back on
  // their next sign-in. Preserves existing values rather than erroring, so the rest of the
  // form (name/contact info) still saves normally. This whole function is adult-only
  // (requireAdult() above), so no separate isAdult() branch is needed here.
  // Phase 38: the same for a restored Admin or jar member who hasn't signed in yet
  // (isMembershipLocked), so this form can't do what Settings → Household refuses to.
  const jarCount = existing.authUserId === null ? await prisma.moneyJarMember.count({ where: { personId } }) : 0;
  const data =
    isMembershipLocked({ ...existing, jarCount })
      ? {
          ...result.data,
          isHouseholdMember: existing.isHouseholdMember,
          role: existing.role,
          // Membership is preserved for linked people, so their color must be too —
          // parsePersonForm nulls it whenever the household box arrives unticked.
          color: existing.isHouseholdMember ? (result.data.color ?? existing.color) : null,
        }
      : result.data;

  // Phase 28.5: someone restored into a money jar who hasn't signed in yet gets it on their
  // first Microsoft sign-in, matched by this email. Changing it would hand their jar to
  // whoever signs in with the new address, so it waits until they've signed in. The message
  // doesn't say why: jars are private, and whoever edits People may not be in this one.
  const norm = (e: string | null | undefined) => e?.trim().toLowerCase() || null;
  if (existing.authUserId === null && norm(data.email) !== norm(existing.email) && jarCount > 0) {
    return { error: "This person's email can't change until they've signed in with Microsoft." };
  }

  await prisma.person.update({ where: { id: personId }, data });

  redirect(`/people/${personId}`);
}

/**
 * Removes a contact and everything logged about them (calls, dates, relationships). A med
 * that names them as prescriber or pharmacy just loses the link. Anyone who is or was part
 * of the household (isDeletableContact) is refused: members leave through Settings →
 * Household, which keeps their stickers, chores and school record.
 */
export async function deletePerson(personId: string): Promise<void> {
  const authPerson = await requireAdult();
  if (typeof personId !== "string" || personId.length > 64) redirect("/people");
  if (!(await isDeletableContact(personId, authPerson.householdId))) {
    throw new Error("Only plain contacts can be deleted; household members leave through Settings → Household.");
  }

  await prisma.person.delete({ where: { id: personId } });
  revalidatePath("/");
  redirect("/people");
}
