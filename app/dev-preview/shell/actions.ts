"use server";

import { notFound } from "next/navigation";

/** Dev-preview stand-in for the chore/med actions: a real server action that does nothing. */
export async function previewNoop(instanceId: string): Promise<void> {
  if (process.env.NODE_ENV === "production") notFound();
  void instanceId;
}
