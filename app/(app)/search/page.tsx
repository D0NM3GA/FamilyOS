import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { searchHousehold } from "@/lib/search";
import { getDisabledApps } from "@/lib/app-switches";
import { appsOffFor } from "@/lib/apps";
import { PageHeader } from "@/components/page-header";
import { field, sectionTitle } from "@/components/styles";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const profile = await requireActiveProfile();
  const { q } = await searchParams;
  // A repeated ?q=a&q=b query string arrives as an array despite the type above being
  // written for the single-value case — take the first rather than letting .trim() throw.
  const rawQuery = Array.isArray(q) ? q[0] : q;
  const query = rawQuery?.trim() ?? "";

  const groups = query
    ? await searchHousehold(profile.householdId, query, {
        viewerIsAdult: isAdult(profile),
        disabledApps: appsOffFor(isAdult(profile), await getDisabledApps(profile.householdId)),
      })
    : [];

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="🔎 Search" />

      <form action="/search" method="get" className="mt-4 max-w-xl">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search people, chores, meds, groceries, rewards, school…"
          aria-label="Search the household"
          autoFocus
          className={`${field} w-full`}
        />
      </form>

      {!query && (
        <p className="mt-4 text-sm text-muted-foreground">Start typing to search the household.</p>
      )}
      {query && groups.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;.</p>
      )}

      <div className="mt-6 space-y-6">
        {groups.map((group) => (
          <div key={group.title}>
            <h2 className={sectionTitle}>{group.title}</h2>
            <ul className="mt-2 space-y-1">
              {group.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground ring-1 ring-transparent transition hover:bg-card hover:text-foreground hover:ring-border sm:min-h-0"
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.sublabel && (
                      <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">{item.sublabel}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
