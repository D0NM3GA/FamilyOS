import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { listPeople, fullName, type PeopleFilter } from "@/lib/people";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { PageMore } from "@/components/more-menu";
import { btn, btnPrimary, chip, chipRow, field } from "@/components/styles";
import { getDisabledApps } from "@/lib/app-switches";
import { isAppOn } from "@/lib/apps";
import { getHouseholdSettings } from "@/lib/household-settings";
import { badgeWords, peopleBadges } from "@/lib/work-items/badges";

const FILTERS: { value: PeopleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "member", label: "Household" },
  { value: "contact", label: "Contacts" },
];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const profile = await requireActiveProfile();
  const { q = "", filter: rawFilter } = await searchParams;
  const filter: PeopleFilter =
    rawFilter === "member" || rawFilter === "contact" ? rawFilter : "all";

  const people = await listPeople(profile.householdId, { query: q, filter });
  // Phase 59.4b: what's open for each household member, at a glance.
  // Only worth reading when a household member is on the list.
  const members = people.some((p) => p.isHouseholdMember);
  const [disabled, settings] = members ? await Promise.all([getDisabledApps(profile.householdId), getHouseholdSettings(profile.householdId)]) : [null, null];
  const badges = disabled ? await peopleBadges(profile, { chores: isAppOn(disabled, "chores"), school: isAppOn(disabled, "school") }) : new Map();
  const zone = settings?.timezone ?? undefined;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="👪 People">
        <Link href="/people/new" className={btnPrimary}>
          + Add person
        </Link>
        {/* Print gives exactly the list below: same search and filter. */}
        <PageMore
          items={[
            { label: "Print", href: { pathname: "/print/people", query: { ...(q ? { q } : {}), ...(filter !== "all" ? { filter } : {}) } } },
            ...(isAdult(profile) ? [{ label: "Export", href: "/data#people" }] : []),
          ]}
        />
      </PageHeader>

      <form className="mt-4 flex items-center gap-2" action="/people">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name, email, phone…"
          aria-label="Search people"
          className={`${field} min-w-0 flex-1 sm:w-64 sm:flex-none`}
        />
        <input type="hidden" name="filter" value={filter} />
        <button type="submit" className={btn}>
          Search
        </button>
      </form>

      <div className={`mt-3 ${chipRow}`}>
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={{ pathname: "/people", query: { q, filter: f.value } }}
            aria-current={filter === f.value ? "page" : undefined}
            className={chip}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg bg-card shadow-sm ring-1 ring-border">
        {people.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No one matches yet. Try a different search, or add someone new.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((person) => (
              <li key={person.id}>
                <Link
                  href={`/people/${person.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted"
                >
                  <LinkPending />
                  <Avatar
                    personId={person.id}
                    hasPhoto={person.photoContentType !== null}
                    initial={person.firstName}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {fullName(person)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[person.email, person.phone].filter(Boolean).join(" · ") || "No contact info"}
                    </p>
                    {person.isHouseholdMember && badges.has(person.id) && (
                      <p className="mt-0.5 flex flex-wrap gap-1">
                        {badgeWords(badges.get(person.id)!, zone).map((w) => (
                          <span
                            key={w}
                            className={`rounded-full px-1.5 text-xs font-bold ${
                              w.startsWith("Test")
                                ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                                : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                            }`}
                          >
                            {w}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {person.isHouseholdMember ? person.role ?? "Household" : "Contact"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
