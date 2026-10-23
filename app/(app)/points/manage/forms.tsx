"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { btnDanger, btnPrimary, field } from "@/components/styles";
import { deleteBucket, saveBucket, saveFamilyGoal, saveReward, type FormState } from "../actions";
import { RewardWord } from "@/components/family-look";

/** An "add" form clears itself after each successful save, ready for the next one. */
function useResetOnAdd(isAdd: boolean, state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (isAdd && state.ok) ref.current?.reset();
  }, [isAdd, state]);
  return ref;
}

function Status({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="w-full text-sm font-semibold text-destructive">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-sm font-semibold text-muted-foreground">Saved.</p>;
  return null;
}

export function FamilyGoalForm({ stickers, title }: { stickers: number | null; title: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFamilyGoal, {});
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-sm font-bold">
        <RewardWord cap />
        <input name="stickers" type="number" min={1} defaultValue={stickers ?? ""} placeholder="200" className={`${field} mt-1 block w-28`} />
      </label>
      <label className="min-w-48 flex-1 text-sm font-bold">
        For
        <input name="title" defaultValue={title ?? ""} maxLength={80} placeholder="Pizza & movie night 🍕" className={`${field} mt-1 block w-full`} />
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        Save
      </button>
      <Status state={state} />
    </form>
  );
}

export function BucketForm({ bucket }: { bucket: { id: string; name: string; emoji: string | null } | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveBucket.bind(null, bucket?.id ?? null), {});
  const formRef = useResetOnAdd(!bucket, state);
  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`bucket-emoji-${bucket?.id ?? "new"}`}>
        Emoji
      </label>
      <input id={`bucket-emoji-${bucket?.id ?? "new"}`} name="emoji" defaultValue={bucket?.emoji ?? ""} placeholder="🍬" maxLength={16} className={`${field} w-16 text-center`} />
      <label className="sr-only" htmlFor={`bucket-name-${bucket?.id ?? "new"}`}>
        Shelf name
      </label>
      <input id={`bucket-name-${bucket?.id ?? "new"}`} name="name" required defaultValue={bucket?.name ?? ""} placeholder="New shelf, e.g. Screen time" maxLength={40} className={`${field} min-w-40 flex-1`} />
      <button type="submit" disabled={pending} className={btnPrimary}>
        {bucket ? "Rename" : "Add shelf"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function DeleteBucketButton({ bucketId }: { bucketId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteBucket(bucketId);
            setError(res.error ?? null);
          })
        }
        className={btnDanger}
      >
        Remove
      </button>
      {error && <p role="alert" className="w-full text-sm font-semibold text-destructive">{error}</p>}
    </>
  );
}

type Reward = {
  id: string;
  title: string;
  emoji: string | null;
  pointCost: number;
  bucketId: string | null;
  limitPerWeek: number | null;
  needsApproval: boolean;
};

export function RewardForm({ reward, shelves }: { reward: Reward | null; shelves: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveReward.bind(null, reward?.id ?? null), {});
  const key = reward?.id ?? "new";
  const formRef = useResetOnAdd(!reward, state);
  return (
    <form ref={formRef} action={action} className="grid gap-2 rounded-2xl bg-muted p-3 sm:grid-cols-[4rem_1fr_6rem]">
      <label className="text-xs font-bold">
        Emoji
        <input name="emoji" defaultValue={reward?.emoji ?? ""} placeholder="🍦" maxLength={16} className={`${field} mt-1 block w-full text-center`} />
      </label>
      <label className="text-xs font-bold">
        Reward
        <input name="title" required maxLength={80} defaultValue={reward?.title ?? ""} placeholder="Ice cream trip" className={`${field} mt-1 block w-full`} />
      </label>
      <label className="text-xs font-bold">
        <RewardWord cap />
        <input name="pointCost" type="number" min={1} required defaultValue={reward?.pointCost ?? ""} className={`${field} mt-1 block w-full`} />
      </label>
      <label className="text-xs font-bold">
        Shelf
        <select name="bucketId" defaultValue={reward?.bucketId ?? ""} className={`${field} mt-1 block w-full`}>
          <option value="">No shelf</option>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold">
        How often
        <select name="limitPerWeek" defaultValue={reward?.limitPerWeek?.toString() ?? ""} className={`${field} mt-1 block w-full`}>
          <option value="">Any time</option>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {n} a week
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`needs-ok-${key}`} className="flex min-h-11 cursor-pointer items-center gap-2 self-end text-sm font-bold sm:min-h-9">
        <input id={`needs-ok-${key}`} name="needsApproval" type="checkbox" defaultChecked={reward?.needsApproval ?? false} className="size-5" />
        Needs an OK
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {reward ? "Save" : "Add to the store"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
