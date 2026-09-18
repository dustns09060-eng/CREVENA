"use client";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";

// STEP45: this boundary used to render `error.message` verbatim, which is the
// one remaining place a raw exception string (a Supabase/PortOne driver
// message, a thrown "QUOTA_EXCEEDED", or a stack-trace-ish string) could
// reach a user's screen — exactly what ui/States' ErrorState was introduced
// to prevent. The message is now a fixed Korean sentence.
//
// `digest` is Next.js's own stable hash for the error and contains no user
// data or internal detail, so it is kept and shown as a support reference —
// it is what lets an operator find the matching server log entry. The retry
// behaviour (`reset()`) is unchanged.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <ErrorState message="예기치 못한 문제가 발생했어요. 잠시 후 다시 시도해 주세요. 계속 반복되면 문의해 주세요." />

        {error.digest && (
          <p className="text-center text-xs text-zinc-400">오류 코드: {error.digest}</p>
        )}

        <div className="flex justify-center">
          <Button onClick={reset}>다시 시도</Button>
        </div>
      </div>
    </div>
  );
}
