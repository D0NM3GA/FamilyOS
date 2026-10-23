<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Privacy and naming

This repository must be safe to publish as open source at any time: nothing in it may teach a
stranger about the family that runs it.

- **The app is FamilyOS, and each family makes its copy its own** (Settings → Make it yours:
  the name, colors, reward word, mascot and icon, on `Household`). Never write a product or
  family name, or the reward word, into UI copy: server code uses `getFamilyLook`,
  `getAppName` and `getRewardWords` (`lib/household-settings.ts`); client components
  `useAppName()`, `useRewardWords()`, `<RewardWord>` and `<Wordmark>`
  (`components/family-look.tsx`). Help text can just say "the app". Anything that leaves the
  server for an outside service (User-Agent headers, Sentry, ids inside files, the icon
  renderer's fonts) uses `PRODUCT_NAME` from `lib/app-name.ts`, never the family's choices.
- **No real personal details anywhere**: code, comments, tests, fixtures, seeds, docs, commit
  messages, branch names, PR titles and bodies. That means no real names (family, friends,
  teachers, doctors), emails, domains, phone numbers, street, town or region, schools,
  employers, banks, utilities or local businesses tied to the family, account numbers, health
  details, or amounts from real accounts.
- **Use the made-up family** for examples, fixtures and demo data: Dad, Mom, Grandma, Grandpa,
  kids Ivy and Max, contacts with the surname Parker (or Example), `example.com` / `.example` /
  `.test` addresses, `(555) 010-xxxx` phone numbers. Credit decisions to "the owner" ("owner's
  call, Phase 12"), not to a person.
- **Real values live in `.env` or the database only**: the first admin comes from
  `SEED_ADMIN_*`, outside-service contacts from `CONTACT_EMAIL`, the app name from Settings.
- **Run `npm run privacy:check` before every commit and pull request** and fix every hit. It
  checks files, the branch name, unpushed commits and the git identity against
  `.git/info/privacy-terms`, the family's own term list, which is never committed. Never
  copy a term from that list into the repo, a commit or a PR. Commit with the GitHub noreply
  address, not a personal one.
- **No hidden characters in source.** Zero-width, soft-hyphen, bidi and byte-order-mark
  characters go in as backslash-u escapes, never raw; `privacy:check` flags raw ones. File
  tools can turn a typed escape into the raw character, so check after writing one.

# Forms

- **A server action's submit button is `SubmitButton`** (`components/submit.tsx`): it's
  disabled while the form is busy, so a double tap can't run the action twice. A plain
  submit button only in a form that posts to a URL, or when its own `disabled` reads the
  form's pending state (`useActionState`).
- **Destructive actions ask first, in place** (the owner's call): `ConfirmSubmit` in a form,
  `ConfirmAction` outside one. `lib/forms-guard.test.ts` enforces both; a deliberate one-tap
  exception goes in its list with the reason.

# Settings screens

- **Lists show only what can be changed** (the owner's call). No "Always on" or "Always
  here" rows or badges: leave fixed items out (Settings → Apps doesn't list Home, People,
  Data or Settings), or, when an item can still be edited but not removed, keep it without a
  badge. If someone might wonder where something went, say it once in the page's intro.
  Note each such call in docs/BUILD.md and the README.


# Guides

- **Keep docs/guides current** (the owner's call): when a phase changes what admins or the
  family do or see, update `docs/guides/admin.md` and `docs/guides/family.md` in the same
  pull request. They follow the privacy rules above: the made-up Parker family, `example.com`,
  and "the app", never a product or family name.
