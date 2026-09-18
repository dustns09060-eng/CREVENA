"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth-error";
import { Button } from "@/components/ui/Button";

const CONFIRM_ERROR_MESSAGE =
  "이메일 인증 링크가 만료되었거나 이미 사용되었습니다. 다시 로그인해보시거나, 필요하면 재가입해주세요.";

function hasConfirmError() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("confirm_error");
}

// STEP43: split out so useSearchParams (reads ?mode=signup from the landing
// page's CTA) stays inside a Suspense boundary, per Next.js's requirement —
// none of the actual auth logic below changed from the previous version.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();

  const [mode, setMode] = useState<"signin" | "signup">(
    searchParams.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => (hasConfirmError() ? CONFIRM_ERROR_MESSAGE : null));
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [signedUpEmail, setSignedUpEmail] = useState<string | null>(null);

  async function handleResend() {
    if (!signedUpEmail) return;
    setResending(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: signedUpEmail });
    setResending(false);
    setNotice(
      error
        ? translateAuthError(error.message)
        : "인증 메일을 다시 보냈어요. 받은편지함(스팸함 포함)을 확인해주세요.",
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        setError(translateAuthError(error.message));
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setLoading(false);
      if (error) {
        setError(translateAuthError(error.message));
        return;
      }
      setSignedUpEmail(email);
      setNotice(
        "가입 완료! 입력하신 이메일로 인증 메일을 보냈습니다. 받은편지함(스팸함 포함)에서 링크를 클릭한 뒤 로그인해주세요.",
      );
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6 text-xl font-bold text-zinc-900">
        CREVENA
      </Link>
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6">
        <p className="text-sm font-semibold text-zinc-900">{mode === "signin" ? "로그인" : "회원가입"}</p>
        <p className="mt-1 text-xs text-zinc-400">
          {mode === "signin" ? "다시 만나서 반가워요." : "무료로 바로 시작할 수 있어요."}
        </p>

        <div className="mt-5 flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-[44px] rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-[44px] rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-3 text-sm text-emerald-600">{notice}</p>}

        {mode === "signup" && signedUpEmail && (
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="mt-2 text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            {resending ? "다시 보내는 중..." : "인증 이메일 다시 보내기"}
          </button>
        )}

        <Button type="submit" size="lg" loading={loading} loadingText="처리중..." className="mt-4 w-full">
          {mode === "signin" ? "로그인" : "가입하기"}
        </Button>

        {mode === "signin" && (
          <div className="mt-3 flex items-center justify-center gap-3 text-xs text-zinc-500">
            <Link href="/find-id" className="hover:text-zinc-900">
              아이디 찾기
            </Link>
            <span className="text-zinc-300">|</span>
            <Link href="/reset-password" className="hover:text-zinc-900">
              비밀번호 찾기
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
            setSignedUpEmail(null);
          }}
          className="mt-3 min-h-[44px] w-full text-center text-sm text-zinc-500 hover:text-zinc-900"
        >
          {mode === "signin" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
