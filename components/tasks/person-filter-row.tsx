import { chipRow } from "@/components/styles";
import { shortNames } from "@/lib/people";
import { PersonFilterChip } from "./person-filter-chip";

type Member = { id: string; firstName: string; lastName: string | null; photoContentType: string | null };

/**
 * Chores' and Meds' "whose" row: Everyone, then each member with their total. Names are as
 * short as still tells people apart (`shortNames`). Whoever is on top bobs, ties included,
 * and nobody does while everyone is still at 0.
 */
export function PersonFilterRow({
  members,
  tally,
  path,
  everyoneHref,
  selected,
}: {
  members: Member[];
  tally: { person: { id: string }; points: number }[];
  path: string;
  everyoneHref: string;
  selected: string | undefined;
}) {
  const names = shortNames(members);
  const points = new Map(tally.map((t) => [t.person.id, t.points]));
  const top = Math.max(0, ...points.values());

  return (
    <nav aria-label={`Whose ${path.slice(1)}`} className={`mt-4 ${chipRow}`}>
      <PersonFilterChip label="Everyone" active={!selected} href={everyoneHref} />
      {members.map((m) => (
        <PersonFilterChip
          key={m.id}
          label={names.get(m.id) ?? m.firstName}
          active={selected === m.id}
          href={{ pathname: path, query: { person: m.id } }}
          person={{ id: m.id, initial: m.firstName, hasPhoto: m.photoContentType !== null }}
          points={points.get(m.id) ?? 0}
          leader={top > 0 && points.get(m.id) === top}
        />
      ))}
    </nav>
  );
}
