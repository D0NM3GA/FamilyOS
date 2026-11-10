"use client";

import { useTransition } from "react";
import { ConfirmAction } from "@/components/submit";
import { deletePerson } from "../../actions";

export function DeletePersonButton({ personId, name }: { personId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <ConfirmAction
      question={`Delete ${name}? Their calls, notes, dates and relationships go too. This can't be undone.`}
      yes={`Delete ${name}`}
      pending={pending}
      onConfirm={() => start(() => deletePerson(personId))}
    >
      {`Delete ${name}`}
    </ConfirmAction>
  );
}
