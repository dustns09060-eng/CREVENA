"use client";

import { useActionState } from "react";
import { updateStatus, type UpdateStatusState } from "./actions";
import { COLLABORATION_STATUSES, COLLABORATION_STATUS_LABELS } from "@/lib/collaboration-status";
import type { CollaborationStatus } from "@/types/database";

const initialState: UpdateStatusState = null;

export function StatusControl({
  collaborationId,
  currentStatus,
}: {
  collaborationId: string;
  currentStatus: CollaborationStatus;
}) {
  const boundAction = updateStatus.bind(null, collaborationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={formAction} className="flex items-center gap-2">
        <select
          name="status"
          defaultValue={currentStatus}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm font-medium text-zinc-700"
        >
          {COLLABORATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COLLABORATION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          상태 변경
        </button>
      </form>

      {currentStatus !== "COMPLETED" && (
        <form action={formAction}>
          <input type="hidden" name="status" value="COMPLETED" />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            완료 처리
          </button>
        </form>
      )}

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
