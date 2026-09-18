"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MenuIcon, XIcon } from "@/components/ui/Icon";

// STEP43 item 18: the desktop sidebar previously just reflowed into a
// horizontal-scrolling row below md — every link was reachable but cramped
// and easy to miss. This replaces that with a real header + slide-in drawer
// below md, while the existing desktop `<aside>` in AppShell is unchanged.
// `usage` is passed in as already-rendered JSX (not imported directly) since
// UsageBadge is an async Server Component and can't be imported into a
// "use client" file — AppShell (server) renders it once and slots it into
// both the desktop sidebar and this drawer.
export function MobileHeader({ usage }: { usage: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-zinc-200 bg-white md:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-lg font-bold text-zinc-900">CREVENA</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="메뉴 열기"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
        >
          <MenuIcon size={22} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-zinc-900/40" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-lg">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-lg font-bold text-zinc-900">CREVENA</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="메뉴 닫기"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
              >
                <XIcon size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto" onClick={() => setOpen(false)}>
              <Sidebar />
            </div>
            <div className="border-t border-zinc-100">{usage}</div>
          </div>
        </div>
      )}
    </div>
  );
}
