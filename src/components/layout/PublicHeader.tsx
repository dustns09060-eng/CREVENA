import Link from "next/link";
import { Button } from "@/components/ui/Button";

// STEP45: the public-surface header, extracted from the landing page so the
// landing page and the four policy/info pages share one identical header
// instead of each re-declaring the markup.
export function PublicHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-bold text-zinc-900">
          CREVENA
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/login"
            className="px-2 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
          >
            로그인
          </Link>
          <Link href="/login?mode=signup">
            <Button size="sm">무료로 시작하기</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
