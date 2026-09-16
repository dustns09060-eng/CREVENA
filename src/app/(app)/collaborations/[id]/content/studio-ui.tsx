"use client";

import { useEffect, useState } from "react";
import type { DeterministicGuideCheck } from "@/lib/content-guide-check";

// STEP35: shared presentational pieces for the content studio's UX overhaul.
// Pure UI — none of this touches credits, AI calls, storage, or DB writes;
// every component here just renders state that the platform panels already
// compute (see PlatformPanel.tsx / PhotoBlogStudio.tsx).

export function SectionHeader({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
        {step}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
    </div>
  );
}

export function OptionalTag() {
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">선택</span>
  );
}

export type SaveState = "idle" | "dirty" | "saved";

export function SaveStatusBadge({ state }: { state: SaveState }) {
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <span aria-hidden>✓</span> 저장됨
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
        <span aria-hidden className="text-[8px]">●</span> 저장되지 않은 변경사항
      </span>
    );
  }
  return null;
}

// Small self-dismissing confirmation banner (e.g. "저장되었습니다.") — not a
// portal/overlay toast library, just a local inline element each panel
// mounts near its save button so it never needs global toast state.
export function useSaveToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [message]);

  return { toastMessage: message, showToast: setMessage };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
    >
      <span aria-hidden>✓</span> {message}
    </div>
  );
}

export type PlatformStatus = "EMPTY" | "GENERATING" | "DONE" | "COMING_SOON";

export function PlatformStatusPill({ status }: { status: PlatformStatus }) {
  const config: Record<PlatformStatus, { label: string; className: string }> = {
    EMPTY: { label: "작성 전", className: "bg-zinc-100 text-zinc-500" },
    GENERATING: { label: "작성 중...", className: "bg-blue-50 text-blue-600" },
    DONE: { label: "작성 완료", className: "bg-emerald-50 text-emerald-700" },
    COMING_SOON: { label: "준비 중", className: "bg-zinc-100 text-zinc-400" },
  };
  const { label, className } = config[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{label}</span>
  );
}

export type GuideCheckItem = {
  label: string;
  state: "pass" | "warn" | "fail";
  detail?: string;
};

const GUIDE_ICON: Record<GuideCheckItem["state"], { icon: string; className: string }> = {
  pass: { icon: "✓", className: "text-emerald-600" },
  warn: { icon: "△", className: "text-amber-600" },
  fail: { icon: "✕", className: "text-red-600" },
};

// Turns the existing deterministic check (src/lib/content-guide-check.ts,
// unchanged) into a display-ready list of ✓/△/✕ items — a presentation
// mapping only, no new checking logic.
export function buildDeterministicGuideItems(
  check: DeterministicGuideCheck,
  guide: {
    requiredKeywords?: string | null;
    requiredHashtags?: string | null;
    requiredMentions?: string | null;
    adDisclosureText?: string | null;
  },
): GuideCheckItem[] {
  const items: GuideCheckItem[] = [];
  if (guide.requiredKeywords?.trim()) {
    items.push({
      label: "필수 키워드",
      state: check.missingKeywords.length === 0 ? "pass" : "fail",
      detail: check.missingKeywords.length > 0 ? `누락: ${check.missingKeywords.join(", ")}` : undefined,
    });
  }
  if (guide.requiredHashtags?.trim()) {
    items.push({
      label: "필수 해시태그",
      state: check.missingHashtags.length === 0 ? "pass" : "fail",
      detail: check.missingHashtags.length > 0 ? `누락: ${check.missingHashtags.join(", ")}` : undefined,
    });
  }
  if (guide.requiredMentions?.trim()) {
    items.push({
      label: "필수 계정 태그",
      state: check.missingMentions.length === 0 ? "pass" : "fail",
      detail: check.missingMentions.length > 0 ? `누락: ${check.missingMentions.join(", ")}` : undefined,
    });
  }
  if (guide.adDisclosureText?.trim()) {
    items.push({
      label: "광고 표시 문구",
      state: check.hasAdDisclosure ? "pass" : "fail",
    });
  }
  return items;
}

export function GuideCheckList({ items }: { items: GuideCheckItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const { icon, className } = GUIDE_ICON[item.state];
        return (
          <li key={item.label} className="flex items-start gap-1.5 text-xs">
            <span aria-hidden className={`font-semibold ${className}`}>
              {icon}
            </span>
            <span className="text-zinc-700">
              {item.label}
              {item.detail && <span className="text-zinc-500"> · {item.detail}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Upload dropzone-style empty state for the photo section.
export function PhotoUploadEmptyState({
  onClick,
  disabled,
  maxCount,
}: {
  onClick: () => void;
  disabled?: boolean;
  maxCount?: number | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center transition-colors hover:border-zinc-400 hover:bg-zinc-100 disabled:opacity-50"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-lg font-semibold text-white">
        +
      </span>
      <span className="text-sm font-medium text-zinc-900">사진 추가</span>
      <span className="text-xs text-zinc-500">제품과 실제 사용 사진을 추가해주세요.</span>
      {maxCount ? <span className="text-[11px] text-zinc-400">최대 {maxCount}장</span> : null}
    </button>
  );
}
