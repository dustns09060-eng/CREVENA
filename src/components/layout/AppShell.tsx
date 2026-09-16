import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { UsageBadge } from "./UsageBadge";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col border-b border-zinc-200 bg-white md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <Sidebar />
        <div className="mt-auto border-t border-zinc-100">
          <UsageBadge />
        </div>
      </aside>
      <main className="flex-1 bg-zinc-50 p-4 md:p-8">{children}</main>
    </div>
  );
}
