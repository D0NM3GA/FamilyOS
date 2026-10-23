// Phase 19: Data stays quiet — an opaque plain-paper wrapper covers the graph paper the
// (app) <main> paints everywhere else (app/globals.css), so this page reads calm and fast.
export default function QuietLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full bg-muted">{children}</div>;
}
