"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SubmitButton } from "@/components/submit";
import { btn, btnPrimary, field } from "@/components/styles";
import { productNameKey } from "@/lib/product-name";
import { createPantryItem } from "../actions";

const SETTLE_MS = 300;

/** One box: typing narrows the Pantry below, and a name it hasn't got can be added. */
export function PantryBox({ q, filter, nameKeys, clearHref }: { q: string; filter: string; nameKeys: string[]; clearHref: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const box = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [navigating, startTransition] = useTransition();
  const stopTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stopTimer, []);
  // Back and Clear change the URL, and the box follows; not while typing is ahead of the URL.
  useEffect(() => {
    if (timer.current === undefined && !navigating) setValue((now) => (now.trim() === q ? now : q));
  }, [q, navigating]);

  const onChange = (next: string) => {
    setValue(next);
    stopTimer();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      // The URL as it is now: a filter chip tapped meanwhile stays.
      const query = new URLSearchParams(location.search);
      const typed = next.trim();
      if (typed === (query.get("q") ?? "").trim()) return;
      query.delete("item");
      if (typed) query.set("q", typed);
      else query.delete("q");
      const search = query.toString();
      startTransition(() => router.replace(search ? `/groceries/pantry?${search}` : "/groceries/pantry", { scroll: false }));
    }, SETTLE_MS);
  };

  const typed = value.trim();
  const key = productNameKey(typed);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {/* A GET form: the search lives in the URL (?q=), so Back and a shared link keep it. */}
      <Form onSubmit={stopTimer} action="/groceries/pantry" replace scroll={false} role="search" className="flex min-w-0 flex-1 basis-60 gap-2 sm:max-w-md">
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        <input
          ref={box}
          type="search"
          name="q"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={120}
          enterKeyHint="search"
          placeholder="Find or add something…"
          aria-label="Find or add something"
          className={`${field} min-w-0 flex-1`}
        />
        {q && (
          <Link href={clearHref} replace scroll={false} onClick={() => {
              stopTimer();
              setValue("");
            }}
            className={`${btn} shrink-0`}>
            Clear
          </Link>
        )}
      </Form>
      {key && !nameKeys.includes(key) && (
        <form action={createPantryItem} className="min-w-0">
          <input type="hidden" name="name" value={typed} />
          <SubmitButton className={`${btnPrimary} min-w-0 max-w-full`}>
            <span className="truncate">+ Add &ldquo;{typed}&rdquo;</span>
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
