"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth-error";

const CONFIRM_ERROR_MESSAGE =
  "이메일 인증 링크가 만료되었거나 이미 사용되었습니다. 다시 로그인해보시거나, 필요하면 재가입해주세요.";

function hasConfirmError() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("confirm_error");
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => (hasConfirmError() ? CONFIRM_ERROR_MESSAGE : null));
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      setNotice(
        "가입 완료! 입력하신 이메일로 인증 메일을 보냈습니다. 받은편지함(스팸함 포함)에서 링크를 클릭한 뒤 로그인해주세요.",
      );
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6"
      >
        <h1 className="text-xl font-bold text-zinc-900">CreatorFlow</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {mode === "signin" ? "로그인" : "회원가입"}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
          />
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-3 text-sm text-emerald-600">{notice}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "처리중..." : mode === "signin" ? "로그인" : "가입하기"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="mt-3 w-full text-center text-sm text-zinc-500 hover:text-zinc-900"
        >
          {mode === "signin" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
        </button>
      </form>
    </div>
  );
}
