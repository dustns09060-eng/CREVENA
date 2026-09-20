"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AlertTriangleIcon, CheckIcon, XIcon } from "@/components/ui/Icon";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { GuideAnalysis } from "@/lib/ai/guide-analysis-prompts";
import type { ReviewNotes } from "@/lib/ai/prompts";
import {
  PHOTO_SELECT_ROLE_LABELS,
  PHOTO_SELECT_STATE_LABELS,
  REQUIRED_SHOT_STATUS_LABELS,
  type PhotoSelectState,
  type RequiredShotStatus,
} from "@/lib/photo-select";
import type { PhotoManager } from "../photos/usePhotoManager";

// STEP47: "AI로 사진 고르기". An entirely OPTIONAL convenience that sits
// inside the existing 사진 준비 section — a user who never opens it keeps
// the exact pre-STEP47 Content Studio flow (see photoSelectState()'s
// "no run" branch in src/lib/photo-select.ts).
//
// Design constraints honored here: existing Button/Badge components only, no
// new dependency, readable at 375px, every selection state carries an icon
// AND a text label (never color alone), and all toggles are real <button>s
// with aria-pressed so keyboard/screen-reader users get the same control.

type FilterKey = "RECOMMENDED" | "ALL" | "PINNED" | "EXCLUDED";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "RECOMMENDED", label: "AI 추천" },
  { key: "ALL", label: "전체" },
  { key: "PINNED", label: "꼭 사용" },
  { key: "EXCLUDED", label: "제외" },
];

const STATE_TONE: Record<PhotoSelectState, "success" | "brand" | "neutral" | "warning"> = {
  PINNED: "brand",
  AI_PICK: "success",
  INCLUDE: "neutral",
  EXCLUDED: "warning",
  NOT_PICKED: "neutral",
};

const STATE_MARK: Record<PhotoSelectState, string> = {
  PINNED: "★",
  AI_PICK: "✓",
  INCLUDE: "·",
  EXCLUDED: "✕",
  NOT_PICKED: "—",
};

const SHOT_TONE: Record<RequiredShotStatus, "success" | "warning" | "danger"> = {
  MATCHED: "success",
  CANDIDATE: "warning",
  NOT_FOUND: "danger",
};

const SHOT_MARK: Record<RequiredShotStatus, string> = {
  MATCHED: "✓",
  CANDIDATE: "△",
  NOT_FOUND: "✕",
};

const STAGE_LABELS: { key: "ANALYZE" | "GUIDE" | "COMPOSE"; label: string }[] = [
  { key: "ANALYZE", label: "사진 분석 중" },
  { key: "GUIDE", label: "가이드와 비교 중" },
  { key: "COMPOSE", label: "추천 구성 중" },
];

export function PhotoSelectPanel({
  manager,
  brandName,
  productName,
  guideRawContent,
  guideAnalysis,
  reviewNotes,
  onGoToStudio,
}: {
  manager: PhotoManager;
  brandName: string;
  productName: string;
  guideRawContent: string;
  guideAnalysis: GuideAnalysis | null;
  reviewNotes: ReviewNotes;
  onGoToStudio?: () => void;
}) {
  const {
    photos,
    selection,
    stateOf,
    selecting,
    selectProgress,
    selectError,
    analyzeFailures,
    selectionPersisted,
    runPhotoSelect,
    retryFailedAnalyses,
    setPhotoSelectState,
    resetPhotoSelection,
    busy,
  } = manager;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("RECOMMENDED");

  const run = selection.run;
  const unanalyzedCount = photos.filter((p) => !p.ai_analysis).length;
  const estimatedCredits =
    unanalyzedCount * OPERATION_CREDIT_COST.PHOTO_ANALYSIS + OPERATION_CREDIT_COST.ORDER_SUGGEST;

  const usableCount = photos.filter((p) => {
    const s = stateOf(p.id);
    return s === "AI_PICK" || s === "PINNED" || s === "INCLUDE";
  }).length;

  // STEP42-style staleness: the guide changed since the recommendation was
  // produced. Surfaced as a notice only — nothing is invalidated.
  const guideChanged = !!run && (run.guideTextAtGeneration ?? "") !== guideRawContent;
  // Photos the last run never saw. Found in real testing: a 제외 photo is
  // deliberately NOT sent to the model, so it is absent from
  // consideredPhotoIds and would otherwise be miscounted here as "newly
  // added" — it isn't new, the user excluded it on purpose.
  const newPhotoIds = useMemo(
    () =>
      run
        ? photos
            .filter((p) => !run.consideredPhotoIds.includes(p.id) && !selection.excludedIds.includes(p.id))
            .map((p) => p.id)
        : [],
    [run, photos, selection.excludedIds],
  );

  const reasonById = useMemo(() => {
    const map = new Map<string, { reason: string; role: string }>();
    for (const r of run?.reasons ?? []) {
      map.set(r.photoId, { reason: r.reason, role: PHOTO_SELECT_ROLE_LABELS[r.role] });
    }
    return map;
  }, [run]);

  const groupIndexById = useMemo(() => {
    const map = new Map<string, number>();
    (run?.groups ?? []).forEach((g, i) => g.photoIds.forEach((id) => map.set(id, i + 1)));
    return map;
  }, [run]);

  const coverSet = useMemo(() => new Set(run?.coverCandidateIds ?? []), [run]);

  const visiblePhotos = photos.filter((p) => {
    const s = stateOf(p.id);
    if (filter === "ALL") return true;
    if (filter === "PINNED") return s === "PINNED";
    if (filter === "EXCLUDED") return s === "EXCLUDED" || s === "NOT_PICKED";
    return s === "AI_PICK" || s === "PINNED" || s === "INCLUDE";
  });

  function start() {
    void runPhotoSelect({
      brandName,
      productName,
      guideRawContent: guideRawContent.trim() ? guideRawContent : null,
      guideAnalysis,
      reviewNotes,
      minimumPhotos: guideAnalysis?.minimumPhotos,
    });
    setOpen(true);
  }

  return (
    <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/40 p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">AI로 사진 고르기</p>
          <p className="mt-0.5 text-xs text-zinc-600">
            사진이 많을 때, 가이드 필수 컷과 실제 사용 경험을 함께 보고 쓸 사진을 추천해드려요. 최종
            선택은 항상 직접 하실 수 있어요.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
          <Button
            size="sm"
            onClick={start}
            disabled={busy || photos.length === 0}
            loading={selecting}
            loadingText="추천 중..."
          >
            {run ? "다시 추천" : "AI로 사진 고르기"}
          </Button>
          <span className="text-[10px] text-zinc-500">
            예상 {estimatedCredits} 크레딧
            {unanalyzedCount > 0
              ? ` (미분석 ${unanalyzedCount}장 × ${OPERATION_CREDIT_COST.PHOTO_ANALYSIS} + 추천 ${OPERATION_CREDIT_COST.ORDER_SUGGEST})`
              : ` (이미 분석된 사진은 다시 분석하지 않아요)`}
          </span>
        </div>
      </div>

      {/* 실제 진행 단계 — 가짜 퍼센트를 쓰지 않는다. */}
      {selecting && selectProgress && (
        <ul className="mt-3 flex flex-col gap-1">
          {STAGE_LABELS.map((stage) => {
            const currentIdx = STAGE_LABELS.findIndex((s) => s.key === selectProgress.stage);
            const idx = STAGE_LABELS.findIndex((s) => s.key === stage.key);
            const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
            return (
              <li key={stage.key} className="flex items-center gap-2 text-xs text-zinc-600">
                <span aria-hidden className="w-3 text-center">
                  {state === "done" ? "✓" : state === "active" ? "•" : "·"}
                </span>
                <span className={state === "pending" ? "text-zinc-400" : ""}>
                  {stage.label}
                  {stage.key === "ANALYZE" && selectProgress.analyzed
                    ? ` (${selectProgress.analyzed.done}/${selectProgress.analyzed.total})`
                    : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {selectError && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <XIcon size={13} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{selectError}</span>
        </p>
      )}

      {/* 부분 실패: 성공한 사진은 그대로 두고 실패한 것만 재시도 (재과금 없음) */}
      {analyzeFailures.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-start gap-1.5 text-xs text-amber-800">
            <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
            <span>
              {photos.filter((p) => p.ai_analysis).length}장 분석 성공 / {analyzeFailures.length}장 실패.
              실패한 사진만 다시 시도할 수 있어요 (성공한 사진은 다시 분석하지 않으므로 크레딧이 또
              들지 않습니다).
            </span>
          </p>
          <ul className="mt-1 pl-5 text-[11px] text-amber-800">
            {analyzeFailures.map((f) => (
              <li key={f.id}>· {f.filename ?? f.id.slice(0, 8)}</li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void retryFailedAnalyses()} disabled={busy}>
            실패한 {analyzeFailures.length}장 다시 분석
          </Button>
        </div>
      )}

      {selectionPersisted === false && (
        <p className="mt-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-600">
          이 추천/선택은 아직 서버에 저장되지 않았습니다 — 지금은 이 브라우저 화면에서만 유지되고,
          새로고침하면 사라집니다. (사진과 AI 분석 결과 자체는 정상적으로 저장되어 있습니다.)
        </p>
      )}

      {run && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">
              <CheckIcon size={11} /> 추천 {run.selectedPhotoIds.length}장 / 전체 {photos.length}장
            </Badge>
            <Badge tone="neutral">사용 예정 {usableCount}장</Badge>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              {open ? "추천 결과 접기" : "추천 결과 보기"}
            </button>
            <button
              type="button"
              onClick={resetPhotoSelection}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              추천 초기화
            </button>
          </div>

          {guideChanged && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
              가이드 내용이 이 추천 이후에 변경되었습니다. 필수 컷 판단이 최신 가이드를 반영하지 못했을
              수 있어요 — &quot;다시 추천&quot;을 실행하면 꼭 사용/제외는 그대로 유지한 채 다시 계산합니다.
            </p>
          )}
          {newPhotoIds.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
              추천 이후 사진 {newPhotoIds.length}장이 추가되었습니다. &quot;다시 추천&quot;을 실행하면 새로 추가된
              사진만 분석하고(이미 분석된 사진은 다시 분석하지 않습니다) 추천에 반영합니다.
            </p>
          )}

          {open && (
            <>
              {/* 필수 컷 충족 여부 — 매칭되는 사진이 없으면 정직하게 "찾지 못함" */}
              {run.requiredShots.length > 0 && (
                <div className="rounded-lg border border-zinc-200 bg-white p-3">
                  <p className="text-xs font-semibold text-zinc-500">가이드 필수 컷</p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {run.requiredShots.map((shot, i) => (
                      <li key={`${shot.requirement}-${i}`} className="flex flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-700">
                          <span aria-hidden>{SHOT_MARK[shot.status]}</span>
                          <span className="font-medium">{shot.requirement}</span>
                          <Badge tone={SHOT_TONE[shot.status]}>
                            {REQUIRED_SHOT_STATUS_LABELS[shot.status]}
                          </Badge>
                        </span>
                        {shot.note && <span className="pl-4 text-[11px] text-zinc-500">{shot.note}</span>}
                        {shot.status === "NOT_FOUND" && (
                          <span className="pl-4 text-[11px] text-red-600">
                            해당하는 사진을 찾지 못했어요. 이 컷은 추가 촬영이 필요할 수 있습니다.
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 대표 이미지 후보 (1~3장) — 사용자가 언제든 바꿀 수 있다 */}
              {run.coverCandidateIds.length > 0 && (
                <div className="rounded-lg border border-zinc-200 bg-white p-3">
                  <p className="text-xs font-semibold text-zinc-500">
                    대표 이미지 후보 ({run.coverCandidateIds.length}장)
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    1순위는 자동으로 &quot;대표&quot; 자리(첫 번째)로 옮겨두었어요. 위 사진 목록의 &quot;대표&quot;
                    버튼으로 언제든 직접 바꿀 수 있습니다.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {run.coverCandidateIds.map((id) => {
                      const photo = photos.find((p) => p.id === id);
                      if (!photo) return null;
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={id}
                          src={photo.thumbUrl}
                          alt={photo.original_filename ?? "대표 이미지 후보"}
                          className="h-16 w-16 rounded-lg object-cover"
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 유사/중복 묶음 */}
              {run.groups.length > 0 && (
                <div className="rounded-lg border border-zinc-200 bg-white p-3">
                  <p className="text-xs font-semibold text-zinc-500">비슷한 사진 묶음 ({run.groups.length}개)</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    사진의 AI 분석 설명이 거의 같은 것끼리 묶은 결과라, 실제로는 다른 사진이 함께 묶일 수도
                    있어요. 묶음 안에서 쓸 사진은 직접 고르실 수 있습니다.
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {run.groups.map((g, i) => (
                      <li key={i} className="text-[11px] text-zinc-600">
                        묶음 {i + 1}: {g.photoIds.length}장 중 1장 추천 — {g.reason || "설명이 거의 동일"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 필터 */}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="사진 필터">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 ${
                      filter === f.key
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {f.key === filter ? "● " : ""}
                    {f.label}
                  </button>
                ))}
              </div>

              {/* 사진 카드 */}
              {visiblePhotos.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-6 text-center text-xs text-zinc-500">
                  이 조건에 해당하는 사진이 없습니다.
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {visiblePhotos.map((photo) => {
                    const state = stateOf(photo.id);
                    const info = reasonById.get(photo.id);
                    const groupNo = groupIndexById.get(photo.id);
                    return (
                      <li
                        key={photo.id}
                        className="flex gap-2.5 rounded-lg border border-zinc-200 bg-white p-2.5"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.thumbUrl}
                          alt={photo.original_filename ?? "사진"}
                          className="h-16 w-16 shrink-0 rounded-lg object-cover"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge tone={STATE_TONE[state]}>
                              <span aria-hidden>{STATE_MARK[state]}</span>
                              {PHOTO_SELECT_STATE_LABELS[state]}
                            </Badge>
                            {info?.role && <Badge tone="neutral">{info.role}</Badge>}
                            {coverSet.has(photo.id) && <Badge tone="brand">대표 후보</Badge>}
                            {groupNo && <Badge tone="neutral">비슷함 {groupNo}</Badge>}
                          </div>
                          <p className="break-words text-[11px] text-zinc-600">
                            {info?.reason || photo.ai_analysis || "분석 전"}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {(
                              [
                                ["PINNED", "꼭 사용"],
                                ["INCLUDE", "사용"],
                                ["EXCLUDED", "제외"],
                                ["AUTO", "AI에 맡기기"],
                              ] as const
                            ).map(([value, label]) => {
                              const active =
                                (value === "PINNED" && state === "PINNED") ||
                                (value === "INCLUDE" && state === "INCLUDE") ||
                                (value === "EXCLUDED" && state === "EXCLUDED") ||
                                (value === "AUTO" && (state === "AI_PICK" || state === "NOT_PICKED"));
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  aria-pressed={active}
                                  disabled={busy}
                                  onClick={() => setPhotoSelectState(photo.id, value)}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 ${
                                    active
                                      ? "border-zinc-900 bg-zinc-900 text-white"
                                      : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"
                                  }`}
                                >
                                  {active ? "● " : ""}
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="text-[11px] text-zinc-500">
                &quot;꼭 사용&quot;과 &quot;제외&quot;는 다시 추천해도 그대로 유지됩니다. 제외는 사진을 삭제하지 않아요 —
                언제든 되돌릴 수 있습니다.
              </p>

              {onGoToStudio && (
                <div>
                  <Button size="sm" variant="secondary" onClick={onGoToStudio}>
                    추천 사진으로 콘텐츠 만들기
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
