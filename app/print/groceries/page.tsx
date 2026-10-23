import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getOrCreateActiveList } from "@/lib/shopping-list";
import { getListItems, groupBySection, groupItemsByStore } from "@/lib/groceries/queries";
import { amountLabel, describeSize } from "@/lib/groceries/size";
import { CheckBox, PrintEmpty, PrintSection, PrintShell } from "@/components/print/print-shell";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Shopping list" };

/**
 * The paper shopping list: still-needed items only, by store, then under section headings
 * in the Shop view's aisle order (groupItemsByStore, then groupBySection). Kid-viewable — the on-screen list has no adult
 * gate either. Note getOrCreateActiveList is an upsert, the same read-time pattern the
 * /groceries page itself uses.
 */
export default async function GroceriesPrintPage() {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  const [household, list] = await Promise.all([
    getHouseholdSettings(profile.householdId),
    getOrCreateActiveList(profile.householdId),
  ]);
  const items = (await getListItems(list.id)).filter((i) => !i.done);
  const grouped = groupItemsByStore(items);

  return (
    <PrintShell
      title="Shopping list"
      subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
      householdName={household.name}
      backHref="/groceries"
    >
      {grouped.length === 0 ? (
        <div className="mt-6">
          <PrintEmpty>Nothing on the list right now.</PrintEmpty>
        </div>
      ) : (
        grouped.map(({ storeName, items: storeItems }) => {
          const sections = groupBySection(storeItems);
          // A store whose items have no sections at all needs no "Other" heading.
          const headed = sections.some((s) => s.section);
          return (
            <PrintSection key={storeName} title={storeName}>
              <div className="space-y-3">
                {sections.map(({ section, items: sectionItems }) => (
                  <div key={section?.name ?? ""}>
                    {headed && (
                      // Not break-inside-avoid on the whole section (see PrintSection): just
                      // never leave a heading alone at the foot of a page.
                      <h3 className="mb-1 break-after-avoid-page text-xs font-semibold uppercase tracking-wide text-stone-500">
                        {section ? `${section.emoji ? `${section.emoji} ` : ""}${section.name}` : "Other"}
                      </h3>
                    )}
                    <ul className="space-y-1.5 text-sm">
                      {sectionItems.map((item) => {
                        const size = describeSize(item.product);
                        return (
                          <li key={item.id} className="flex items-baseline gap-2">
                            <CheckBox />
                            <span className="flex-1">
                              <span className="font-medium">{item.product.name}</span>
                              <span className="text-stone-600"> · {amountLabel(item.quantity, item.product.container)}</span>
                              {size && <span className="text-stone-500"> · {size}</span>}
                              {item.product.brand && <span className="text-stone-500"> · {item.product.brand}</span>}
                              {item.requestedBy && <span className="text-stone-500"> · for {item.requestedBy.firstName}</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </PrintSection>
          );
        })
      )}
    </PrintShell>
  );
}
