"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function RefundButton({ paymentEventId, remaining }: { paymentEventId: string; remaining: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(remaining);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Generated once per dialog open, not per click — so a double-click or a
  // retried submit while this dialog stays open reuses the same key and
  // hits the server's idempotency guard instead of refunding twice.
  const idempotencyKey = useMemo(() => (open ? crypto.randomUUID() : null), [open]);

  if (remaining <= 0) {
    return <span className="text-xs text-zinc-400">환불 완료</span>;
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setAmount(remaining);
          setMessage(null);
          setOpen(true);
        }}
        className="text-xs font-medium text-red-600 hover:underline"
      >
        환불
      </button>
    );
  }

  function submit() {
    if (!idempotencyKey) return;
    startTransition(async () => {
      setMessage(null);
      const res = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentEventId, amount, reason, idempotencyKey }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(data?.error ?? "환불에 실패했습니다.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-2">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={remaining}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs"
        />
        <span className="text-xs text-zinc-500">/ 최대 ₩{remaining.toLocaleString()}</span>
      </div>
      <input
        type="text"
        placeholder="환불 사유"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <Button
          variant="danger"
          size="sm"
          disabled={pending || amount <= 0 || amount > remaining}
          loading={pending}
          loadingText="처리 중..."
          onClick={submit}
        >
          환불 실행
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setOpen(false)}>
          취소
        </Button>
      </div>
      {message && <p className="text-xs text-red-600">{message}</p>}
    </div>
  );
}
