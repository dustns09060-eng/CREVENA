"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";

const MENU_ITEMS = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/collaborations", label: "협찬관리" },
  { href: "/content", label: "콘텐츠 제작" },
  { href: "/content-library", label: "콘텐츠 보관함" },
  { href: "/calendar", label: "캘린더" },
  { href: "/comments-dm", label: "댓글 / DM" },
  { href: "/stats", label: "통계" },
  { href: "/pricing", label: "요금제" },
  { href: "/settings", label: "설정" },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="px-3 py-2 text-lg font-bold text-zinc-900 md:py-4">
        CREVENA
      </div>
      <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {MENU_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <SignOutButton />
      </div>
    </nav>
  );
}
