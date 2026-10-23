import Link from "next/link";
import { Check, Minus, Plus } from "lucide-react";
import { amountLabel, describeSize, type Size } from "@/lib/groceries/size";
import { btn, btnDanger } from "@/components/styles";
import { setQuantity, toggleItem, vetoItem } from "./actions";
import { TakeOffButton } from "./list-undo";
import { ConfirmSubmit, SubmitButton } from "@/components/submit";

const stepBtn = "flex size-11 items-center justify-center text-muted-foreground hover:text-foreground sm:size-9";

export type ListRowItem = {
  id: string;
  quantity: number;
  done: boolean;
  product: Size & { name: string; group: { emoji: string | null } | null };
  requestedBy: { firstName: string } | null;
};

/** The veto's question: the kid's note can't be taken back once it's sent. */
function vetoQuestion(item: ListRowItem): string {
  const who = item.requestedBy?.firstName;
  return `Take ${item.product.name} off the list? ${who ? `${who} gets` : "They get"} a kind note saying not this time.`;
}

/**
 * One list row (Phase 22): check it off, tap the name for the item sheet, −/+ the amount.
 * "Needs details" is a sticker, not an error: it goes away once the size is known.
 */
export function ListRow({ item, href, vetoable = false }: { item: ListRowItem; href: string; vetoable?: boolean }) {
  const size = describeSize(item.product);
  return (
    <li className="flex flex-wrap items-center gap-2 px-2 py-2 sm:gap-3 sm:px-3">
      <form action={toggleItem.bind(null, item.id, !item.done)}>
        {/* The circle stays small; the button around it is the thumb-sized target. */}
        <SubmitButton
          className="flex size-11 shrink-0 items-center justify-center rounded-full sm:size-9"
          aria-label={
            item.done
              ? `Put ${item.product.name} back`
              : `Got ${item.product.name}`
          }
        >
          <span
            className={`flex size-8 items-center justify-center rounded-full border-2 ${
              item.done
                ? "border-lime bg-lime text-ink"
                : "border-ink/40 dark:border-white/40"
            }`}
          >
            {item.done && <Check size={16} strokeWidth={3} />}
          </span>
        </SubmitButton>
      </form>

      <Link
        href={href}
        scroll={false}
        className="flex min-w-0 flex-1 items-center gap-2.5"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-lg"
          aria-hidden
        >
          {item.product.group?.emoji ?? "🛒"}
        </span>
        <span className="min-w-0">
          <span
            className={`line-clamp-2 font-bold leading-tight break-words ${item.done ? "text-muted-foreground line-through" : ""}`}
          >
            {item.product.name}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {size ? (
              <span className="font-hand text-base leading-tight text-muted-foreground">{size}</span>
            ) : (
              <span className="inline-block -rotate-1 rounded-md bg-sun px-1.5 text-xs font-bold text-ink">
                Needs details
              </span>
            )}
            {item.requestedBy && (
              <span className="rounded-full border-2 border-sky px-2 text-xs font-bold text-brand-text">
                for {item.requestedBy.firstName}
              </span>
            )}
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 items-center rounded-xl border-2 border-ink/15 dark:border-white/15">
        {item.quantity <= 1 ? (
          // Down to zero takes it off the list, so it gets an Undo (list-undo.tsx).
          <TakeOffButton itemId={item.id} name={item.product.name} className={`${stepBtn} disabled:opacity-50`}>
            <Minus size={16} />
          </TakeOffButton>
        ) : (
          <form action={setQuantity.bind(null, item.id, item.quantity - 1)}>
            <SubmitButton className={stepBtn} aria-label={`One less ${item.product.name}`}>
              <Minus size={16} />
            </SubmitButton>
          </form>
        )}
        <span className="min-w-12 text-center text-sm font-bold">
          {amountLabel(item.quantity, item.product.container)}
        </span>
        <form action={setQuantity.bind(null, item.id, item.quantity + 1)}>
          <SubmitButton
            className={stepBtn}
            aria-label={`One more ${item.product.name}`}
          >
            <Plus size={16} />
          </SubmitButton>
        </form>
      </div>
      {vetoable && (
        // Phase 23: a kid's own pick. Grown-ups can take it off; the kid gets a kind note.
        // Phase 38: asks first, since the note can't be taken back.
        <form action={vetoItem.bind(null, item.id)} className="basis-full pl-13 sm:basis-auto sm:pl-0">
          <ConfirmSubmit question={vetoQuestion(item)} yes="Not this time" aria-label={`Not this time: ${item.product.name}`} className={btn} yesClassName={btnDanger}>
            Not this time
          </ConfirmSubmit>
        </form>
      )}
    </li>
  );
}
