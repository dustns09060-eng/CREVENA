"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth-error";
import { Button } from "@/components/ui/Button";

// Always-safe message: shown for both existing and non-existing emails so
// this screen can never be used to check whether an address is registered.
const SENT_MESSAGE = "가입된 계정이라면 비밀번호 재설정 안내를 이메일로 보내드렸어요. 받은편지함(스팸함 포함)을 확인해주세요.";

function hasLinkError() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("link_error");
}

export default function ResetPasswordPage() {
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkError] = useState(hasLinkError);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });
    setLoading(false);

    // Supabase's resetPasswordForEmail does not reveal whether the address
    // is registered — real failures here are things like rate limiting, not
    // "no such user". We still show the same safe success message either
    // way to avoid any enumeration surface, but surface real client errors
    // (e.g. malformed input) if Supabase does return one.
    if (error) {
      setError(translateAuthError(error.message));
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6 text-xl font-bold text-zinc-900">
        CREVENA
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6">
        <p className="text-sm font-semibold text-zinc-900">비밀번호 찾기</p>
        <p className="mt-1 text-xs text-zinc-400">가입하신 이메일로 재설정 링크를 보내드려요.</p>

        {linkError && !sent && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            비밀번호 재설정 링크가 만료되었거나 유효하지 않아요. 아래에서 다시 요청해주세요.
          </p>
        )}

        {sent ? (
          <div className="mt-5 flex flex-col gap-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">{SENT_MESSAGE}</p>
            <Link href="/login" className="min-h-[44px] text-center text-sm text-zinc-500 hover:text-zinc-900">
              로그인으로 돌아가기
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="가입한 이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-[44px] rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" size="lg" loading={loading} loadingText="보내는 중..." className="w-full">
              재설정 이메일 받기
            </Button>

            <div className="mt-1 flex items-center justify-between text-sm text-zinc-500">
              <Link href="/find-id" className="hover:text-zinc-900">
                아이디를 잊으셨나요?
              </Link>
              <Link href="/login" className="hover:text-zinc-900">
                로그인으로
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
