import type { ReactNode } from "react";

// STEP43: a consistent page-level header (title + optional description +
// optional primary action) for top-of-route screens (Dashboard,
// Collaborations, Pricing, Settings, ...) — distinct from studio-ui.tsx's
// SectionHeader, which is for numbered steps *inside* a single page like the
// Content Studio and is left untouched.
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
