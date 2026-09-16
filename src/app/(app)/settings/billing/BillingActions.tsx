"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PlanTier } from "@/lib/plans";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function BillingActions({
  planTier,
  subscriptionStatus,
  cancelAtPeriodEnd,
  scheduledPlan,
}: {
  planTier: PlanTier;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  scheduledPlan: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isPaid = planTier !== "FREE" && ["ACTIVE", "PAST_DUE"].includes(subscriptionStatus);
  const hasScheduledChange = cancelAtPeriodEnd || Boolean(scheduledPlan);

  function run(action: () => Promise<{ ok: boolean; data: unknown }>) {
    startTransition(async () => {
      setMessage(null);
      const { ok, data } = await action();
      const body = data as { error?: string } | null;
      if (!ok) {
        setMessage(body?.error ?? "처리에 실패했습니다.");
        return;
      }
      setMessage(null);
      router.refresh();
    });
  }

  if (!isPaid) return null;

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {!hasScheduledChange && (
          <button
            disabled={pending}
            onClick={() => run(() => postJson("/api/billing/cancel-subscription"))}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            구독 취소
          </button>
        )}
        {!hasScheduledChange && planTier === "PRO" && (
          <button
            disabled={pending}
            onClick={() => run(() => postJson("/api/billing/schedule-downgrade", { targetPlan: "BASIC" }))}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            다음 결제부터 BASIC으로 변경
          </button>
        )}
        {hasScheduledChange && (
          <button
            disabled={pending}
            onClick={() => run(() => postJson("/api/billing/cancel-scheduled-change"))}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            예약 철회
          </button>
        )}
      </div>
      {message && <p className="text-xs text-red-600">{message}</p>}
    </div>
  );
}
