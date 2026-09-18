"use client";

import { useMemo, useState } from "react";
import { isValidNaverBlogUrl } from "@/lib/naver-url";
import { Button } from "@/components/ui/Button";
import { GuideCheckList, type GuideCheckItem } from "../content/studio-ui";
import type { BlogMeta } from "./actions";
import type { PhotoWithUrl } from "./usePhotoManager";

// STEP38: 네이버 블로그 발행 도우미.
//
// 네이버 블로그 공식 글쓰기 API가 없다는 전제 하에, CREVENA가 이미 만든
// 제목 → 도입 → (사진 → 문단) × N → 마무리 → 해시태그 구조를 사용자가 최대한
// 빠르고 실수 없이 네이버 에디터로 옮기도록 돕는 "복사 도우미"다. 절대
// 자동으로 게시하지 않는다 — 모든 버튼은 클립보드 복사 또는 새 탭 링크
// 열기뿐이고, 네이버 로그인 정보/쿠키/세션은 어디에도 저장하지 않는다.
//
// 새 AI 호출은 전혀 하지 않는다 — blogMeta/photos는 부모(PhotoBlogStudio)가
// 이미 들고 있는, 마지막으로 생성/저장된 결과를 그대로 재사용한다.

type PublishStep =
  | { id: "title"; kind: "title" }
  | { id: "intro"; kind: "intro" }
  | { id: `photo:${string}`; kind: "photo"; photo: PhotoWithUrl; index: number; total: number }
  | { id: "closing"; kind: "closing" }
  | { id: "hashtags"; kind: "hashtags" };

function buildSteps(usablePhotos: PhotoWithUrl[]): PublishStep[] {
  const withBody = usablePhotos.filter((p) => p.body_section);
  const steps: PublishStep[] = [{ id: "title", kind: "title" }, { id: "intro", kind: "intro" }];
  withBody.forEach((photo, i) => {
    steps.push({ id: `photo:${photo.id}`, kind: "photo", photo, index: i + 1, total: withBody.length });
  });
  steps.push({ id: "closing", kind: "closing" }, { id: "hashtags", kind: "hashtags" });
  return steps;
}

function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
    >
      {copied ? "✓ 복사됨" : label}
    </button>
  );
}

export function NaverPublishAssistant({
  blogMeta,
  photos,
  usablePhotos,
  guideItems,
  currentGuideRawContent,
  libraryDirty,
  isSaved,
  onClose,
  onPersist,
  onMarkPublished,
}: {
  blogMeta: BlogMeta;
  photos: PhotoWithUrl[];
  usablePhotos: PhotoWithUrl[];
  guideItems: GuideCheckItem[];
  currentGuideRawContent: string | null;
  libraryDirty: boolean;
  isSaved: boolean;
  onClose: () => void;
  onPersist: (next: BlogMeta) => void | Promise<void>;
  onMarkPublished: (url: string) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"list" | "focus">("list");
  const [focusIndex, setFocusIndex] = useState(0);
  const [urlInput, setUrlInput] = useState(blogMeta.publishState?.publishedUrl ?? "");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const steps = useMemo(() => buildSteps(usablePhotos), [usablePhotos]);
  const completedIds = useMemo(
    () => new Set(blogMeta.publishState?.completedStepIds ?? []),
    [blogMeta.publishState],
  );
  const doneCount = steps.filter((s) => completedIds.has(s.id)).length;
  const failCount = guideItems.filter((i) => i.state === "fail").length;

  // 대표사진 = display_order 0번째 사진 (STEP35.5부터의 기존 컨벤션 재사용,
  // 새 컬럼을 만들지 않음).
  const primaryPhotoId = photos[0]?.id ?? null;

  // STEP38 item 22: 블로그를 마지막으로 쓴/보완한 시점의 가이드 원문과 현재
  // 가이드 원문을 비교 — 다르면 "가이드가 변경되었습니다" 경고. guideRawContent
  // 자체가 없던 협찬(가이드를 안 붙여넣은 경우)은 비교 대상이 아니므로 제외.
  const guideStale =
    !!currentGuideRawContent &&
    blogMeta.guideTextAtGeneration !== undefined &&
    blogMeta.guideTextAtGeneration !== currentGuideRawContent;

  function toggleStep(id: string) {
    const current = blogMeta.publishState?.completedStepIds ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onPersist({
      ...blogMeta,
      publishState: { ...blogMeta.publishState, completedStepIds: next },
    });
  }

  async function handleMarkPublished() {
    const trimmed = urlInput.trim();
    if (trimmed && !isValidNaverBlogUrl(trimmed)) {
      setUrlError("네이버 블로그 게시물 URL 형식이 아닙니다. (예: https://blog.naver.com/아이디/글번호)");
      return;
    }
    setUrlError(null);
    setPublishing(true);
    try {
      await onMarkPublished(trimmed);
    } finally {
      setPublishing(false);
    }
  }

  const published = !!blogMeta.publishState?.publishedUrl;

  function stepLabel(step: PublishStep): string {
    if (step.kind === "title") return "제목";
    if (step.kind === "intro") return "도입";
    if (step.kind === "closing") return "마무리";
    if (step.kind === "hashtags") return "해시태그";
    return `사진 ${step.index} + 문단`;
  }

  function stepCopyText(step: PublishStep): string {
    if (step.kind === "title") return blogMeta.title;
    if (step.kind === "intro") return blogMeta.intro;
    if (step.kind === "closing") return blogMeta.closing;
    if (step.kind === "hashtags") return blogMeta.hashtags;
    return step.photo.body_section ?? "";
  }

  function renderStepCard(step: PublishStep, opts?: { focus?: boolean }) {
    const done = completedIds.has(step.id);
    return (
      <div
        key={step.id}
        className={`flex flex-col gap-2 rounded-xl border p-3 ${
          done ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-200 bg-white"
        }`}
      >
        {step.kind === "photo" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
              <span>
                {step.index} / {step.total}
                {step.photo.id === primaryPhotoId && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    대표사진 추천
                  </span>
                )}
              </span>
              <span className="truncate text-zinc-400">{step.photo.original_filename ?? ""}</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={step.photo.fullUrl}
              alt={step.photo.original_filename ?? `사진 ${step.index}`}
              className={`w-full rounded-lg object-cover ${opts?.focus ? "max-h-80" : "max-h-56"}`}
            />
            {step.photo.ai_analysis && (
              <p className="text-[11px] text-zinc-400">AI 분석(참고용 — 본문에는 포함되지 않음): {step.photo.ai_analysis}</p>
            )}
            <p className="text-xs font-medium text-zinc-500">이 사진 다음에 넣을 글</p>
          </div>
        )}
        {step.kind !== "photo" && <p className="text-xs font-semibold text-zinc-500">{stepLabel(step)}</p>}

        <p className="whitespace-pre-wrap rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 text-sm text-zinc-800">
          {stepCopyText(step) || "(내용 없음)"}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={stepCopyText(step)} label={step.kind === "photo" ? "문단 복사" : `${stepLabel(step)} 복사`} />
          <button
            type="button"
            onClick={() => toggleStep(step.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              done
                ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {done ? "✓ 완료" : "완료 체크"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-6">
      {/* STEP38 fix: without self-start here, the flex parent's default
          align-items:stretch forces this panel to exactly the viewport's
          height (its content then overflows invisibly past that box while
          the semi-transparent backdrop — and the real page behind it —
          shows through below the fold instead of the white panel). */}
      <div className="flex min-h-full w-full shrink-0 flex-col gap-4 self-start bg-white p-4 sm:min-h-0 sm:max-w-2xl sm:rounded-2xl sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900">네이버 블로그 발행 도우미</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              발행 준비 진행률 {doneCount} / {steps.length} 완료
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-lg leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${steps.length > 0 ? (doneCount / steps.length) * 100 : 0}%` }}
          />
        </div>

        {libraryDirty && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            △ 저장되지 않은 변경사항이 있습니다. 발행 전에 &quot;저장&quot;을 눌러주세요.
          </p>
        )}
        {guideStale && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            △ 가이드가 변경되었습니다. 발행 전에 콘텐츠를 다시 확인해주세요.
          </p>
        )}

        {guideItems.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            {failCount > 0 && (
              <p className="mb-2 text-xs font-semibold text-red-600">
                가이드 필수 항목 {failCount}개를 확인해주세요.
              </p>
            )}
            <GuideCheckList items={guideItems} />
          </div>
        )}

        {/* STEP45 copy fix: the label used to read "네이버 블로그 글쓰기 열기",
            but this href is the Naver blog *home*, not the editor — and a
            brand-colored button promising "글쓰기" reads as though CREVENA
            opens/fills the editor for you. It only opens a new tab; the user
            writes the post themselves. The instruction is also no longer
            11px grey, since it's the step that actually explains the flow. */}
        <div className="flex flex-col gap-1.5">
          <a
            href="https://blog.naver.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            네이버 블로그 열기
          </a>
          <span className="text-xs text-zinc-500">
            새 탭에서 네이버에 로그인한 뒤 &quot;글쓰기&quot;를 눌러주세요. 아래 단계에서 복사한 내용을 붙여넣으면
            됩니다.
          </span>
        </div>

        <div className="flex items-center gap-1 self-start rounded-full border border-zinc-200 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("list")}
            className={`rounded-full px-3 py-1 font-medium ${mode === "list" ? "bg-brand-600 text-white" : "text-zinc-500"}`}
          >
            목록 모드
          </button>
          <button
            type="button"
            onClick={() => setMode("focus")}
            className={`rounded-full px-3 py-1 font-medium ${mode === "focus" ? "bg-brand-600 text-white" : "text-zinc-500"}`}
          >
            집중 모드 (이전/다음)
          </button>
        </div>

        {/* 사진 한꺼번에 준비: AI가 정한(그리고 사용자가 최종 수정한) 순서 그대로 */}
        {photos.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <p className="mb-2 text-xs font-semibold text-zinc-500">사진 순서 한눈에 보기</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((p, i) => (
                <div key={p.id} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  {p.id === primaryPhotoId && (
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-400 px-1 text-[9px] font-bold text-white">
                      대표
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "list" && (
          <div className="flex flex-col gap-3">{steps.map((step) => renderStepCard(step))}</div>
        )}

        {mode === "focus" && steps[focusIndex] && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-xs font-semibold text-zinc-500">
              현재 {focusIndex + 1} / {steps.length}
            </p>
            {renderStepCard(steps[focusIndex], { focus: true })}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setFocusIndex((i) => Math.max(0, i - 1))}
                disabled={focusIndex === 0}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => {
                  const step = steps[focusIndex];
                  if (!completedIds.has(step.id)) toggleStep(step.id);
                  setFocusIndex((i) => Math.min(steps.length - 1, i + 1));
                }}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                ✓ 완료하고 다음
              </button>
              <button
                type="button"
                onClick={() => setFocusIndex((i) => Math.min(steps.length - 1, i + 1))}
                disabled={focusIndex === steps.length - 1}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-semibold text-zinc-500">발행 완료 기록</p>
          {published ? (
            <div className="flex flex-col gap-1 text-xs text-emerald-700">
              <span>✓ 네이버 블로그 발행 완료</span>
              {blogMeta.publishState?.publishedAt && (
                <span className="text-zinc-400">
                  {new Date(blogMeta.publishState.publishedAt).toLocaleString("ko-KR")}
                </span>
              )}
              {blogMeta.publishState?.publishedUrl && (
                <a
                  href={blogMeta.publishState.publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit text-zinc-900 underline"
                >
                  게시물 보기
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              CREVENA는 대신 발행하지 않아요. 네이버에서 직접 발행을 마친 뒤, 그 글의 URL을 붙여넣어 기록해 주세요.
            </p>
          )}
          <input
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setUrlError(null);
            }}
            placeholder="발행한 네이버 블로그 URL을 붙여넣어 주세요"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
          />
          {urlError && <p className="text-xs text-red-600">{urlError}</p>}
          {!isSaved && (
            <p className="text-xs text-amber-700">먼저 블로그를 저장한 뒤 발행 완료로 표시할 수 있습니다.</p>
          )}
          {/* STEP45: was a hand-rolled emerald-600 button — the only
              off-brand primary CTA left in the app, and a green button
              labelled "발행 완료" next to a URL field reads as "publish it
              now". It only records a URL the user already published, so the
              label now says so and it uses the shared primary Button. */}
          <Button
            type="button"
            onClick={handleMarkPublished}
            disabled={publishing || !isSaved}
            loading={publishing}
            loadingText="저장 중..."
            className="self-start"
          >
            발행 완료로 표시
          </Button>
        </div>
      </div>
    </div>
  );
}
