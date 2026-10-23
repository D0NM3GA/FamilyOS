"use client";

import Link from "next/link";
import { useActionState, useRef, useEffect, useState } from "react";
import { btn, btnPrimary, field, sectionTitle } from "@/components/styles";
import { addRelationship, removeRelationship, type FormState } from "./actions";
import { ConfirmSubmit } from "@/components/submit";

const TYPE_LABEL: Record<string, string> = {
  SPOUSE: "Spouse",
  PARENT: "Parent",
  CHILD: "Child",
  SIBLING: "Sibling",
  OTHER: "Other",
};

export function RelationshipsCard({
  personId,
  personFirstName,
  relationships,
  pickablePeople,
  canEdit,
}: {
  personId: string;
  personFirstName: string;
  relationships: {
    id: string;
    otherPerson: { id: string; firstName: string; lastName: string | null };
    type: string;
    label: string | null;
  }[];
  pickablePeople: { id: string; firstName: string; lastName: string | null }[];
  /** A family-tree edit is structural data — gated to adults, like updatePerson. */
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addRelationship.bind(null, personId),
    {},
  );
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("SPOUSE");
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      formRef.current?.reset();
      setType("SPOUSE");
      setOpen(false);
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <div className="min-w-0 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <h2 className={sectionTitle}>Relationships</h2>
        {canEdit && !open && pickablePeople.length > 0 && (
          <button onClick={() => setOpen(true)} className={btn}>
            + Add
          </button>
        )}
      </div>

      {relationships.length === 0 && !open && (
        <p className="mt-2 text-xs text-muted-foreground">No relationships added yet.</p>
      )}

      {relationships.length > 0 && (
        <ul className="mt-2 space-y-2">
          {relationships.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link
                href={`/people/${r.otherPerson.id}`}
                className="flex min-h-11 min-w-0 items-center text-foreground hover:underline sm:min-h-0"
              >
                <span className="truncate">
                  {r.otherPerson.firstName}
                  {r.otherPerson.lastName ? ` ${r.otherPerson.lastName}` : ""}
                </span>
              </Link>
              <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">
                  {r.label || TYPE_LABEL[r.type] || r.type}
                </span>
                {canEdit && (
                  <form action={removeRelationship.bind(null, personId, r.id)}>
                    <ConfirmSubmit
                      question={`Remove the link to ${r.otherPerson.firstName}? Nobody leaves People.`}
                      yes="Remove"
                      aria-label={`Remove ${r.otherPerson.firstName} relationship`}
                    >
                      Remove
                    </ConfirmSubmit>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <form
          ref={formRef}
          action={formAction}
          className="mt-3 w-full min-w-0 space-y-2 rounded-md bg-muted p-3"
        >
          <select
            name="otherPersonId"
            required
            defaultValue=""
            aria-label="Person"
            className={`${field} w-full min-w-0`}
          >
            <option value="" disabled>
              Choose a person…
            </option>
            {pickablePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName}
                {p.lastName ? ` ${p.lastName}` : ""}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">is {personFirstName}&apos;s</span>
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={`${field} w-full min-w-0`}
            >
              <option value="SPOUSE">Spouse</option>
              <option value="PARENT">Parent</option>
              <option value="CHILD">Child</option>
              <option value="SIBLING">Sibling</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          {type === "OTHER" && (
            <input
              name="label"
              placeholder="e.g. Godparent, Neighbor"
              aria-label="What they are to each other"
              required
              className={`${field} w-full min-w-0`}
            />
          )}
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={btn}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
