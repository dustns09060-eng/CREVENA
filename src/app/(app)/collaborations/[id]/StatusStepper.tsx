import { COLLABORATION_STATUSES, COLLABORATION_STATUS_LABELS } from "@/lib/collaboration-status";
import type { CollaborationStatus } from "@/types/database";

export function StatusStepper({ currentStatus }: { currentStatus: CollaborationStatus }) {
  const currentIndex = COLLABORATION_STATUSES.indexOf(currentStatus);

  return (
    <div className="flex gap-1 overflow-x-auto">
      {COLLABORATION_STATUSES.map((s, i) => (
        <span
          key={s}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            i === currentIndex
              ? "bg-zinc-900 text-white"
              : i < currentIndex
                ? "bg-zinc-200 text-zinc-500"
                : "bg-zinc-100 text-zinc-400"
          }`}
        >
          {COLLABORATION_STATUS_LABELS[s]}
        </span>
      ))}
    </div>
  );
}
