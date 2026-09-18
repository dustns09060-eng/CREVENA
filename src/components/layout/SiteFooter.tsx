import Link from "next/link";
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/support";

// STEP45: one shared footer for the public surface (landing + the four
// policy/info pages) so the legal links are reachable from anywhere a
// logged-out visitor can land.
//
// Deliberately NO business-registration block (상호/대표자/사업자등록번호/주소).
// Nothing in this repo establishes those values, and putting invented or
// obviously-placeholder text into a production-facing footer would be worse
// than omitting it — see the STEP45 report's "운영자 입력 필요 정보" section.
// Add the block here once the operator supplies real values.
//
// STEP45.1: the 고객문의 email IS now confirmed, so it is shown below. It is
// the only contact detail added — no phone number, no address, and still no
// 사업자등록번호/통신판매업 신고번호, because none of those were provided.
const FOOTER_LINKS = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/refund-policy", label: "환불정책" },
  { href: "/contact", label: "문의하기" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-zinc-700">CREVENA</span>
          <span className="text-xs text-zinc-400">크리에이터를 위한 협찬 콘텐츠 제작 도구</span>
          <span className="text-xs text-zinc-400">
            고객문의{" "}
            <a href={SUPPORT_EMAIL_HREF} className="transition-colors hover:text-zinc-900">
              {SUPPORT_EMAIL}
            </a>
          </span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-zinc-500 transition-colors hover:text-zinc-900"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="border-t border-zinc-200">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-zinc-400 sm:px-6">
          © {new Date().getFullYear()} CREVENA
        </div>
      </div>
    </footer>
  );
}
