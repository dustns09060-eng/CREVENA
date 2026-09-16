"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold text-zinc-900">문제가 발생했습니다</p>
      <p className="max-w-sm text-sm text-zinc-500">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
      >
        다시 시도
      </button>
    </div>
  );
}
