/**
 * The Sticker Book's shared class strings, so every app's buttons, boxes and chips look and
 * behave the same instead of each page keeping its own copy (they had drifted into three
 * looks). Plain strings, not components: they mix with a page's own classes and work in
 * server and client components alike.
 *
 * Anything you tap is at least 44px tall on a phone (a thumb, not a mouse) and a little
 * tighter from `sm` up.
 */
const tap = "inline-flex min-h-11 items-center justify-center gap-1.5 sm:min-h-9";

export const pageTitle = "text-4xl font-extrabold leading-tight";

/** Small uppercase heading over a group ("Overdue", "Coming up"). */
export const sectionTitle = "text-xs font-extrabold uppercase tracking-wide text-muted-foreground";

/** The one main thing to do on a page or form ("+ New chore", "Save"). */
export const btnPrimary = `${tap} rounded-xl bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand-hover active:scale-95 disabled:opacity-50`;

/** Everything else (Print, Export, Manage, Cancel). */
export const btn = `${tap} rounded-xl px-3 text-sm font-bold text-muted-foreground ring-1 ring-input transition hover:bg-muted hover:text-foreground disabled:opacity-50`;

/** Remove / Delete. */
export const btnDanger = `${tap} rounded-xl px-3 text-sm font-bold text-destructive ring-1 ring-destructive/40 transition hover:bg-destructive/10 disabled:opacity-50`;

/** A filter or choice pill. `aria-current="page"` (links) or `aria-pressed` (buttons) marks the picked one. */
export const chip = `${tap} rounded-full border-2 border-ink/20 px-3 text-sm font-bold transition hover:bg-muted aria-[current=page]:border-ink aria-[current=page]:bg-sun aria-[current=page]:text-ink aria-pressed:border-ink aria-pressed:bg-sun aria-pressed:text-ink dark:border-white/20`;

/**
 * A row of chips: one line that scrolls sideways on a phone (three wrapped rows of names push
 * the list off the screen), wrapping from `sm` up. Bleeds to the page edge on phones, so it
 * assumes the page's 1rem phone padding.
 */
export const chipRow = "no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [&>*]:shrink-0 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0";

/** Round, icon-only (call, email, undo). Give it an aria-label. */
export const iconBtn = "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground sm:size-9";

/** "← Back to the list", "← Cars": above a sub-page's title. */
export const backLink = "inline-flex min-h-11 items-center text-sm font-bold text-muted-foreground hover:text-foreground hover:underline sm:min-h-0";

/** Text boxes and selects. Phones get 16px text whatever this says (app/globals.css). */
export const field = "min-h-11 rounded-xl border-2 border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none sm:min-h-9";

/** A field's label above it. */
export const fieldLabel = "text-xs font-extrabold uppercase tracking-wide text-muted-foreground";

export const card = "rounded-2xl border-2 border-ink bg-card p-4 dark:border-white/20";
