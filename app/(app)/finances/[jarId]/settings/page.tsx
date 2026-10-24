import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { eligibleMemberWhere, requireJar } from "@/lib/finance/access";
import { addMember, allowChatList, connectPrivacy, checkStatement, connectSimpleFin, deleteJar, disconnect, importStatement, removeStatementImport, removeMember, renameJar, scanOrdersNow, setCushion, setJarChat, setMyAlerts, setLeftOut, setOrderMail, setSpendingAccounts, stopJarChat, testJarChat } from "../../actions";
import { chatLabel, myGroupChats } from "@/lib/teams/jar-chat";
import { recentImports } from "@/lib/finance/statement-import";
import { leftOutAccountIds } from "@/lib/finance/left-out";
import { StatementImport } from "./statement-import";
import { ActionForm, ConfirmSubmit, Submit, SyncButton } from "../../forms";
import { backLink, btn, card, field } from "@/components/styles";
import { centsToInput, formatMoney } from "@/lib/money";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export const metadata: Metadata = { title: "Jar settings" };

/** A checkbox and its words: the whole row is the thumb target, not just the little box. */
const SIMPLEFIN_BRIDGE = "https://bridge.simplefin.org/";
const checkRow = "flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9";
const checkbox = "size-5 shrink-0";

/**
 * Phase 25: a jar's people, connections and statement imports. Members only. Phase 27: your own money alerts.
 * Phase 30: the jar's shared Teams chat, and bank accounts skipped because another jar has them.
 * Phase 32: which accounts are spending money, and the cushion, for Safe to spend.
 * Phase 37: a link to the jar's Categories page.
 */
export default async function JarSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ jarId: string }>;
  searchParams: Promise<{ pick?: string; chat?: string; grant?: string }>;
}) {
  await requireAppOn("money");
  const { jarId } = await params;
  const shown = await searchParams;
  const { jar, viewer } = await requireJar(jarId);

  const orderScan = await prisma.mailOrderScan.findUnique({ where: { personId: viewer.id }, include: { jar: { select: { name: true } } } });
  const scansHere = Boolean(orderScan?.enabled && orderScan.jarId === jar.id);
  const [members, eligible, connections, accounts, mine, prefs, teamsLink, jarRow] = await Promise.all([
    prisma.moneyJarMember.findMany({ where: { jarId: jar.id }, select: { person: { select: { id: true, firstName: true, lastName: true } } } }),
    prisma.person.findMany({ where: eligibleMemberWhere(viewer.householdId), select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } }),
    prisma.jarConnection.findMany({ where: { jarId: jar.id }, select: { provider: true, lastSyncAt: true, lastError: true, providerMessage: true, skippedAccounts: true, skippedJarId: true, createdBy: { select: { firstName: true } } } }),
    prisma.finAccount.findMany({
      where: { jarId: jar.id },
      select: { id: true, name: true, org: true, source: true, spending: true, balanceCents: true, availableCents: true, currency: true },
      orderBy: { name: "asc" },
    }),
    prisma.moneyJarMember.findUnique({ where: { jarId_personId: { jarId: jar.id, personId: viewer.id } }, select: { alertBills: true, alertSync: true, alertOverBudget: true, alertLowBalance: true } }),
    prisma.alertPrefs.findUnique({ where: { personId: viewer.id }, select: { lastSentTeams: true, lastErrorTeams: true } }),
    prisma.householdAlerts.findUnique({ where: { householdId: viewer.householdId }, select: { teamsAppId: true } }),
    prisma.moneyJar.findUniqueOrThrow({ where: { id: jar.id }, select: { teamsChatId: true, teamsChatName: true, teamsChatError: true, cushionCents: true } }),
  ]);
  const [recent, leftOut] = await Promise.all([recentImports(jar.id), leftOutAccountIds(jar.id)]);
  const feedAccounts = accounts.filter((a) => a.source === "SIMPLEFIN");
  const memberIds = new Set(members.map((m) => m.person.id));
  const addable = eligible.filter((p) => !memberIds.has(p.id));
  const conn = (p: "SIMPLEFIN" | "PRIVACY") => connections.find((c) => c.provider === p);
  const sf = conn("SIMPLEFIN");
  const pv = conn("PRIVACY");
  // The other jar is named only to its own members: someone else's jar stays invisible.
  const skippedIn = sf?.skippedJarId
    ? await prisma.moneyJar.findFirst({ where: { id: sf.skippedJarId, members: { some: { personId: viewer.id } } }, select: { name: true } })
    : null;
  const skippedWhere = skippedIn ? skippedIn.name : `another jar ${sf?.createdBy?.firstName ?? "the person who connected it"} is in`;
  // Phase 50: the member's own group chats, only while choosing (it's a Microsoft call).
  const chatList = shown.pick === "1" && teamsLink?.teamsAppId ? await myGroupChats() : null;
  const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not yet");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-24 sm:p-6">
      <Link href={`/finances/${jar.id}`} className={`${backLink} self-start`}>
        ← {jar.name}
      </Link>
      <h1 className="text-3xl font-extrabold">⚙️ Jar settings</h1>

      <section className={card}>
        <h2 className="font-extrabold">Name</h2>
        <ActionForm action={renameJar.bind(null, jar.id)} className="mt-2 flex flex-wrap gap-2">
          <input name="emoji" defaultValue={jar.emoji ?? ""} maxLength={8} aria-label="Emoji" className={`${field} w-16 text-center`} />
          <input name="name" defaultValue={jar.name} required maxLength={60} aria-label="Jar name" className={`${field} min-w-0 flex-1`} />
          <Submit>Save</Submit>
        </ActionForm>
      </section>

      <section className={`${card} flex flex-wrap items-center justify-between gap-2`}>
        <div className="min-w-0">
          <h2 className="font-extrabold">🏷️ Categories</h2>
          <p className="text-sm text-muted-foreground">Rename, add or remove this jar&apos;s categories.</p>
        </div>
        <Link href={`/finances/${jar.id}/settings/categories`} className={btn}>
          Categories →
        </Link>
      </section>

      <section className={card}>
        <h2 className="font-extrabold">🔔 Alerts for me</h2>
        <p className="text-sm text-muted-foreground">
          Sent to your Teams chat (and your phone, if it&apos;s set up), and the bell. Just yours: everyone in the jar picks their own. They
          never include amounts.
        </p>
        {!teamsLink?.teamsAppId && <p className="mt-1 text-sm font-semibold">Teams isn&apos;t set up for the family yet, so these only reach the bell and phones.</p>}
        <ActionForm action={setMyAlerts.bind(null, jar.id)} className="mt-2 flex flex-col gap-1.5">
          <label className={checkRow}>
            <input type="checkbox" className={checkbox} name="bills" defaultChecked={mine?.alertBills ?? true} /> A bill is due in the next 3 days, or a bill went up
          </label>
          <label className={checkRow}>
            <input type="checkbox" className={checkbox} name="sync" defaultChecked={mine?.alertSync ?? true} /> The bank feed or Privacy.com stops syncing for a day
          </label>
          <label className={checkRow}>
            <input type="checkbox" className={checkbox} name="overBudget" defaultChecked={mine?.alertOverBudget ?? false} /> A category goes over its budget
          </label>
          <label className={checkRow}>
            <input type="checkbox" className={checkbox} name="lowBalance" defaultChecked={mine?.alertLowBalance ?? true} /> Checking may run low before payday
          </label>
          <Submit className={`${btn} self-start`}>Save</Submit>
        </ActionForm>
        {prefs?.lastErrorTeams ? (
          <p className="mt-1 text-xs font-semibold text-tomato">Last Teams alert didn&apos;t go: {prefs.lastErrorTeams}</p>
        ) : (
          prefs?.lastSentTeams && <p className="mt-1 text-xs text-muted-foreground">Last Teams alert sent {when(prefs.lastSentTeams)}.</p>
        )}
      </section>

      <section className={card}>
        <h2 className="font-extrabold">💬 One Teams chat for this jar</h2>
        <p className="text-sm text-muted-foreground">
          Sends this jar&apos;s alerts once to a Teams group chat instead of to each person. Make a group chat with everyone in the jar (no
          kids), then choose it here. The family&apos;s Teams app joins the chat to post; it can&apos;t read what anyone writes there. Everyone
          still gets the bell and their phone. An alert about a 🎁 surprise only goes to the people who can see it.
        </p>
        {!teamsLink?.teamsAppId && <p className="mt-1 text-sm font-semibold">Teams isn&apos;t set up for the family yet, so this has nothing to send through.</p>}
        {shown.chat === "hello" && <p className="mt-1 text-sm font-semibold">Saved, and a hello went to the chat.</p>}
        {shown.chat === "saved" && <p className="mt-1 text-sm font-semibold">Saved, but the hello didn&apos;t go (see below). Send a test once it&apos;s fixed.</p>}
        {shown.grant === "failed" && <p className="mt-1 text-sm font-semibold text-tomato">Microsoft didn&apos;t give the permission. Try again, or ask an admin to approve it.</p>}
        {jarRow.teamsChatId && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">✅ Alerts go to {jarRow.teamsChatName ? <>&ldquo;{jarRow.teamsChatName}&rdquo;</> : "the chat"}.</span>
            <SyncButton sync={testJarChat.bind(null, jar.id)} label="💬 Send a test" busy="Sending…" />
            <ActionForm action={stopJarChat.bind(null, jar.id)}>
              <Submit className={btn} pendingText="…">
                Stop
              </Submit>
            </ActionForm>
          </div>
        )}
        {teamsLink?.teamsAppId && !chatList && (
          <Link href={`/finances/${jar.id}/settings?pick=1#teams-chat`} className={`${btn} mt-2 self-start`}>
            {jarRow.teamsChatId ? "Choose another chat" : "Choose a Teams chat"}
          </Link>
        )}
        {chatList && !chatList.ok && (
          <div className="mt-2 space-y-2 text-sm">
            <p className="font-semibold">{chatList.error}</p>
            {chatList.needsGrant && (
              <ActionForm action={allowChatList.bind(null, jar.id)}>
                <Submit className={btn}>Allow listing my Teams chats</Submit>
              </ActionForm>
            )}
          </div>
        )}
        {chatList?.ok && (
          <ActionForm action={setJarChat.bind(null, jar.id)} className="mt-2 flex flex-col gap-2">
            <fieldset id="teams-chat" className="flex flex-col gap-1.5">
              <legend className="text-sm font-semibold">Your group chats</legend>
              {chatList.chats.length === 0 && <p className="text-sm text-muted-foreground">You&apos;re not in any group chats yet. Make one in Teams first.</p>}
              {chatList.chats.map((c) => {
                const outside = c.members.filter((m) => m.outside);
                return (
                  <label key={c.id} className={checkRow}>
                    <input type="radio" className={checkbox} name="chat" value={c.id} required defaultChecked={c.id === jarRow.teamsChatId} />
                    <span>
                      <span className="font-semibold">{chatLabel(c)}</span>
                      <span className="block text-xs text-muted-foreground">{c.members.map((m) => m.name).join(", ")}</span>
                      {outside.length > 0 && (
                        <span className="block text-xs font-semibold text-tomato">
                          {outside.length === 1 ? "1 person is" : `${outside.length} people are`} from outside your family&apos;s Microsoft 365; alerts would reach them too.
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              {chatList.chats.length > 0 && <Submit>Use this chat</Submit>}
              <Link href={`/finances/${jar.id}/settings`} className={btn}>
                Cancel
              </Link>
            </div>
          </ActionForm>
        )}
        {jarRow.teamsChatError && <p className="mt-1 text-xs font-semibold text-tomato">Last chat alert didn&apos;t go: {jarRow.teamsChatError}</p>}
      </section>

      <section className={card}>
        <h2 className="font-extrabold">📬 Order emails</h2>
        <p className="text-sm text-muted-foreground">
          Reads order emails from Amazon, Apple and Publix in <strong>your own</strong> mailbox (nothing else is opened) and puts the order
          on the charge that paid for it. Only what&apos;s ordered is kept, never the email. Everyone in this jar sees the orders; mark a
          gift&apos;s order (or its charge) 🎁 to keep it a surprise.
        </p>
        {orderScan?.enabled && orderScan.jarId && orderScan.jarId !== jar.id && (
          <p className="mt-1 text-sm font-semibold">They go into {orderScan.jar?.name ?? "another jar"} right now. Turning it on here sends new ones here instead (and reads the last 90 days again into this jar).</p>
        )}
        <ActionForm action={setOrderMail.bind(null, jar.id)} className="mt-2 flex flex-col gap-1.5">
          <label className={checkRow}>
            <input type="checkbox" className={checkbox} name="on" defaultChecked={scansHere} /> Read my order emails into this jar
          </label>
          <Submit className={`${btn} self-start`}>Save</Submit>
        </ActionForm>
        {scansHere && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {orderScan?.lastScanAt
                ? `Last read ${when(orderScan.lastScanAt)}: ${orderScan.lastFound} order(s)${orderScan.lastSkipped ? `, ${orderScan.lastSkipped} couldn't be read or checked` : ""}.`
                : "Not read yet: it reads when you open this jar."}
            </span>
            <SyncButton sync={scanOrdersNow.bind(null, jar.id)} label="📬 Scan now" busy="Starting…" />
          </div>
        )}
        {scansHere && orderScan?.lastError && <p className="mt-1 text-xs font-semibold text-tomato">{orderScan.lastError}</p>}
      </section>

      <section className={card}>
        <h2 className="font-extrabold">Who&apos;s in this jar</h2>
        <p className="text-sm text-muted-foreground">
          Only these people see it, admins included. Members must have their own sign-in.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {members.map(({ person }) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 font-bold break-words">
                {person.firstName} {person.lastName ?? ""}
                {person.id === viewer.id && <span className="font-normal text-muted-foreground"> (you)</span>}
              </span>
              {members.length > 1 && (
                <ActionForm action={removeMember.bind(null, jar.id, person.id)} className="flex flex-col items-end">
                  {person.id === viewer.id ? (
                    <ConfirmSubmit question={`Leave ${jar.name}? You won't see it anymore unless someone in it adds you back.`} yes="Yes, leave">
                      Leave
                    </ConfirmSubmit>
                  ) : (
                    <ConfirmSubmit
                      question={`Remove ${person.firstName} from ${jar.name}? They won't see it anymore, and their order emails stop coming into it.`}
                      yes={`Yes, remove ${person.firstName}`}
                    >
                      Remove
                    </ConfirmSubmit>
                  )}
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        {addable.length > 0 && (
          <form action={addMember.bind(null, jar.id)} className="mt-3 flex gap-2">
            <select name="personId" aria-label="Add someone" className={`${field} min-w-0 flex-1`}>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName ?? ""}
                </option>
              ))}
            </select>
            <SubmitButton className={btn}>
              Add
            </SubmitButton>
          </form>
        )}
      </section>

      <section className={card}>
        <h2 className="font-extrabold">🏦 Bank feed (SimpleFIN)</h2>
        {sf ? (
          <>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">
                Connected · last sync {when(sf.lastSyncAt)}
                {sf.lastError && <span className="block font-semibold text-tomato">{sf.lastError}</span>}
                {sf.providerMessage && (
                  <span className="block text-muted-foreground">
                    Your bank says: {sf.providerMessage}{" "}
                    <a href={SIMPLEFIN_BRIDGE} target="_blank" rel="noopener noreferrer" className="underline">
                      Open SimpleFIN Bridge
                    </a>
                  </span>
                )}
                {sf.skippedAccounts > 0 && (
                  <span className="block font-semibold">
                    {sf.skippedAccounts} account{sf.skippedAccounts === 1 ? " is" : "s are"} left out: {sf.skippedAccounts === 1 ? "it's" : "they're"} already in {skippedWhere}, and
                    bringing {sf.skippedAccounts === 1 ? "it" : "them"} in here too would count every charge twice.
                  </span>
                )}
              </span>
              <form action={disconnect.bind(null, jar.id, "SIMPLEFIN")}>
                <ConfirmSubmit
                  className={btn}
                  question="Disconnect the bank feed? What's already here stays, but nothing new comes in, and you'll need a new SimpleFIN setup token to reconnect."
                  yes="Yes, disconnect"
                >
                  Disconnect
                </ConfirmSubmit>
              </form>
            </div>
            {feedAccounts.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-bold">Accounts from the feed</h3>
                <p className="text-xs text-muted-foreground">
                  Leave out one that doesn&apos;t belong in this jar (someone&apos;s own card, say): what it already brought stays, marked,
                  but leaves every total, and nothing new comes in from it.
                </p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {feedAccounts.map((a) => {
                    const out = leftOut.has(a.id);
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 break-words">
                          <span className="font-bold">{a.name}</span>
                          {a.org && <span className="text-xs text-muted-foreground"> · {a.org}</span>}
                          {out && <span className="text-xs font-semibold text-muted-foreground"> · left out</span>}
                        </span>
                        <form action={setLeftOut.bind(null, jar.id, a.id, !out)}>
                          {out ? (
                            <SubmitButton className={btn}>Bring it back</SubmitButton>
                          ) : (
                            <ConfirmSubmit
                              className={btn}
                              question={`Leave ${a.name} out of this jar? Its charges stay listed, marked, but come out of every total, and Safe to spend stops counting it. You can bring it back.`}
                              yes="Yes, leave it out"
                            >
                              Leave out
                            </ConfirmSubmit>
                          )}
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
              <li>
                Sign in at{" "}
                <a href={SIMPLEFIN_BRIDGE} target="_blank" rel="noopener noreferrer" className="underline">
                  SimpleFIN Bridge
                </a>{" "}
                and link your banks there.
              </li>
              <li>Make a new setup token for the app and copy it.</li>
              <li>Paste it here. It works once: if it&apos;s been used already, make another.</li>
            </ol>
            <p className="mt-1 text-xs text-muted-foreground">The app keeps the connection encrypted and reads your accounts about once an hour at most.</p>
            <ActionForm action={connectSimpleFin.bind(null, jar.id)} className="mt-2 flex flex-col gap-2" resetOnSuccess>
              <input name="token" type="password" autoComplete="new-password" required maxLength={2048} placeholder="Setup token" aria-label="SimpleFIN setup token" className={field} />
              <Submit pendingText="Connecting…">Connect</Submit>
            </ActionForm>
          </>
        )}
      </section>

      <section className={card}>
        <h2 className="font-extrabold">🔒 Privacy.com</h2>
        {pv ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-words">
              Connected · last sync {when(pv.lastSyncAt)}
              {pv.lastError && <span className="block font-semibold text-tomato">{pv.lastError}</span>}
            </span>
            <form action={disconnect.bind(null, jar.id, "PRIVACY")}>
              <ConfirmSubmit
                className={btn}
                question="Disconnect Privacy.com? Charges already named stay, but new ones show the bank's text, and you'll need to paste the API key again to reconnect."
                yes="Yes, disconnect"
              >
                Disconnect
              </ConfirmSubmit>
            </form>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Shows the real store and the card&apos;s nickname on Privacy.com charges from your bank. Paste your API key from
              Privacy.com&apos;s account settings. The app only reads transactions, never card numbers.
            </p>
            <ActionForm action={connectPrivacy.bind(null, jar.id)} className="mt-2 flex flex-col gap-2" resetOnSuccess>
              <input name="key" type="password" autoComplete="new-password" required maxLength={200} placeholder="API key" aria-label="Privacy.com API key" className={field} />
              <Submit pendingText="Checking…">Connect</Submit>
            </ActionForm>
          </>
        )}
      </section>

      <section className={card}>
        <h2 className="font-extrabold">💸 Safe to spend</h2>
        <p className="text-sm text-muted-foreground">
          Tick the day-to-day spending accounts (checking). Safe to spend, on the Bills tab, starts from their balance, takes off the
          regular bills and card payments that leave them before the next payday, and shows what&apos;s left. Leave credit cards and
          savings unticked.
        </p>
        {accounts.some((a) => a.source === "SIMPLEFIN" && a.currency === "USD") ? (
          <ActionForm action={setSpendingAccounts.bind(null, jar.id)} className="mt-2 flex flex-col gap-1.5">
            {accounts
              .filter((a) => a.source === "SIMPLEFIN" && a.currency === "USD")
              .map((a) => (
                <label key={a.id} className={`${checkRow} flex-wrap`}>
                  <input type="checkbox" className={checkbox} name="account" value={a.id} defaultChecked={a.spending} />
                  <span className="min-w-0 font-bold break-words">{a.name}</span>
                  {a.org && <span className="text-xs text-muted-foreground">{a.org}</span>}
                  {(a.availableCents ?? a.balanceCents) != null && (
                    <span className="text-xs text-muted-foreground">{formatMoney((a.availableCents ?? a.balanceCents)!, a.currency)}</span>
                  )}
                </label>
              ))}
            <Submit className={`${btn} self-start`}>Save</Submit>
          </ActionForm>
        ) : (
          <p className="mt-1 text-sm font-semibold">Connect the bank feed first: Safe to spend needs the bank&apos;s balance.</p>
        )}
        <ActionForm action={setCushion.bind(null, jar.id)} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex flex-wrap items-center gap-1">
            <span>Keep at least $</span>
            <input
              name="cushion"
              inputMode="decimal"
              defaultValue={centsToInput(jarRow.cushionCents)}
              placeholder="0"
              aria-label="Cushion to keep in checking"
              className={`${field} w-24`}
            />
            <span>in checking</span>
          </label>
          <Submit className={btn}>Save</Submit>
        </ActionForm>
      </section>

      <section className={card}>
        <h2 className="font-extrabold">📄 Import a statement</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A statement file from the bank or card: OFX or QFX imports straight away; a CSV shows what the app understood on a few
          rows first, so you can fix a column before anything is saved. Excel files: save as CSV first. Importing the same file
          twice adds nothing; rows the bank feed already has are folded in; an import can be removed again.
        </p>
        <StatementImport
          accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          recent={recent.map((r) => ({ id: r.id, when: when(r.createdAt), added: r.added, account: r.account.name, by: r.by?.firstName ?? null }))}
          check={checkStatement.bind(null, jar.id)}
          importFile={importStatement.bind(null, jar.id)}
          removeImport={removeStatementImport.bind(null, jar.id)}
        />
      </section>

      <section className="rounded-2xl border-2 border-dashed border-tomato/60 p-4">
        <h2 className="font-extrabold text-tomato">Delete this jar</h2>
        <p className="text-sm text-muted-foreground">Removes its accounts, transactions and connections for everyone in it.</p>
        <ActionForm action={deleteJar.bind(null, jar.id)} className="mt-2 flex flex-wrap gap-2">
          <input name="confirm" required placeholder={`Type "${jar.name}"`} aria-label="Type the jar's name to confirm" className={`${field} min-w-0 flex-1`} />
          <Submit className="inline-flex min-h-11 items-center justify-center rounded-xl bg-tomato px-4 font-bold text-white disabled:opacity-50 sm:min-h-9">Delete</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
