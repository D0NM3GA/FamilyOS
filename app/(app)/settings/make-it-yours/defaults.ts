import { prisma } from "@/lib/prisma";
import { familyNameOf } from "@/lib/app-name";
import { LOOK_SELECT } from "@/lib/family-look";
import { rewardPresetId, rewardWordsOf } from "@/lib/reward-words";
import { themeColorOf } from "@/lib/theme-colors";

/**
 * What the Make it yours form starts from: the stored values, not the resolved look (a blank
 * field means "the default", so the form shows blanks rather than the defaults spelled out).
 * Shared by the page and the guided setup (Phase 45.4).
 */
export async function lookFormDefaults(householdId: string) {
  const row = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: LOOK_SELECT });
  const words = rewardWordsOf(row);
  return {
    familyName: familyNameOf(row.appName),
    themeColor: themeColorOf(row.themeColor).id,
    reward: rewardPresetId(words),
    rewardWords: words,
    mascotOn: row.mascotOn,
    mascotName: row.mascotName ?? "",
    appIcon: row.appIcon,
  };
}
