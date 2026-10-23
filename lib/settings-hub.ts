import { SWITCHABLE_APPS } from "@/lib/apps";

/**
 * Phase 45.3: what the Settings hub shows, worked out from facts the page reads in one batch.
 * Pure, so who sees which tile and what each status says are unit-tested (settings-hub.test.ts).
 *
 * The copy rules from the design pass: every group says who it changes things for; a
 * description says what the setting does for you, never restates its label; a status says the
 * consequence in words, so it never leans on color alone.
 */

export type HubIcon =
  | "bell"
  | "key"
  | "lock"
  | "calendar"
  | "house"
  | "invite"
  | "views"
  | "palette"
  | "apps"
  | "alerts"
  | "outlook"
  | "data";

export type HubStatus = { text: string; tone: "ok" | "attention" | "neutral" };

export type HubTile = {
  id: string;
  href: string;
  title: string;
  description: string;
  icon: HubIcon;
  status?: HubStatus;
  /** Extra words the search box matches, beyond the title and description. */
  keywords: string;
  /** The look tile's small live preview. */
  preview?: { appName: string; rewardMany: string; mascot: string | null };
};

export type HubGroup = { id: string; title: string; scope: string; tiles: HubTile[] };

export type HubFacts = {
  adult: boolean;
  admin: boolean;
  /** Signed in as themselves (not a profile reached by switching), with their own sign-in. */
  ownSignIn: boolean;
  passkeySignIn: boolean;
  microsoftOwner: boolean;
  phones: number;
  passkeys: number;
  hasPin: boolean;
  homeCalendarPicked: boolean;
  familyCalendarName: string | null;
  people: number;
  bigButtons: number;
  homeSet: boolean;
  invitesWaiting: number;
  look: { appName: string; rewardMany: string; mascot: string | null };
  appsHidden: number;
  alertsTeams: boolean;
  alertsEmail: boolean;
  outlookOn: boolean;
  outlookSync: { error: boolean } | null;
  lastBackup: { at: Date; label: string } | null;
  now: Date;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const BACKUP_STALE_DAYS = 30;

export function buildHub(f: HubFacts): HubGroup[] {
  if (!f.adult) return [];
  const groups: HubGroup[] = [];

  const you: HubTile[] = [
    {
      id: "notifications",
      href: "/settings/notifications",
      title: "My notifications",
      description: "A buzz on your phone when a bill is due, a budget runs low or someone changes how they sign in.",
      icon: "bell",
      status: f.phones > 0 ? { text: `On for ${plural(f.phones, "phone")}`, tone: "ok" } : { text: "No phones yet", tone: "neutral" },
      keywords: "alerts push phone money sign-in notices",
    },
  ];
  if (f.ownSignIn && f.passkeySignIn) {
    you.push({
      id: "passkeys",
      href: "/settings/passkeys",
      title: "My passkeys",
      description: "How you sign in. A spare on a second device means a lost phone won't lock you out.",
      icon: "key",
      status: f.passkeys > 1 ? { text: plural(f.passkeys, "passkey"), tone: "ok" } : { text: "Only one: add a spare", tone: "attention" },
      keywords: "sign in security device spare",
    });
  }
  if (f.ownSignIn) {
    you.push({
      id: "lock",
      href: "/settings/lock-my-tile",
      title: "Lock my tile",
      description: "On a shared tablet, a PIN keeps the kids out of your profile, and out of the money.",
      icon: "lock",
      status: f.hasPin ? { text: "Locked with a PIN", tone: "ok" } : { text: "Anyone can open it", tone: "attention" },
      keywords: "pin profile picker kids tablet",
    });
  }
  if (f.microsoftOwner) {
    you.push({
      id: "calendar-on-home",
      href: "/settings/calendar-on-home",
      title: "Calendar on Home",
      description: "Which of your Outlook calendars shows on Home, like a family calendar synced in from Google.",
      icon: "calendar",
      status: f.homeCalendarPicked
        ? { text: "Your pick", tone: "ok" }
        : { text: f.familyCalendarName ? "The family's usual one" : "Your main calendar", tone: "neutral" },
      keywords: "outlook google calendar home",
    });
  }
  groups.push({ id: "you", title: "Just for you", scope: "Only changes things for you", tiles: you });

  const family: HubTile[] = [];
  if (f.admin) {
    family.push(
      {
        id: "household",
        href: "/settings/household",
        title: "Household and people",
        description: "Who's in the family, and roughly where home is, so outdoor chores can warn about rain.",
        icon: "house",
        status: f.homeSet
          ? { text: plural(f.people, "person", "people"), tone: "neutral" }
          : { text: `${plural(f.people, "person", "people")} · no home location`, tone: "attention" },
        keywords: "members family name timezone location weather rain zip kids grandparents",
      },
      {
        id: "sign-in",
        href: "/settings/sign-in",
        title: "Sign-in and invites",
        description: "Which grown-ups sign in on their own. Send an invite, or help someone who lost their passkey.",
        icon: "invite",
        status: f.invitesWaiting > 0 ? { text: `${plural(f.invitesWaiting, "invite")} waiting`, tone: "attention" } : { text: "No invites waiting", tone: "neutral" },
        keywords: "invite grown-up roles admin reset passkey",
      },
    );
  }
  if (f.people > 0) {
    family.push({
      id: "starting-views",
      href: "/settings/starting-views",
      title: "Starting views",
      description: "Big buttons shows one person's chores and rewards, extra large. Made for younger kids.",
      icon: "views",
      status: { text: f.bigButtons > 0 ? `${plural(f.bigButtons, "person", "people")} on Big buttons` : "Everyone on the full app", tone: "neutral" },
      keywords: "big buttons full app kids",
    });
  }
  if (family.length) {
    groups.push({ id: "family", title: "Family and sign-in", scope: f.admin ? "Admins · changes things for everyone" : "Changes things for everyone", tiles: family });
  }

  if (f.admin) {
    groups.push({
      id: "look",
      title: "Make it yours",
      scope: "Admins · changes the app for everyone",
      tiles: [
        {
          id: "make-it-yours",
          href: "/settings/make-it-yours",
          title: "Name, colors and mascot",
          description: "Name the app after your family, pick its color, choose what the kids earn, and keep or retire the mascot.",
          icon: "palette",
          keywords: "app name colors color top bar reward stickers earn mascot icon home screen",
          preview: f.look,
        },
        {
          id: "apps",
          href: "/settings/apps",
          title: "Apps",
          description: "Hide apps your family won't use, so menus stay short. Nothing is deleted.",
          icon: "apps",
          status: { text: f.appsHidden > 0 ? `${f.appsHidden} hidden` : `All ${SWITCHABLE_APPS.length} on`, tone: "neutral" },
          keywords: "turn off hide features",
        },
      ],
    });
  }

  const connect: HubTile[] = [];
  if (f.admin) {
    const on = [f.alertsTeams && "Teams", f.alertsEmail && "email"].filter(Boolean).join(" and ");
    connect.push({
      id: "alerts",
      href: "/settings/alerts",
      title: "Store order alerts",
      description: "When a kid spends their rewards, a grown-up hears about it in Teams, by email or on their phone, so the prize shows up.",
      icon: "alerts",
      status: on ? { text: `On: ${on}`, tone: "ok" } : { text: "Only the bell: no Teams or email", tone: "attention" },
      keywords: "teams email store orders phone",
    });
  }
  if (f.outlookOn) {
    connect.push({
      id: "outlook",
      href: "/calendar/outlook",
      title: "Family calendar in Outlook",
      description: "Puts birthdays, car maintenance and more in everyone's Outlook, right next to work meetings.",
      icon: "outlook",
      status: !f.outlookSync
        ? { text: "Not set up", tone: "neutral" }
        : f.outlookSync.error
          ? { text: "Needs a look: the last sync failed", tone: "attention" }
          : { text: "Syncing", tone: "ok" },
      keywords: "outlook microsoft birthdays calendar sync",
    });
  }
  const staleDays = f.lastBackup ? (f.now.getTime() - f.lastBackup.at.getTime()) / 86_400_000 : Infinity;
  connect.push({
    id: "data",
    href: "/data",
    title: "Data and backups",
    description: "A full backup to keep somewhere safe, or a spreadsheet of any app. It's your family's data.",
    icon: "data",
    status: !f.lastBackup
      ? { text: "No backup yet", tone: "attention" }
      : { text: `Last backup: ${f.lastBackup.label.toLowerCase()}`, tone: staleDays > BACKUP_STALE_DAYS ? "attention" : "ok" },
    keywords: "backup download spreadsheets export restore",
  });
  groups.push({
    id: "connect",
    title: "Connections and data",
    scope: "Grown-ups · changes things for everyone",
    tiles: connect,
  });

  return groups;
}
