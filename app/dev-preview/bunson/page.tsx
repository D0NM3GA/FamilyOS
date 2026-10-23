import { notFound } from "next/navigation";
import { Bunson } from "@/components/bunson";

// Harness for visually verifying Bunson without the Entra sign-in round-trip
// on every dev-server restart. Not linked from any nav, not auth-gated —
// gated to dev only instead (see below). Kept deliberately past Bunson's
// original 4 build phases as ongoing tooling for any future tweak to him.
export default function BunsonPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-muted p-8">
      <h1 className="text-lg font-semibold text-foreground">Bunson dev preview</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Click Bunson to reveal him &mdash; he stays up for good after that.
        Move the cursor and he&apos;ll chase it in discrete physical hops
        (never in real time, and he can&apos;t keep up with a fast-moving
        cursor). Click him again any time to have him stand up and say
        something; he stops hopping while he&apos;s talking and resumes once
        the bubble&apos;s gone.
      </p>
      <Bunson />
    </div>
  );
}
