import Link from "next/link";
import { Button } from "@/components/ui/Button";

// CREVENA logs in with email as the account identifier — there is no
// separate username. So "아이디 찾기" is intentionally NOT an email-lookup
// feature: building one (searching users by name/phone to reveal their
// email) would be a user-enumeration vulnerability and would need
// service_role/admin access from a public page. Instead this page explains
// that the login email itself is the ID, and routes the user to the safe
// password-recovery flow, which needs no account-existence lookup at all.
export default function FindIdPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6 text-xl font-bold text-zinc-900">
        CREVENA
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6">
        <p className="text-sm font-semibold text-zinc-900">아이디 찾기</p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          CREVENA는 별도의 아이디 없이, 가입할 때 사용한 <b>이메일 주소</b>가 곧 로그인 아이디예요.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          가입한 이메일 주소가 기억나지 않는다면, 평소 사용하시는 이메일로 로그인을 먼저 시도해보시거나 비밀번호 찾기를
          이용해 로그인 가능 여부를 확인해보세요.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Link href="/reset-password">
            <Button variant="secondary" className="w-full">
              비밀번호 찾기로 이동
            </Button>
          </Link>
          <Link href="/login" className="min-h-[44px] text-center text-sm text-zinc-500 hover:text-zinc-900">
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
