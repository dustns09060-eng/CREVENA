"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// STEP45.1: 회원탈퇴 danger zone. Two gates before anything is sent:
// (1) the button opens a modal rather than deleting, and (2) inside the
// modal the destructive button stays disabled until the exact word is
// typed. Both are UX guards, not the security boundary — the server route
// independently re-derives the caller from their session cookie and ignores
// anything this component could send.
const CONFIRM_WORD = "탈퇴";

export function DangerZone({ blockedBySubscription }: { blockedBySubscription: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setTyped("");
    setError(null);
  }

  function handleDelete() {
    if (typed.trim() !== CONFIRM_WORD || pending) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/account/delete", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      // Clear the local session too, so the browser does not keep a stale
      // token for an identity that no longer exists.
      await createSupabaseBrowserClient()
        .auth.signOut()
        .catch(() => undefined);
      router.replace("/?goodbye=1");
      router.refresh();
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-red-200 bg-red-50/50 p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-red-700">회원탈퇴</h2>
      <p className="mt-1 text-sm text-red-700/80">
        계정을 삭제하면 협찬 기록, 생성한 콘텐츠, 업로드한 사진·영상이 모두 삭제되며 복구할 수
        없습니다.
      </p>

      {blockedBySubscription ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-red-700">구독 해지 후 회원탈퇴가 가능합니다.</p>
          <Link href="/settings/billing" className="mt-2 inline-block">
            <Button variant="secondary" size="sm">
              결제 설정으로 이동
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-4">
          <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
            회원탈퇴
          </Button>
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        title="정말 탈퇴하시겠어요?"
        description="협찬, 콘텐츠, 업로드한 사진과 영상이 모두 영구 삭제되며 복구할 수 없습니다. 계속하려면 아래에 '탈퇴'를 입력해 주세요."
      >
        <label htmlFor="delete-confirm" className="text-xs font-medium text-zinc-700">
          확인 문구 입력
        </label>
        <input
          id="delete-confirm"
          type="text"
          value={typed}
          disabled={pending}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          placeholder={CONFIRM_WORD}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-100"
        />
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        <Button
          variant="danger"
          size="sm"
          disabled={typed.trim() !== CONFIRM_WORD || pending}
          loading={pending}
          loadingText="탈퇴 처리 중..."
          onClick={handleDelete}
        >
          영구 삭제하기
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={close}>
          취소
        </Button>
      </Modal>
    </div>
  );
}
