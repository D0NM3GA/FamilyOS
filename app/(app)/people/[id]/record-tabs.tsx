"use client";

import { useState } from "react";

export function RecordTabs({
  catchUp,
  activities,
}: {
  catchUp: React.ReactNode;
  activities: React.ReactNode;
}) {
  const [tab, setTab] = useState<"catchup" | "activities">("catchup");

  return (
    <div>
      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === "catchup"} onClick={() => setTab("catchup")}>
          Catch-up
        </TabButton>
        <TabButton active={tab === "activities"} onClick={() => setTab("activities")}>
          Activities
        </TabButton>
      </div>
      <div className="mt-4 space-y-4">{tab === "catchup" ? catchUp : activities}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 border-b-2 px-3 py-2 text-sm font-medium transition sm:min-h-9 ${
        active
          ? "border-brand text-brand-text"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
