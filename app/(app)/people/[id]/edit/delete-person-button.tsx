"use client";

import { useTransition } from "react";
import { btnDanger } from "@/components/styles";
import { deletePerson } from "../../actions";

export function DeletePersonButton({ personId, name }: { personId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete ${name}? Their calls, notes, dates and relationships go too. This can't be undone.`)) return;
        start(() => deletePerson(personId));
      }}
      className={btnDanger}
    >
      {pending ? "Deleting…" : `Delete ${name}`}
    </button>
  );
}
