import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";

const ADMIN_NAV = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/users", label: "사용자" },
  { href: "/admin/usage", label: "AI 사용량/비용" },
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { email } = await requireAdmin();

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-bold text-zinc-900">CreatorFlow 관리자</span>
            <nav className="flex gap-1 overflow-x-auto">
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">{email}</span>
            <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-900">
              앱으로 돌아가기
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
    </div>
  );
}
