"use server";

import { markSetupReviewed } from "../get-started/review";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { APP_NAME_MAX, FAMILY_NAME_MAX, appNameFromFamilyName, appNameLength, cleanAppName } from "@/lib/app-name";
import { cleanMascotName, DEFAULT_MASCOT_NAME, MASCOT_NAME_MAX } from "@/lib/family-look";
import { checkRewardWords, DEFAULT_REWARD_WORDS, REWARD_PRESETS } from "@/lib/reward-words";
import { DEFAULT_THEME_COLOR, isThemeColorId } from "@/lib/theme-colors";

export type LookFormState = { error?: string; success?: boolean };

// Generous caps on the raw text, so an oversized post is refused before any cleaning; the
// real limits (counted in characters) are checked after.
const text = z.string().max(200, "That's too long.");

const lookSchema = z.object({
  familyName: text,
  themeColor: z.string().refine(isThemeColorId, "Pick one of the colors."),
  reward: text,
  rewardOne: text,
  rewardMany: text,
  rewardStore: text,
  mascot: z.enum(["on", "off"]),
  mascotName: text,
  appIcon: z.enum(["BUNNY", "LETTER"]),
});

/**
 * Phase 35: Settings → Make it yours, admin-only. Defaults are kept as null (the app's own
 * look), so a family that never touches this follows any future change to the defaults.
 */
export async function saveLook(_prev: LookFormState, formData: FormData): Promise<LookFormState> {
  const admin = await requireAdmin();
  const field = (name: string) => String(formData.get(name) ?? "");
  const parsed = lookSchema.safeParse({
    familyName: field("familyName"),
    themeColor: field("themeColor") || DEFAULT_THEME_COLOR,
    reward: field("reward"),
    rewardOne: field("rewardOne"),
    rewardMany: field("rewardMany"),
    rewardStore: field("rewardStore"),
    mascot: field("mascot"),
    mascotName: field("mascotName"),
    appIcon: field("appIcon"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something in the form isn't right." };
  const d = parsed.data;

  const appName = appNameFromFamilyName(d.familyName);
  if (appName && appNameLength(appName) > APP_NAME_MAX) {
    return { error: `Keep the family name to ${FAMILY_NAME_MAX} characters or fewer.` };
  }

  const preset = REWARD_PRESETS.find((p) => p.id === d.reward);
  const checked = preset ? { ok: true as const, words: preset } : checkRewardWords({ one: d.rewardOne, many: d.rewardMany, store: d.rewardStore });
  if (!checked.ok) return { error: checked.error };
  const isDefaultReward =
    checked.words.one === DEFAULT_REWARD_WORDS.one && checked.words.many === DEFAULT_REWARD_WORDS.many && checked.words.store === DEFAULT_REWARD_WORDS.store;

  const mascotName = cleanMascotName(d.mascotName);
  if (cleanAppName(d.mascotName) && !mascotName) return { error: `Keep the mascot's name to ${MASCOT_NAME_MAX} characters or fewer.` };

  await prisma.household.update({
    where: { id: admin.householdId },
    data: {
      appName,
      themeColor: d.themeColor === DEFAULT_THEME_COLOR ? null : d.themeColor,
      rewardOne: isDefaultReward ? null : checked.words.one,
      rewardMany: isDefaultReward ? null : checked.words.many,
      rewardStore: isDefaultReward ? null : checked.words.store,
      mascotOn: d.mascot === "on",
      mascotName: mascotName === DEFAULT_MASCOT_NAME ? null : mascotName,
      appIcon: d.appIcon,
    },
  });

  // Phase 45.4: the checklist's "Make it yours" is done once an admin has saved it.
  await markSetupReviewed(admin.householdId, "look");
  // Every page shows some of it: the top bar, titles, the store, the mascot.
  revalidatePath("/", "layout");
  return { success: true };
}
