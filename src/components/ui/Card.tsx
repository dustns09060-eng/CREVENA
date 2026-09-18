import type { HTMLAttributes } from "react";

// STEP43: the one card shape every screen already hand-rolled inline
// ("rounded-xl border border-zinc-200 bg-white p-4/p-6") — extracted so
// future screens don't have to remember the exact classes, not a visual
// change from what most screens already used.
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 ${className ?? ""}`}
      {...rest}
    />
  );
}
