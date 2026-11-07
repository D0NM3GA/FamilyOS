/**
 * Phase 62: who counts as a grown-up for reminders. Household members with role ADULT or ADMIN
 * whose Entra access hasn't ended. The bell reaches them even without a sign-in of their own;
 * what leaves the app follows lib/alerts/dispatch.ts. Pure, and kept here rather than borrowed
 * from Money's rule (lib/finance may not be imported outside it).
 */
export type PersonLike = { id: string; role: string | null; entraAccessEndedAt: Date | null };

export function grownUpsOf<P extends PersonLike>(people: P[]): P[] {
  return people.filter((p) => (p.role === "ADULT" || p.role === "ADMIN") && p.entraAccessEndedAt == null);
}
