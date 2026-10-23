# The admin guide

For whoever runs the server: setting it up, letting the family in, keeping it backed up, and
getting back in when something breaks. The family's own guide is [family.md](family.md).

This guide pulls together what's spread across the [README](../../README.md),
[docs/PLAN.md](../PLAN.md) and [docs/BUILD.md](../BUILD.md), checked against the code and
scripts as of Phase 45 plus Phases 42 and 43 (October 2026). It's kept current every phase.
Screenshots come once the screens settle after Phase 44.

In the examples the household is the made-up Parker family (Dad, Mom, Grandma, Grandpa, kids Ivy
and Max), the address is `familyos.example.com`, and `<you>` is your own user on the server.
Swap in your own.

**Contents**

1. [What you need](#1-what-you-need)
2. [Choose the address for good](#2-choose-the-address-for-good)
3. [The server](#3-the-server)
4. [The settings file and the secrets](#4-the-settings-file-and-the-secrets)
5. [Cloudflare](#5-cloudflare)
6. [Microsoft 365 (optional)](#6-microsoft-365-optional)
7. [First start](#7-first-start)
8. [First run: setup and the guided setup](#8-first-run-setup-and-the-guided-setup)
9. [People and sign-in](#9-people-and-sign-in)
10. [Make it yours, and turning apps off](#10-make-it-yours-and-turning-apps-off)
11. [Alerts](#11-alerts)
12. [Backups](#12-backups)
13. [Restoring, and the restore drill](#13-restoring-and-the-restore-drill)
14. [Break-glass: when Cloudflare is down](#14-break-glass-when-cloudflare-is-down)
15. [Updating and rolling back](#15-updating-and-rolling-back)
16. [Logs and troubleshooting](#16-logs-and-troubleshooting)
17. [Security in plain words](#17-security-in-plain-words)
18. [A routine](#18-a-routine)

---

## 1. What you need

- **A server.** The reference setup is a Debian VM on Proxmox: 2 cores, 4 GB of memory and
  32 GB of disk is plenty. Give it a fixed address on your router (break-glass needs it).
- **A domain on Cloudflare DNS**, and a free Cloudflare Zero Trust account. The app is reached
  through a Cloudflare Tunnel, so no router ports are opened.
- **A way for the family to prove who they are to Cloudflare:** the family's Microsoft 365
  accounts (Microsoft Entra), or one-time codes sent to their email addresses.
- **A password manager**, for the settings file and the keys in it.
- **A NAS share** (or any network share you can mount on the VM) for the nightly backup copies.
- **Optional:** a Microsoft 365 tenant, for Microsoft sign-in, the Outlook calendar, Teams and
  email alerts, order emails and receipt reading. Without it, grown-ups sign in with passkeys
  (the device's own fingerprint, face or PIN).

## 2. Choose the address for good

Pick the address the family will use, for example `https://familyos.example.com`, **before
anyone makes a passkey**. Passkeys are bound to that exact hostname: change it later and every
passkey stops working, and everyone has to be invited again. It goes in `BETTER_AUTH_URL`.

## 3. The server

1. **Install Debian**, then **Docker from Docker's own packages** (docs.docker.com, "Install
   Docker Engine on Debian"; that brings the `docker compose` plugin) and `git`.
2. **Only you in the `docker` group.** Anyone in it can read the app's settings
   (`docker inspect`) and is as good as root on the VM.

   ```bash
   sudo usermod -aG docker <you>
   ```

   Sign out and back in for it to apply.
3. **The code** goes in `/opt/familyos`, owned by you:

   ```bash
   sudo install -d -o <you> /opt/familyos
   git clone <repository URL> /opt/familyos
   ```

4. **Folders the nightly backup writes to.** The backup runs as you, and Debian only lets root
   write in `/var/backups` and `/var/log`, so make its folder and log file once:

   ```bash
   sudo install -d -m 700 -o <you> /var/backups/familyos
   sudo install -m 600 -o <you> /dev/null /var/log/familyos-backup.log
   ```

5. **Mount the NAS share** on the VM, for example at `/mnt/nas/familyos`, so it's mounted again
   after a reboot (an `/etc/fstab` entry). The backup checks it's really mounted before copying.

## 4. The settings file and the secrets

Everything the app needs to know lives in **one file outside the repository**,
`/etc/familyos/familyos.env`, and **three secret files** next to it. Nothing secret goes in the
code, the image or the database in plain text.

```bash
sudo install -d -m 700 -o <you> /etc/familyos /etc/familyos/secrets
cp /opt/familyos/familyos.env.example /etc/familyos/familyos.env
chmod 600 /etc/familyos/familyos.env
```

Never name it `.env.production`: the build would read a file by that name and bake it into the
image.

### What goes in `familyos.env`

| Setting | What to put | Notes |
| --- | --- | --- |
| `BETTER_AUTH_URL` | The address from step 2, `https://familyos.example.com` | Permanent (passkeys) |
| `DATABASE_URL` | `postgresql://familyos:<db password>@db:5432/familyos?schema=public` | The same password as the `db_password` file. Letters and digits only, or percent-encode `@ : / % #` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Signs sign-ins and cookies. Make it once and keep it |
| `INTEGRATION_ENCRYPTION_KEY` | `openssl rand -base64 32` (a different one) | Encrypts stored connections (bank feed, phone-alert keys) and seals money jars in backups. Make it once and keep it |
| `TRUSTED_PROXIES` | `172.30.43.10` | The tunnel's fixed address in `docker-compose.prod.yml`; leave it unless you change the subnet |
| `TZ` | Optional: a time zone, e.g. `America/New_York` | Only used until the household has a time zone (setup takes it from the device you set up on). After that the app keeps the household's own |
| `CONTACT_EMAIL` | An address for whoever runs the server | Push services, the US Weather Service, Open Food Facts and Let's Encrypt ask for one. Without it, phone alerts use the app's `https://` address instead |
| `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` | From Cloudflare (section 5). Anything else stops the app with a 503 until fixed |
| `CF_ACCESS_AUD` | The Access application's Application Audience (AUD) tag | From Cloudflare (section 5) |
| `BREAK_GLASS_LAN_IP` | The VM's home-network address | Section 14 |
| `MICROSOFT_CLIENT_ID`, `_SECRET`, `_TENANT_ID` | From the Entra app registration | Optional; all three or none (a partial set stops the app at start) |
| `OIDC_DISCOVERY_URL`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_NAME` (and optional `OIDC_SCOPES`) | Your own identity provider | Optional; all four or none. Redirect address `<BETTER_AUTH_URL>/api/auth/callback/oidc` |
| `ALERT_MAILBOX` | The shared mailbox alert emails come from | Optional (section 11) |
| `FAMILY_CALENDAR_NAME` | The exact name of a calendar Home shows by default | Optional; each Microsoft grown-up can pick their own in Settings → Calendar on Home |
| `DOCINTEL_ENDPOINT` | Azure Document Intelligence custom-subdomain endpoint | Optional, for receipt prices (README "Receipts") |
| `BACKGROUND_JOBS` | Leave unset | On in production. `0` turns money syncs and alerts off |

Leave the phone-alert keys (`VAPID_*`) unset: the server makes its own and keeps them, encrypted,
in the database. **Never set `DEV_AUTH`**: the app refuses to start with it in production.

Compose reads this file and treats `$` specially: write a literal `$` in a value as `$$`.

### The secret files

| File | Holds | Owner and mode |
| --- | --- | --- |
| `/etc/familyos/secrets/db_password` | The database password, the same as in `DATABASE_URL` | you, `600` |
| `/etc/familyos/secrets/tunnel_token` | The Cloudflare Tunnel's token (section 5) | **uid 65532**, `400` |
| `/etc/familyos/secrets/cf_dns_token` | A Cloudflare API token that can only edit DNS for your zone (section 14) | you, `600` |

```bash
cd /etc/familyos/secrets
openssl rand -hex 24 > db_password && chmod 600 db_password       # then put the same value in DATABASE_URL
# paste the tunnel token into tunnel_token, then:
sudo chown 65532:65532 tunnel_token && sudo chmod 400 tunnel_token
# paste the DNS-only API token into cf_dns_token, then:
chmod 600 cf_dns_token
```

The tunnel runs as a non-root user, uid 65532, so its token must belong to that user or it can't
read it.

**Keep a copy of `familyos.env` in the password manager.** A database backup is only usable with
the same `BETTER_AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY`; without the key, sealed money
jars and stored connections can't come back.

## 5. Cloudflare

All in the Cloudflare dashboard (Cloudflare moves menus now and then; the names below were right
in October 2026).

1. **Put the domain on Cloudflare DNS.**
2. **The tunnel.** Zero Trust → Networks → Tunnels → create a tunnel (Cloudflared). Copy its
   token into `tunnel_token` (above). Add a **public hostname**, the one in `BETTER_AUTH_URL`,
   pointing at the service `http://app:3000`.
3. **Microsoft as Cloudflare's login method** (if the family uses Microsoft 365). Cloudflare needs
   its own app registration in Entra, separate from the app's: follow Cloudflare's guide for
   Microsoft Entra ID as an identity provider (its redirect address is
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`), then add it under Zero Trust's
   login methods. Without Microsoft, use **one-time PIN** (a code to each family email address).
4. **The Access application.** Zero Trust → Access → Applications → add a **self-hosted**
   application for the hostname, with a policy that allows only the family (their Microsoft
   accounts or email addresses). Set the session to about a month: each device then signs in to
   Cloudflare about once a month. A shared kids' tablet needs a grown-up to do that once a month.
5. **The two values for the app.** On the application, copy the **Application Audience (AUD)
   tag** into `CF_ACCESS_AUD`, and your team domain (`<team>.cloudflareaccess.com`) into
   `CF_ACCESS_TEAM_DOMAIN`.

With both set, the app checks Cloudflare's signed token on **every** request and refuses
anything else, even from inside the house. If Cloudflare itself is down, nobody gets in; that's
what [break-glass](#14-break-glass-when-cloudflare-is-down) is for.

## 6. Microsoft 365 (optional)

Skip this whole section if the family signs in with passkeys only. Everything here is in the
[Entra admin center](https://entra.microsoft.com).

1. **The app registration**: single-tenant, a Web redirect URI of
   `<BETTER_AUTH_URL>/api/auth/callback/microsoft` (for example
   `https://familyos.example.com/api/auth/callback/microsoft`), a client secret, and the
   `email` optional claim. Its client ID, secret and tenant ID go in the three `MICROSOFT_*`
   settings.
2. **App roles** named exactly `Admin` and `Adult` (a `Kid` role is allowed but gives no access).
   Assign each grown-up one of them. A Microsoft sign-in with neither is turned away. **Give both
   parents `Admin`**: Teams and email alerts go to admins.
3. **Assignment required? = Yes** (Enterprise applications → the app → Properties), so Entra
   refuses anyone unassigned before they reach the app.
4. **Checking Entra.** Grant the app registration the **application** permissions
   `Application.Read.All` and `GroupMember.ReadBasic.All`, with admin consent. The app then asks
   Entra every half hour who's assigned: roles follow Entra, and someone taken off is signed out
   everywhere on the next check. Only a group's direct members count. Settings → Sign-in → **Check
   now** runs it on demand.
5. **Sign in every time** (recommended, needs Entra ID P1): a Conditional Access policy on the app
   with MFA and sign-in frequency **Every time**, so a "fresh sign-in" (needed for backups, PINs
   and invites) really asks for a password. Exact steps: README "Sign in every time".
6. **Later, as you want them:** the Outlook family calendar (`Calendars.ReadWrite`, README "In
   Outlook"), alert email (section 11), receipt reading (README "Receipts").

People who sign in with Microsoft use Microsoft only (no passkey), so Conditional Access always
applies to them.

## 7. First start

The app comes ready-made: every change merged to `main` is tested and then published as an image
tagged `sha-<commit>`. Your server runs one of those, pinned by a one-line `.env` beside the
compose file (only that line goes there; settings stay in `familyos.env`; without it, compose
refuses to run). Pick the newest commit on `main`:

```bash
cd /opt/familyos
git checkout <a commit on main>
echo "FAMILYOS_VERSION=sha-$(git rev-parse HEAD)" > .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The first time only, if the pull is refused: the images' packages on GitHub start out private.
Set each one (`familyos` and `familyos-migrate`) to public in its Package settings.

This starts the database, runs the database migrations once, starts the app, and then the tunnel
once the app is healthy. Check it:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
```

The app is never published on the VM's own ports: the tunnel is the only way to it (and
break-glass, when switched on).

## 8. First run: setup and the guided setup

**Do this straight after the first start, before you tell anyone the address.** Until a household
exists, whoever opens the address first sets it up and becomes its admin. (Cloudflare Access
already keeps strangers away, but don't leave it waiting.)

1. Open the address. A brand-new install goes to **`/setup`**: name the household and make your
   passkey (or, with Microsoft on, sign in with a Microsoft account that has the Admin role).
   Afterwards `/setup` is gone for good.
2. The **guided setup** (`/settings/get-started`) follows. Five short steps, each skippable:
   - **Household basics:** where home is (use this device's location, or type a ZIP code; the app
     keeps it to about a kilometre, for rain warnings on outdoor chores) and the time zone (taken
     from the device you set up on).
   - **Make it yours:** the family's name, colors and reward word (section 10).
   - **Who's in your family:** add each person as a **Kid** (a tile on the profile picker, chores,
     rewards and meds; no sign-in), a **Grown-up** (signs in on their own; you get an invite link at
     the end) or a **Grandparent or helper** (in People and on the calendar; no tile, no sign-in).
   - **Pick your apps:** turn off what you won't use.
   - **Phone and safety:** alerts on this phone, a PIN to lock your own tile, a spare passkey.
   - **All set:** the invite links for the grown-ups you added (it may ask you to sign in again
     first).
3. Anything skipped waits under **Finish setting up** at the top of Settings.

Then, in Settings → Household, check the time zone is home's, and set a PIN for each kid.

**The time zone** is the family's clock: "today", due dates, dose times and every date the app
shows follow it, wherever the server runs. Changing it later (the family moves) keeps everything
already saved on its date and clock time: a chore due Tuesday stays due Tuesday, an 8:00 AM dose
stays at 8:00 AM. A restore from a backup made in another zone does the same, and its preview says
so.

## 9. People and sign-in

### Who's who

- **Admin**: a grown-up who can change things for everyone (Settings' family tiles, sign-ins,
  household backups). Keep at least two.
- **Adult**: a grown-up with their own sign-in, money jars and everyday settings.
- **Kid**: a tile on the profile picker, opened with a PIN, under a grown-up's sign-in. No sign-in
  of their own, and no Money or Cars.
- **Contacts** (grandparents, helpers, friends): records in People. No tile, no sign-in.

### How grown-ups sign in

- **Passkeys** (always available): the device's own fingerprint, face or PIN. Nothing to remember.
- **Microsoft** (when `MICROSOFT_*` is set): roles come from Entra's app roles and are re-checked
  on every request. People who use Microsoft use only Microsoft.
- **Your own OIDC provider** (when `OIDC_*` is set): offered next to the passkey on an invite.

Settings → Sign-in says which are on. Every sign-in lasts **30 days**, then each grown-up signs in
again (Cloudflare asks about monthly too, separately).

### Inviting a grown-up

Settings → Sign-in → **Invite a grown-up** (signed in within the last 5 minutes; the page offers
**Sign in again**). Pick someone already in the household or a new person, choose **Adult** or
**Admin**, and **Make the invite link**. The link shows once: send it yourself, by text or in
person. It works once, for 48 hours. They open it on their own device and make a passkey with one
tap. Waiting invites can be cancelled; every invite is in **Recent changes**.

### Looking after other people's sign-ins

On Settings → Sign-in, for each grown-up who signs in with a passkey (or OIDC):

- **Make admin** or **Remove admin**.
- **Reset passkeys** when they've lost a phone: their passkeys and sign-ins everywhere stop, and
  you get a link, good for one hour, to hand them in person.
- **Take it away**: they become a PIN profile again (never an admin), and need a PIN from Settings
  → Household. Not for someone in a money jar.

The app always keeps at least one admin who can sign in. Each change is logged, the person is
always told, and other admins are told unless they switch that off in My notifications.
Microsoft people are added, removed and given roles in Entra, not here.

### PINs

- **Kids:** 4 to 6 digits, set by an admin in Settings → Household → Profile PIN.
- **A grown-up without their own sign-in:** 6 digits, set the same way.
- **Admins never open with a PIN.** An admin's tile only opens for their own sign-in. An admin who
  has no sign-in (after a restore onto a new server, say) shows **Send an invite** instead of a PIN:
  invite them again.
- **Lock my tile:** each grown-up with their own sign-in can put a PIN on their own tile, so kids
  on a shared tablet can't open it.
- Five wrong PINs in a row lock that tile for 15 minutes, doubling each time after (up to a day).

### People restored onto a new server

A household backup brings people back **without** their sign-ins. Passkey and OIDC people: invite
them again. Microsoft people just sign in. Kids: set their PINs again in Settings → Household.

### Removing someone

Settings → Household → **Remove** takes a kid or PIN grown-up off the profile picker (it asks
first; add them back from their People page). People who sign in on their own have no Remove
there: take their sign-in away first, or, for Microsoft people, remove them in Entra.

## 10. Make it yours, and turning apps off

**Settings → Make it yours** (admins) changes things for the whole family, on every device:

- **App name:** type the family's name and the app adds "OS". Blank means FamilyOS.
- **Top bar color:** eight presets, all readable in light and dark mode.
- **What the kids earn:** stickers (the default), stars, points, coins, gems, or your own word.
  Only the words change; balances stay.
- **The mascot:** on for everyone (each person can still quiet him) or off, and his name.
- **Home Screen icon:** the bunny, or the name's first letter.

A phone keeps the name and icon it was added to the Home Screen with until it's added again.

**Settings → Apps** turns off apps the family doesn't use: Calendar, Chores, Meds, Groceries,
School, Money, Store, Pet and Cars (the Garage goes with Cars). Home, People, Data and Settings are
always on, so they aren't listed. A turned-off app disappears for everyone, its background work
pauses, and **nothing is deleted**: switch it back on and it's all there. Two things to know: a
turned-off app's events leave the Outlook family calendar until it's back; and bank feeds only
reach about 3 months back, so Money off for longer leaves a gap (a statement file can fill it).

### The pet

**Settings → Apps → Pet care hours** sets when the family's pets are awake: up to two stretches
on weekdays and on weekends (by default 7–8am and 3–8pm on weekdays, 8am–8pm at weekends). A
pet's clock only runs in these hours, so school and bedtime can't make one hungry or sick.
Changing them applies from the next time each pet is opened. Turn the whole Pet app off in the
list above; pets just sleep until it's back.

The pet is separate from stickers and the store: it never reads or changes a balance.

<details>
<summary><strong>Spoiler: for grown-ups</strong> (the kids are meant to work this out themselves)</summary>

Finishing a chore quietly leaves a present by the pet's door: a feast, a lucky charm (it stops
the next sickness), a sparkle treat (it helps the pet grow into a nicer form), or a decoration or
hat that only comes this way. Up to 3 a day; a chore counts for whoever it was assigned to (or
whoever did an Anyone chore), the same as stickers. Undoing a chore never takes a present
back, and redoing it doesn't bring a second one. Nothing in Chores mentions the pet, and the
notes on the presents only hint, getting warmer each time. Please don't spoil it!

</details>

## 11. Alerts

Admins always get the in-app bell. On **Settings → Alerts** (the **Store order alerts** tile) any admin can also
switch on **Teams** and **email** for each admin, and each grown-up can turn on **phone
notifications** on their own phone.

- **Phone notifications:** nothing to set up on the server; it makes its own keys. It needs the
  `https://` address (which you have) and uses `CONTACT_EMAIL`, or the app's own address, as the
  contact push services ask for. On an iPhone or iPad the app must be added to the Home Screen
  first (the [family guide](family.md#notifications-on-your-phone) has the steps). If
  `INTEGRATION_ENCRYPTION_KEY` ever changes, the page offers an admin new keys, and every phone
  turns alerts on again. Any admin can remove a lost phone from that admin's row.
- **Teams:** the family's own Teams app, a notification-only bot named after the family's app,
  messages each admin in their own Teams chat with it. An admin who is also a Teams administrator
  sets it up once: an **Azure Bot** (free tier, single-tenant, on the family's app registration,
  with the Teams channel on), four permissions on the app registration with admin consent, custom
  apps allowed in Teams admin center, then **Allow publishing** and **Add to Teams** under
  **Teams for the family**, and **Send a test**. Each person must have signed in with Microsoft
  once. A money jar can pick one of a member's own group chats instead. Exact steps and
  troubleshooting: README "Teams".
- **Email:** a shared mailbox and Exchange **RBAC for Applications** limiting the app to that one
  mailbox (never the Graph `Mail.Send` application permission). Then `ALERT_MAILBOX` in
  `familyos.env` (restart, section 15) and **Send a test**. Exact steps: README "Email".

Money jars have their own alerts, which each member switches in the jar's Settings → Alerts for
me. They never include amounts.

## 12. Backups

There are three kinds. Use all three.

### Nightly, on the server (everything)

`scripts/backup-prod.sh` dumps the whole database through the running database container, checks
the dump can be read, keeps 14 days in `/var/backups/familyos` (with a `.counts` file beside each
for the restore drill), and copies each to the NAS. If the NAS share isn't mounted it stops with an
error instead of quietly filling the VM's own disk, and it compares the copy.

In **your** crontab (`crontab -e`, not root's):

```bash
15 3 * * *  BACKUP_NAS_DIR=/mnt/nas/familyos /opt/familyos/scripts/backup-prod.sh >> /var/log/familyos-backup.log 2>&1
```

Run it once by hand to see it work, and look at `/var/log/familyos-backup.log` now and then.

### In the app: the household backup

**Settings → Data & backups** (`/data`). Any grown-up can download a spreadsheet (CSV) of a
section. Admins can download a **whole-household backup** (`.json`): everything that lives only in
the app, without PINs, sign-in links, photos or stored connection secrets. It holds meds,
contacts, notes and the household's location, so store it like the settings file.

- **Money jars ride in it sealed**, encrypted with `INTEGRATION_ENCRYPTION_KEY`: the admin holding
  the file can't read them; only a server with the same key can put them back. **Keep that key in
  the password manager, not next to the file.**
- Backups and restores need you to be **using the app as yourself** (your own sign-in, not a
  switched profile), signed in within the last 15 minutes (the page offers **Sign in again**).
- Every backup and restore is in **Backup history** on the same page, and announced in the bell
  and Teams to the other admins and every money jar member.

### Each grown-up's own money copy

Money → **Keep a copy** downloads a readable file of the jars you're in. Bank connections aren't in
any backup: members reconnect after a restore.

## 13. Restoring, and the restore drill

### Putting back a nightly dump (the whole database)

Stop the app, restore in one transaction (a failed restore leaves the database as it was), then
start everything so any newer migrations run before the app:

```bash
cd /opt/familyos
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U familyos -d familyos --clean --if-exists --single-transaction < /var/backups/familyos/<file>.dump
docker compose -f docker-compose.prod.yml up -d
```

It needs the same `BETTER_AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY` as when it was made.

### Restoring a household backup (in the app)

Settings → Data & backups → restore. You see what will change, type `REPLACE`, and a copy of the
household as it was downloads first. Tick **Also put the money jars back** to bring the sealed jars
back (members are told). Afterwards: kids' PINs in Settings → Household, invites for passkey
people, and reconnect bank feeds and other connections.

### The restore drill

Every few months, and after any big change, prove a backup really restores:

```bash
cd /opt/familyos && scripts/restore-drill.sh /var/backups/familyos/<newest>.dump
```

It restores the dump into a throwaway stack beside the real one (its own database, network and
settings, fresh keys, no background jobs, no Microsoft, alerts or tunnel), migrates, starts the
app, waits for it to be healthy, compares row counts with the `.counts` file, checks a database
from newer code still migrates (what a rollback leaves), and removes everything. It ends with
`drill: ok`. Nothing touches the real database. Rehearse break-glass at the same time.

## 14. Break-glass: when Cloudflare is down

An emergency entrance on the home network, **off unless you switch it on from the server**. It
serves the app's own address (passkeys only work there) with a certificate kept current in
advance, skips only Cloudflare's gate (everyone still signs in), tells every admin when it starts
and ends, shows a banner on every page, and switches itself off after 24 hours at most.

### Once

1. In Cloudflare, make an **API token that can only edit DNS for the family's zone** and put it in
   `/etc/familyos/secrets/cf_dns_token` (section 4).
2. Put the VM's home-network address in `familyos.env` as `BREAK_GLASS_LAN_IP`, and make sure
   `CONTACT_EMAIL` is set (Let's Encrypt's contact).
3. In **root's** crontab (`sudo crontab -e`):

   ```bash
   0 4 * * 1   /opt/familyos/scripts/break-glass-cert.sh >> /var/log/familyos-cert.log 2>&1
   */10 * * * * /opt/familyos/scripts/break-glass.sh check >> /var/log/familyos-break-glass.log 2>&1
   ```

   The first renews the certificate every Monday (by DNS challenge, so it works while nothing
   points at the VM); the second ends an entrance that has run out.
4. Get the first certificate now:

   ```bash
   sudo /opt/familyos/scripts/break-glass-cert.sh
   ```

### In an emergency, at home

1. On the server (the Proxmox console, or SSH):

   ```bash
   sudo /opt/familyos/scripts/break-glass.sh on
   ```

   That's 24 hours; `on 4` is four. `sudo /opt/familyos/scripts/break-glass.sh status` says
   whether it's on and until when.
2. **Point the address at the VM** on the devices that need it: a local DNS override on the router
   or Pi-hole, or a line in one device's hosts file:

   ```text
   <VM address>  familyos.example.com
   ```

   Browsers using their own secure DNS may skip the router's answer; the hosts file always wins.
3. Sign in as usual. Every page shows "Emergency local access is on until …".
4. When Cloudflare is back:

   ```bash
   sudo /opt/familyos/scripts/break-glass.sh off
   ```

   and remove the DNS override or hosts line.

Rehearse it with the restore drill: switch it on, sign in from one device through a hosts-file
line, switch it off.

## 15. Updating and rolling back

**Update:** move the checkout and the pinned version to the new commit together, then pull:

```bash
cd /opt/familyos
git fetch && git checkout <a newer commit on main>
echo "FAMILYOS_VERSION=sha-$(git rev-parse HEAD)" > .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

It runs any new migrations first, then replaces the app. Read the pull request or docs/BUILD.md
for the phase first: some updates ask for a step of their own. A mistyped version fails the pull
with an error and changes nothing. To check an image really came from this repository's CI
before running it, see README "Start, update, roll back".

**Changed a setting** in `familyos.env`? Recreate the app so it reads the file again (a plain
restart doesn't):

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate app
```

**Roll back:** the same steps with the previous commit. A migration the
older code doesn't know stays applied (the restore drill checks that still works). To go back
further, restore a backup (section 13).

**A migration failed:** the app stays down on purpose. Read why, fix the cause, mark it rolled
back, and start again:

```bash
docker compose -f docker-compose.prod.yml logs migrate
docker compose -f docker-compose.prod.yml run --rm migrate node_modules/.bin/prisma migrate resolve --rolled-back <migration name>
docker compose -f docker-compose.prod.yml up -d
```

**Changing the database password:** the password file only applies to a brand-new database, so
change it inside the database first, then update `db_password` and `DATABASE_URL`, and recreate:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U familyos
# ALTER USER familyos PASSWORD '<new password>';
```

**Sentry (optional error reports):** set `SENTRY_DSN` in `familyos.env` and recreate the app
(as for any setting). Nothing about it is built into the image. What it may receive
is locked down in code (README "Error monitoring"); also switch on **Prevent Storing of IP
Addresses** in the Sentry project.

**Base images** (Node, Postgres, cloudflared, Caddy, lego) are pinned by digest. Bump them on
purpose, at least 7 days after a release.

## 16. Logs and troubleshooting

| What | Where |
| --- | --- |
| The app | `docker compose -f docker-compose.prod.yml logs -f app` |
| A failed migration | `docker compose -f docker-compose.prod.yml logs migrate` |
| The tunnel | `docker compose -f docker-compose.prod.yml logs -f tunnel` |
| What's running | `docker compose -f docker-compose.prod.yml ps` |
| Nightly backups | `/var/log/familyos-backup.log` |
| Break-glass | `/var/log/familyos-break-glass.log`, `journalctl -t familyos` |
| Break-glass certificate | `/var/log/familyos-cert.log` |
| Sign-in changes | Settings → Sign-in → Recent changes |
| Backups and restores | Settings → Data & backups → Backup history |

Run the `docker compose` lines from `/opt/familyos`.

**Everyone gets "Forbidden".** The app is refusing requests without a valid Cloudflare Access
token. Its log says why, once a minute per reason:

```text
[access] Refused a request without a valid Cloudflare Access token (wrong audience).
```

| Reason | Usually means |
| --- | --- |
| `no token` | The request didn't come through Access: no Access application covers the hostname, or something reaches the app another way |
| `wrong audience` | `CF_ACCESS_AUD` isn't this application's AUD tag |
| `wrong issuer`, `unknown key` | `CF_ACCESS_TEAM_DOMAIN` is another team's |
| `expired`, `not yet valid` | The VM's clock is off; check it keeps time |
| `malformed`, `bad signature` | Not a real Access token |

**Every page says "This server's Cloudflare Access settings are wrong; see its log."** (a 503):
`CF_ACCESS_TEAM_DOMAIN` isn't of the form `<team>.cloudflareaccess.com`. The log says so at start.

**The app keeps restarting.** The health check (`/api/auth/ok`) uses the database, so a database
that's down makes the app unhealthy and Docker restarts it. Look at
`docker compose -f docker-compose.prod.yml logs db`.

**The tunnel doesn't start.** It waits for the app to be healthy. If the app is healthy, check the
tunnel's log: if it can't read its token, `tunnel_token` isn't owned by uid 65532 (section 4).

**The app stopped at start with a settings error.** A partial set of `MICROSOFT_*` or `OIDC_*`,
or `DEV_AUTH` set. The log names it.

**"Today" is wrong.** Check the time zone in Settings → Household: the app follows it, not the
server's `TZ`.

**Someone signed in with Microsoft lands on "not provisioned".** Their account has no `Admin` or
`Adult` app role in Entra.

**The backup log says the NAS copy was NOT made.** The share isn't mounted. Mount it; the local
copy was still made.

**Phone alerts stopped for everyone.** The keys couldn't be read (usually a changed
`INTEGRATION_ENCRYPTION_KEY`): Settings → Alerts offers an admin new keys, then each phone turns
alerts on again.

## 17. Security in plain words

- **Nobody outside the family reaches the app.** Cloudflare Access asks everyone who they are
  before anything reaches the server, and the app itself checks Cloudflare's signature on every
  request, so even a device on the home network can't go around it.
- **No open doors at home.** The tunnel connects out to Cloudflare; no router ports are opened, and
  the app isn't published on the VM's own ports. The database sits on a network with no way out.
- **Everything in transit is encrypted.** Cloudflare handles HTTPS to every device.
- **Two locks on the door.** Cloudflare's sign-in (about monthly) and the app's own (passkeys or
  Microsoft, every 30 days). Kids use PINs only inside a grown-up's sign-in.
- **Passkeys can't be phished or reused** and are tied to this one address.
- **Secrets stay out of the code.** Settings live in one locked-down file on the server; passwords
  and tokens in files only their user can read. PINs are hashed (Argon2id); stored connections are
  encrypted with `INTEGRATION_ENCRYPTION_KEY`.
- **Money is private inside the app.** A jar opens only for its own members using the app as
  themselves; being an admin grants nothing. Honest limit: whoever runs the server, the database or
  the Microsoft tenant could still read the data.
- **Pages can only run the app's own scripts** (a strict content security policy), and sign-in
  attempts are rate-limited in the database, so a restart doesn't reset them.
- **Little stays on a phone.** The only page kept on a device is the Shop list, so it opens in a
  store with no signal: saved only from a clean, signed-in page, kept a week, and removed when
  anyone signs out on that device. Besides it, a phone keeps only grocery ticks waiting to be
  sent (item ids, nothing else), for a week at most.
- **Changes are recorded.** Sign-in changes, invites, resets, backups and restores are logged and
  announced, and break-glass tells every admin.
- **Backups are kept, copied off the VM and practiced.** Nightly, 14 days, on the NAS, with a drill
  that proves they restore.
- **The containers are locked down:** read-only, no extra privileges, not running as root, base
  images pinned, dependencies pinned and checked (README "Dependencies").

## 18. A routine

- **Weekly:** a glance at `/var/log/familyos-backup.log`.
- **Monthly:** update (section 15), after reading what changed.
- **Every few months:** the restore drill and a break-glass rehearsal. Check the password manager
  still has the current `familyos.env`.
- **When someone leaves or loses a phone:** Settings → Sign-in (reset or take away), remove their
  phone from alerts, and take them out of the Cloudflare Access policy (and Entra).
