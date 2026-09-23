"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";
import {
  HomeIcon,
  BriefcaseIcon,
  LayersIcon,
  ArchiveIcon,
  CalendarIcon,
  MessageCircleIcon,
  BarChartIcon,
  CreditCardIcon,
  SettingsIcon,
  ImageIcon,
} from "@/components/ui/Icon";

const MENU_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: HomeIcon },
  { href: "/collaborations", label: "협찬관리", icon: BriefcaseIcon },
  { href: "/content", label: "콘텐츠 제작", icon: LayersIcon },
  { href: "/content-library", label: "콘텐츠 보관함", icon: ArchiveIcon },
  // STEP52: 협찬(collaboration)과 무관한 독립 기능이라 /content 밑에
  // 두지 않고, 다른 최상위 메뉴들과 동일한 레벨에 별도 항목으로 추가.
  { href: "/product-shorts", label: "상품 판매 숏츠", icon: ImageIcon },
  { href: "/calendar", label: "캘린더", icon: CalendarIcon },
  { href: "/comments-dm", label: "댓글 / DM", icon: MessageCircleIcon },
  { href: "/stats", label: "통계", icon: BarChartIcon },
  { href: "/pricing", label: "요금제", icon: CreditCardIcon },
  { href: "/settings", label: "설정", icon: SettingsIcon },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="hidden px-3 py-4 text-lg font-bold text-zinc-900 md:block">CREVENA</div>
      <div className="flex flex-col gap-0.5">
        {MENU_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-brand-50 text-brand-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <Icon size={18} className={isActive ? "text-brand-600" : "text-zinc-400"} />
              {item.label}
            </Link>
          );
        })}
        <SignOutButton />
      </div>
    </nav>
  );
}
