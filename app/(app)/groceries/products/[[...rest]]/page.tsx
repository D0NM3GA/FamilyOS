import { permanentRedirect } from "next/navigation";
import { requireAppOn } from "@/lib/app-guard";

/** Phase 22 renamed Products to Pantry. Old bookmarks land on the new page. */
export default async function ProductsMoved() {
  await requireAppOn("groceries");
  permanentRedirect("/groceries/pantry");
}
