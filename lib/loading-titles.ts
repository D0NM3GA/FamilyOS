/**
 * Phase 39: the title each app's own landing page shows, so the loading screen can show it the
 * moment the app is tapped (app/(app)/loading.tsx). Only landing pages, and only the ones whose
 * title is plain text in the same place: anything deeper (a person, a jar, Settings' pages)
 * keeps the untitled skeleton rather than flash a title that isn't theirs. The Store's title is
 * the family's reward word, so the loading screen draws that one itself.
 * lib/loading-titles.test.ts checks each against its page.
 */
export const LOADING_TITLES: Readonly<Record<string, string>> = {
  "/people": "👪 People",
  "/calendar": "📅 Calendar",
  "/chores": "🧹 Chores",
  "/meds": "💊 Meds",
  "/groceries": "Groceries",
  "/school": "🎒 School",
  "/vehicles": "🚗 Cars",
  "/search": "🔎 Search",
  "/notifications": "🔔 Notifications",
};

/** The Store's landing page, whose title is the reward word (`<RewardWord form="store" />`). */
export const STORE_PATH = "/points";
