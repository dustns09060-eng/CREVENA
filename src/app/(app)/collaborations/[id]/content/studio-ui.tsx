"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DeterministicGuideCheck, GuideCheckItem } from "@/lib/content-guide-check";
import { CheckIcon, XIcon, AlertTriangleIcon, ChevronDownIcon, PlusIcon, SpinnerIcon } from "@/components/ui/Icon";

export type { GuideCheckItem };

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
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
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
        <CheckIcon size={13} aria-hidden /> 저장됨
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
      <CheckIcon size={13} aria-hidden /> {message}
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

const GUIDE_ICON: Record<GuideCheckItem["state"], { Icon: typeof CheckIcon; className: string }> = {
  pass: { Icon: CheckIcon, className: "text-emerald-600" },
  warn: { Icon: AlertTriangleIcon, className: "text-amber-600" },
  fail: { Icon: XIcon, className: "text-red-600" },
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
      autoFixable: check.missingKeywords.length > 0,
    });
  }
  if (guide.requiredHashtags?.trim()) {
    items.push({
      label: "필수 해시태그",
      state: check.missingHashtags.length === 0 ? "pass" : "fail",
      detail: check.missingHashtags.length > 0 ? `누락: ${check.missingHashtags.join(", ")}` : undefined,
      autoFixable: check.missingHashtags.length > 0,
    });
  }
  if (guide.requiredMentions?.trim()) {
    items.push({
      label: "필수 계정 태그",
      state: check.missingMentions.length === 0 ? "pass" : "fail",
      detail: check.missingMentions.length > 0 ? `누락: ${check.missingMentions.join(", ")}` : undefined,
      autoFixable: check.missingMentions.length > 0,
    });
  }
  if (guide.adDisclosureText?.trim()) {
    items.push({
      label: "광고 표시 문구",
      state: check.hasAdDisclosure ? "pass" : "fail",
      autoFixable: !check.hasAdDisclosure,
    });
  }
  return items;
}

// STEP37 item 8: warn items are always "사용자 확인 필요" — a real experience,
// video, or photo-count fact CREVENA can't verify on its own — while fail
// items read as "누락". This is display-only; the underlying state names
// (pass/warn/fail) are unchanged everywhere else in the codebase.
const GUIDE_STATE_SUFFIX: Record<GuideCheckItem["state"], string | null> = {
  pass: null,
  warn: "사용자 확인 필요",
  fail: "누락",
};

export function GuideCheckList({
  items,
  onAutoFix,
  autoFixing,
}: {
  items: GuideCheckItem[];
  // STEP37 item 2: when provided, a single bulk "AI로 보완" button appears
  // whenever at least one item is both state:"fail" and autoFixable — it
  // patches in every such item at once. Items that need a human (사진 수
  // 조건, 영상/GIF, 금지 표현, 필수 언급 포인트) never get this button.
  onAutoFix?: () => void;
  autoFixing?: boolean;
}) {
  if (items.length === 0) return null;
  const fixableCount = items.filter((i) => i.state === "fail" && i.autoFixable).length;
  const allSatisfied = items.every((i) => i.state !== "fail");

  return (
    <div className="flex flex-col gap-2">
      {allSatisfied && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckIcon size={14} aria-hidden /> 가이드 필수 항목 확인 완료
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const { Icon, className } = GUIDE_ICON[item.state];
          const suffix = GUIDE_STATE_SUFFIX[item.state];
          return (
            <li key={item.label} className="flex items-start gap-1.5 text-xs">
              <Icon size={13} aria-hidden className={`mt-0.5 shrink-0 ${className}`} />
              <span className="text-zinc-700">
                {item.label}
                {suffix && <span className={`ml-1 ${className}`}>({suffix})</span>}
                {item.detail && <span className="text-zinc-500"> · {item.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {onAutoFix && fixableCount > 0 && (
        <button
          type="button"
          onClick={onAutoFix}
          disabled={autoFixing}
          className="mt-1 self-start rounded-full border border-zinc-300 px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          {autoFixing ? "보완 중..." : `누락 항목 AI로 보완 (${fixableCount}건)`}
        </button>
      )}
    </div>
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
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white">
        <PlusIcon size={20} />
      </span>
      <span className="text-sm font-medium text-zinc-900">사진 추가</span>
      <span className="text-xs text-zinc-500">제품과 실제 사용 사진을 추가해주세요.</span>
      {maxCount ? <span className="text-[11px] text-zinc-400">최대 {maxCount}장</span> : null}
    </button>
  );
}

// STEP35.5: collapsed-by-default section for optional input ("내 경험
//추가하기") — the first screen should not force every field open at once.
export function Accordion({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left sm:px-5"
      >
        <span>
          <span className="text-sm font-semibold text-zinc-900">{title}</span>
          {description && <span className="ml-2 text-xs text-zinc-400">{description}</span>}
        </span>
        <ChevronDownIcon
          size={16}
          aria-hidden
          className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-zinc-100 p-4 sm:p-5">{children}</div>}
    </div>
  );
}

export type ProgressStepState = "pending" | "active" | "done" | "failed" | "skipped";

export type ProgressStep = {
  key: string;
  label: string;
  state: ProgressStepState;
  detail?: string;
};

const PROGRESS_CLASS: Record<ProgressStepState, string> = {
  pending: "text-zinc-300",
  active: "text-brand-600",
  done: "text-emerald-600",
  failed: "text-red-600",
  skipped: "text-zinc-400",
};

function ProgressIcon({ state }: { state: ProgressStepState }) {
  const cls = `shrink-0 ${PROGRESS_CLASS[state]}`;
  if (state === "active") return <SpinnerIcon size={14} aria-hidden className={cls} />;
  if (state === "done") return <CheckIcon size={14} aria-hidden className={cls} />;
  if (state === "failed") return <XIcon size={14} aria-hidden className={cls} />;
  return (
    <span aria-hidden className={`inline-block w-3.5 text-center text-sm leading-none ${cls}`}>
      {state === "skipped" ? "–" : "○"}
    </span>
  );
}

// STEP35.5 item 16: live progress list for the one-click pipeline
// (가이드 분석 중... → 사진 분석 중... 3/10 → ... → 완료).
export function ProgressList({ steps }: { steps: ProgressStep[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2 text-xs">
          <ProgressIcon state={step.state} />
          <span className={step.state === "active" ? "font-medium text-zinc-900" : "text-zinc-600"}>
            {step.label}
            {step.detail ? ` ${step.detail}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
