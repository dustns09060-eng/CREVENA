"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

// STEP43 item 46: shared modal shell for confirmation dialogs (e.g. STEP42's
// "이미 콘텐츠가 있습니다" repurpose-overwrite confirm) — backdrop click and
// Escape both close it (via onClose), and the panel traps neither business
// logic nor state: callers keep owning their own open/close state and pass
// the buttons as children, so no existing confirm flow's logic changes.
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg outline-none"
      >
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
        {description && <p className="mt-2 text-xs leading-relaxed text-zinc-500">{description}</p>}
        <div className="mt-4 flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}
