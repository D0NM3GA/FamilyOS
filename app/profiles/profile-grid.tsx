"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { PinDialog } from "./pin-dialog";
import { SignOutButton } from "./sign-out-button";

type Tile = {
  id: string;
  label: string;
  role: "ADULT" | "KID" | "ADMIN" | null;
  hasPhoto: boolean;
  color: { bg: string; fg: string };
  /** A PIN, their own sign-in (Microsoft or otherwise), or neither yet (an admin sets PINs). */
  opensWith: "pin" | "microsoft" | "own" | "nothing";
};

type SelfTile = {
  id: string;
  label: string;
  hasPhoto: boolean;
  color: { bg: string; fg: string };
  action: (formData: FormData) => void | Promise<void>;
  /** Their own tile asks for their PIN (switching back from someone else, or a while after signing in). */
  locked: boolean;
};

// Phase 19: these tiles are stickers, the one place a tilt belongs — kept small (±2°)
// after the earlier ±3–8° read as off-putting the longer you looked at it.
const TILTS = ["-rotate-2", "rotate-2", "rotate-1", "-rotate-1"];

const STICKER_SHAPE =
  "rounded-[28px] border-[3px] border-ink shadow-[0_0_0_5px_#fff,6px_6px_0_5px_rgb(31_41_51/0.13)] transition";

/**
 * One picker tile — always a single <button> (submit inside the "you" form, or a plain
 * button wired to onClick for everyone else) so the rotation/hover wrapper never ends up
 * nesting a real <button> inside another, which is invalid HTML and breaks click handling.
 */
function PickerTile({
  index,
  label,
  note,
  avatar,
  onClick,
  submit,
}: {
  index: number;
  label: string;
  note?: string;
  avatar: React.ReactNode;
  onClick?: () => void;
  submit?: boolean;
}) {
  const tilt = TILTS[index % TILTS.length];
  return (
    <button
      type={submit ? "submit" : "button"}
      onClick={onClick}
      className="group flex w-36 flex-col items-center gap-2 animate-in fade-in zoom-in-50 fill-mode-backwards duration-500"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <span
        className={`inline-block transition-all duration-200 ${tilt} group-hover:rotate-0 group-hover:-translate-y-1.5 group-hover:scale-105`}
      >
        {avatar}
      </span>
      <span className="font-heading text-xl font-bold text-foreground transition group-hover:text-brand-text">
        {label}
      </span>
      {note && <span className="-mt-2 text-xs font-bold text-muted-foreground">{note}</span>}
    </button>
  );
}

export function ProfileGrid({ self, people }: { self: SelfTile; people: Tile[] }) {
  const [active, setActive] = useState<Tile | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const selfAvatar = (
    <Avatar personId={self.id} hasPhoto={self.hasPhoto} initial={self.label} size={120} color={self.color} shapeClass={STICKER_SHAPE} />
  );

  return (
    <>
      <div className="flex flex-wrap justify-center gap-10">
        {self.locked ? (
          <PickerTile index={0} label={`${self.label} (you)`} note="🔒 PIN" onClick={() => setUnlocking(true)} avatar={selfAvatar} />
        ) : (
          <form action={self.action}>
            <PickerTile index={0} label={`${self.label} (you)`} submit avatar={selfAvatar} />
          </form>
        )}

        {people.map((person, i) => (
          <PickerTile
            key={person.id}
            index={i + 1}
            label={person.label}
            note={person.opensWith === "microsoft" ? "Microsoft sign-in" : person.opensWith === "own" ? "Own sign-in" : undefined}
            onClick={() => setActive(person)}
            avatar={
              <Avatar
                personId={person.id}
                hasPhoto={person.hasPhoto}
                initial={person.label}
                size={120}
                color={person.color}
                shapeClass={STICKER_SHAPE}
              />
            }
          />
        ))}
      </div>

      {active?.opensWith === "pin" && <PinDialog personId={active.id} label={active.label} onClose={() => setActive(null)} />}
      {unlocking && <PinDialog personId={self.id} label={self.label} onClose={() => setUnlocking(false)} />}
      {(active?.opensWith === "microsoft" || active?.opensWith === "own") && (
        <NoteDialog
          title={active.opensWith === "microsoft" ? `${active.label} signs in with Microsoft` : `${active.label} signs in on their own`}
          onClose={() => setActive(null)}
        >
          <p>
            Their profile only opens with their own sign-in (it keeps their money and messages private).
            To switch, sign out here and let them sign in.
          </p>
          <SignOutButton className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-brand font-bold text-white hover:bg-brand-hover disabled:opacity-50">
            Sign out so they can sign in
          </SignOutButton>
        </NoteDialog>
      )}
      {active?.opensWith === "nothing" && (
        <NoteDialog title={`${active.label} has no PIN yet`} onClose={() => setActive(null)}>
          <p>A grown-up with the Admin role can give them one in Settings → Household.</p>
        </NoteDialog>
      )}
    </>
  );
}

/** The picker's small explainer, a native modal dialog like the PIN one. */
function NoteDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="note-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-full max-w-xs rounded-3xl border-2 border-ink bg-card p-6 text-sm text-foreground shadow-xl backdrop:bg-black/50 animate-in zoom-in-95 duration-200 dark:border-white/20"
    >
      <h2 id="note-title" className="mb-2 text-xl font-extrabold">
        {title}
      </h2>
      {children}
      <button
        type="button"
        onClick={onClose}
        className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl font-bold text-muted-foreground ring-1 ring-input hover:bg-muted"
      >
        OK
      </button>
    </dialog>
  );
}
