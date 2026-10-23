@AGENTS.md

You are building a family style CRM web app that will be served via a cloud VM. It is designed to serve my family on a daily level as an integral part of our lives. It is built to help us plan upcoming days, track our finances, be aware of items in the home such as groceries (papertowels, eggs, etc.), and to help us make more informed decisions and to ease management overhead, like you'd use a CRM at a business. Because of this usecase, the app needs to be practical, easy to use, follow modern UI/UX principles so that users can quickly familiarize with the apps by way of context. Because of the sensitive nature of the information that will be stored in this app, great care needs to be taken with security principles. Encryption, well designed auth and zero-trust principles are essential for the project to be considered a success. There is the opportunity for deep integration with Microsoft 365 via my families tenant. Opportunities to lean on Microsoft surfaces (Entra, Conditional Access, Intune, etc.) are preferred. There is no need to rebuild the wheel, this is not an attempt at any type of comercial product. This will only every be used for personal, non-commercial use from my family, by design. 

Things that should be taken into account:
* Use a real database (SQLite, PostgreSQL, MySQL) instead of flat files once you have relational data, concurrent writes, or need to query/filter. Flat files (HTML, JSON, CSV) are fine for static config or small read-only datasets, not for anything with users, transactions, or growth.
* Normalize data to avoid duplication, but don't over-normalize to the point queries become painful joins-of-joins.
* Never store secrets (API keys, passwords) in code or in a database in plaintext. Use environment variables + a secrets manager; hash passwords (bcrypt/argon2), never encrypt them reversibly.
* Separation of concerns: keep data access, business logic, and presentation (UI/API) in distinct layers. Don't put SQL queries inside your HTML templates.
* DRY (Don't Repeat Yourself), but don't force abstraction prematurely — duplicated code that's simple beats a clever wrong abstraction.
* Single Responsibility: a function/class should do one thing. If you can't name it without "and," split it.
* Consistent naming and formatting — use a linter/formatter (e.g., Prettier, Black, gofmt) so style isn't a manual decision every time.
* Small, atomic commits with meaningful messages. Not "fixed stuff."
* Branch per feature/fix, don't commit directly to main once anything depends on stability.
* .gitignore secrets, build artifacts, and dependencies (node_modules, .env).
* Validate and sanitize all external input (form data, URL params, API payloads) — this is what prevents SQL injection and XSS.
* Use parameterized queries / ORM query builders, never string-concatenated SQL.
* Principle of least privilege for database users and API tokens.
* HTTPS everywhere, no exceptions, even internal tools.
* Fail loudly in development, gracefully in production (don't leak stack traces to end users).
* Centralized, structured logging (not scattered print statements) so you can actually search issues later.
* Handle expected failure modes explicitly (network timeout, missing record) rather than letting exceptions bubble up uncaught.
* Automated tests (unit tests minimum) for anything with business logic. Manual click-testing doesn't scale and doesn't catch regressions.
* Test the critical paths first (auth, payments, data integrity), not 100% coverage for its own sake.
* Pin dependency versions (lockfiles: package-lock.json, requirements.txt with pinned versions) so "works on my machine" doesn't happen.
* Keep dev/staging/prod environments as close to identical as possible — this is the whole argument for containers (Docker).
* README with setup steps that actually work if you nuke your environment and start over.
* Comments explain why, not what — the code itself should show what it does.
* Keep the repo safe to open-source: no real family details anywhere (names, emails, domains, places, schools, accounts), and the app's name comes from each family's own setting (FamilyOS by default), never the code. See AGENTS.md "Privacy and naming"; run `npm run privacy:check` before every commit and PR.

Break up different segments where it makes sense into potentially smaller sub-apps (think Microsoft 365 admin center style, different pages for different apps) while keeping data flowing between them so that we can take advantage of the data everywhere (like a CRM)
