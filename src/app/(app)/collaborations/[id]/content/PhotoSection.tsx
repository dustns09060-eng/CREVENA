"use client";

import { SectionHeader, PhotoUploadEmptyState } from "./studio-ui";
import { PHOTO_TYPE_LABELS } from "@/lib/photo-type";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { PhotoManager } from "../photos/usePhotoManager";

// STEP35.5 item 4/22: 사진 준비 rendered once at the top of the studio
// (step 2), shared by all platforms — not nested inside the 블로그 tab
// anymore. All state/handlers come from usePhotoManager (owned by
// StudioTabs) so this component is purely presentational.
export function PhotoSection({
  manager,
  requiredPhotoCount,
}: {
  manager: PhotoManager;
  requiredPhotoCount: number | null;
}) {
  const {
    photos,
    fileInputRef,
    uploading,
    analyzing,
    analyzeProgress,
    ordering,
    busy,
    excludePhotoIds,
    handleAddPhotos,
    handleAnalyzeAll,
    handleSuggestOrder,
    setPrimary,
    handleDeletePhoto,
    handleMemoChange,
    handleMemoBlur,
    handleDragStart,
    handleDrop,
    handleMove,
  } = manager;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
      <SectionHeader
        step={2}
        title={`사진 준비 (${photos.length}장)`}
        description="직접 촬영한 사진을 추가해주세요. AI가 사진 내용을 분석하고 글의 흐름에 맞게 배치합니다."
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => handleAddPhotos(e.target.files)}
      />

      {requiredPhotoCount && requiredPhotoCount > 0 && photos.length < requiredPhotoCount && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          필수 사진 수({requiredPhotoCount}장) 중 {photos.length}장만 업로드되었습니다.
        </p>
      )}

      {photos.length === 0 ? (
        <div className="mt-4">
          <PhotoUploadEmptyState
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            maxCount={requiredPhotoCount}
          />
          {uploading && <p className="mt-2 text-center text-xs text-zinc-400">업로드 중...</p>}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {uploading ? "업로드 중..." : "+ 사진 추가"}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleAnalyzeAll}
                disabled={busy}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                {analyzing
                  ? analyzeProgress
                    ? `분석 중... (${analyzeProgress.done}/${analyzeProgress.total})`
                    : "분석 중..."
                  : "AI 사진 분석"}
              </button>
              <span className="text-[10px] text-zinc-400">
                사진 장당 {OPERATION_CREDIT_COST.PHOTO_ANALYSIS} 크레딧
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleSuggestOrder}
                disabled={busy || photos.length < 2}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                {ordering ? "추천 중..." : "사진 순서/대표사진 추천"}
              </button>
              <span className="text-[10px] text-zinc-400">
                {OPERATION_CREDIT_COST.ORDER_SUGGEST} 크레딧 사용
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo, index) => (
              <div
                key={photo.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
                className="flex cursor-move flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-2.5"
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.thumbUrl}
                    alt={photo.original_filename ?? "사진"}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                  <button
                    onClick={() => setPrimary(photo.id)}
                    disabled={index === 0}
                    className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white ${
                      index === 0 ? "bg-zinc-900/80" : "bg-zinc-900/50 hover:bg-zinc-900/80"
                    }`}
                    title={index === 0 ? "대표사진" : "대표사진으로 설정"}
                  >
                    {index === 0 ? "대표" : `#${index + 1}`}
                  </button>
                  <button
                    onClick={() => handleDeletePhoto(photo)}
                    aria-label="사진 삭제"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-xs text-red-600 shadow hover:bg-white"
                  >
                    ×
                  </button>
                  {excludePhotoIds.has(photo.id) && (
                    <span className="absolute bottom-1 left-1 right-1 rounded bg-amber-500/90 px-1 py-0.5 text-center text-[9px] font-medium text-white">
                      제외 추천
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      photo.photo_type ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {photo.photo_type ? PHOTO_TYPE_LABELS[photo.photo_type] : "미분석"}
                  </span>
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0}
                      aria-label="위로 이동"
                      className="rounded border border-zinc-200 px-1 text-[10px] text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMove(index, 1)}
                      disabled={index === photos.length - 1}
                      aria-label="아래로 이동"
                      className="rounded border border-zinc-200 px-1 text-[10px] text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-500">
                  <span className="font-medium text-zinc-600">AI 분석: </span>
                  {photo.ai_analysis ?? "-"}
                </p>
                <textarea
                  rows={2}
                  placeholder="사진 메모 (예: 거실에서 촬영)"
                  value={photo.user_memo ?? ""}
                  onChange={(e) => handleMemoChange(photo.id, e.target.value)}
                  onBlur={(e) => handleMemoBlur(photo.id, e.target.value)}
                  className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-900"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
