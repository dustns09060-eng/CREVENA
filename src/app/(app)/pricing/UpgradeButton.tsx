"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startPlanUpgrade } from "@/lib/billing/plan-payment";
import type { PlanTier } from "@/lib/plans";
import { Button } from "@/components/ui/Button";

export function UpgradeButton({
  plan,
  userId,
  label,
}: {
  plan: PlanTier;
  userId: string | null;
  label: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (plan === "FREE") {
      setMessage("플랜 다운그레이드는 다음 결제 주기에 반영되도록 준비 중입니다.");
      return;
    }
    if (!userId) {
      setMessage("로그인 후 이용해주세요.");
      return;
    }

    startTransition(async () => {
      setMessage(null);
      const result = await startPlanUpgrade(plan, userId);
      if (result.ok) {
        setMessage(`${plan} 플랜 결제가 완료되었습니다!`);
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button onClick={handleClick} disabled={pending} loading={pending} loadingText="처리 중..." className="w-full">
        {label}
      </Button>
      {message && <p className="text-center text-xs text-zinc-500">{message}</p>}
    </div>
  );
}
