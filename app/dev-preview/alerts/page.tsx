import { notFound } from "next/navigation";
import { ThisDevice } from "@/app/(app)/settings/alerts/this-device";
import { getVapid } from "@/lib/alerts/vapid";

// Phase 21.6 harness: the "This phone" card's states without signing in. Dev only. Turning
// push on here calls the real actions, which need a signed-in admin — render-only.
export default async function AlertsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const configured = (await getVapid())?.publicKey ?? null;
  return (
    <div className="space-y-6 bg-muted p-6">
      <h1 className="text-xl font-semibold">This phone preview</h1>
      <section className="max-w-xl rounded-lg bg-card p-4 ring-1 ring-border">
        <h2 className="mb-2 font-semibold">With server keys ({configured ? "configured" : "a sample key"})</h2>
        <ThisDevice vapidPublicKey={configured ?? "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"} />
      </section>
      <section className="max-w-xl rounded-lg bg-card p-4 ring-1 ring-border">
        <h2 className="mb-2 font-semibold">Without server keys</h2>
        <ThisDevice vapidPublicKey={null} />
      </section>
    </div>
  );
}
