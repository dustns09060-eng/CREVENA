import type { ReactNode } from "react";
import { AlertTriangleIcon, SpinnerIcon } from "./Icon";

// STEP43 items 42/43/44: one consistent shape for "nothing here yet",
// "working on it", and "something went wrong" — each screen still supplies
// its own real copy/action (never fabricated), this just standardizes the
// layout/icon/spacing so a user doesn't get a different visual language on
// every empty list.
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {description && <p className="max-w-xs text-xs text-zinc-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
      <SpinnerIcon size={16} className="text-brand-600" />
      <span>{label}</span>
    </div>
  );
}

// STEP43 item 44: never show raw API errors (500/429/QUOTA_EXCEEDED/stack
// traces) — callers already translate those to Korean messages (existing
// error-handling logic is unchanged by this component), this only owns the
// visual presentation of whatever user-facing string they pass in.
export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertTriangleIcon size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
