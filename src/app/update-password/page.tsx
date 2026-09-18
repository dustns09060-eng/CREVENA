"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth-error";
import { Button } from "@/components/ui/Button";

// Reached only via /auth/callback after a valid password-recovery link
// exchange (see route.ts's next=/update-password branch), which leaves the
// browser with a real Supabase session. If that session is somehow missing
// (direct navigation, expired link before the redirect even landed here),
// we show the same "link invalid" messaging instead of a raw auth error.
export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setCheckingSession(false);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("새 비밀번호가 서로 일치하지 않아요.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(translateAuthError(error.message));
      return;
    }
    setDone(true);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6 text-xl font-bold text-zinc-900">
        CREVENA
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6">
        <p className="text-sm font-semibold text-zinc-900">새 비밀번호 설정</p>

        {checkingSession ? (
          <p className="mt-4 text-sm text-zinc-500">확인하는 중...</p>
        ) : !hasSession ? (
          <div className="mt-5 flex flex-col gap-4">
            <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
              비밀번호 재설정 링크가 만료되었거나 유효하지 않아요.
            </p>
            <Link href="/reset-password">
              <Button variant="secondary" className="w-full">
                재설정 이메일 다시 받기
              </Button>
            </Link>
          </div>
        ) : done ? (
          <div className="mt-5 flex flex-col gap-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
              비밀번호가 변경되었어요. 새 비밀번호로 로그인해주세요.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                router.push("/login");
              }}
            >
              로그인하기
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <input
              type="password"
              required
              minLength={6}
              placeholder="새 비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-[44px] rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="새 비밀번호 확인"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="min-h-[44px] rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" size="lg" loading={loading} loadingText="변경하는 중..." className="w-full">
              비밀번호 변경
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
