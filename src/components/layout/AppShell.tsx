import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { UsageBadge } from "./UsageBadge";
import { MobileHeader } from "./MobileHeader";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <MobileHeader usage={<UsageBadge />} />
      <aside className="hidden border-zinc-200 bg-white md:flex md:w-60 md:shrink-0 md:flex-col md:border-r">
        <Sidebar />
        <div className="mt-auto border-t border-zinc-100">
          <UsageBadge />
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
