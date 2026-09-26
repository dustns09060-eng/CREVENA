"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { deleteProject } from "../actions";

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        프로젝트 삭제
      </Button>
    );
  }

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    const result = await deleteProject(projectId);
    setDeleting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push("/product-shorts");
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button variant="danger" size="sm" loading={deleting} loadingText="삭제 중..." onClick={handleConfirm}>
          정말 삭제할까요?
        </Button>
        <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
          취소
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
