"use client";

import { useRouter } from "next/navigation";
import { field } from "@/components/styles";

/** One filter instead of a wall of chips. Each choice carries its own link, so month and account stay. */
export function CategoryFilter({ options, current }: { options: { value: string; label: string; href: string }[]; current: string }) {
  const router = useRouter();
  return (
    <label className="mt-3 block">
      <span className="sr-only">Filter by category</span>
      <select
        value={current}
        onChange={(event) => {
          const chosen = options.find((o) => o.value === event.target.value);
          if (chosen) router.push(chosen.href);
        }}
        className={`${field} w-full sm:w-auto`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
