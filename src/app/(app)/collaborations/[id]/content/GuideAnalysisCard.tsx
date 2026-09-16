"use client";

import { useState } from "react";
import type { GuideAnalysis } from "@/lib/ai/guide-analysis-prompts";

const SUMMARY_ITEMS_MIN_SHOWN = 3;

// STEP35.5 item 2/3: shows the AI-extracted guide as a short summary card by
// default ("가이드 분석 완료 / ✓ 제목 필수 키워드 2개 / ..."), never the raw
// JSON. "자세히 보기" reveals an editable breakdown so the user can correct
// anything the AI misread — but that panel is opt-in, not shown by default.
export function GuideAnalysisCard({
  analysis,
  onChange,
}: {
  analysis: GuideAnalysis;
  onChange: (next: GuideAnalysis) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const summaryItems: { label: string; ok: boolean }[] = [
    { label: `제목 필수 키워드 ${analysis.titleKeywords.length}개`, ok: analysis.titleKeywords.length > 0 },
    { label: `본문 키워드 ${analysis.bodyKeywords.length}개`, ok: analysis.bodyKeywords.length > 0 },
    {
      label: analysis.minimumPhotos ? `사진 최소 ${analysis.minimumPhotos}장` : "사진 최소 수 지정 없음",
      ok: !!analysis.minimumPhotos,
    },
    { label: `필수 문구 ${analysis.requiredPhrases.length}개`, ok: analysis.requiredPhrases.length > 0 },
    { label: `필수 해시태그 ${analysis.hashtags.length}개`, ok: analysis.hashtags.length > 0 },
  ].filter((item, i) => i < SUMMARY_ITEMS_MIN_SHOWN || item.ok);

  function listField(key: keyof GuideAnalysis, label: string) {
    const value = analysis[key] as string[];
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-600">{label}</span>
        <input
          value={value.join(", ")}
          onChange={(e) =>
            onChange({ ...analysis, [key]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
          }
          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs outline-none focus:border-zinc-900"
        />
      </label>
    );
  }

  function textField(key: keyof GuideAnalysis, label: string) {
    const value = (analysis[key] as string | null) ?? "";
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-600">{label}</span>
        <input
          value={value}
          onChange={(e) => onChange({ ...analysis, [key]: e.target.value || null })}
          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs outline-none focus:border-zinc-900"
        />
      </label>
    );
  }

  function numberField(key: keyof GuideAnalysis, label: string) {
    const value = (analysis[key] as number | null) ?? "";
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-600">{label}</span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange({ ...analysis, [key]: e.target.value === "" ? null : Number(e.target.value) })}
          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs outline-none focus:border-zinc-900"
        />
      </label>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <p className="text-xs font-semibold text-emerald-800">가이드 분석 완료</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {summaryItems.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5 text-xs text-emerald-800">
            <span aria-hidden>{item.ok ? "✓" : "–"}</span> {item.label}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-[11px] font-medium text-emerald-700 hover:underline"
      >
        {expanded ? "접기" : "자세히 보기"}
      </button>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-emerald-100 pt-3 sm:grid-cols-2">
          {textField("brandName", "브랜드명")}
          {textField("productName", "제품명")}
          {listField("platforms", "업로드 플랫폼")}
          {listField("titleKeywords", "제목 필수 키워드")}
          {listField("bodyKeywords", "본문 필수 키워드")}
          {textField("keywordRepeatCondition", "키워드 반복 조건")}
          {numberField("minimumCharacters", "최소 글자 수")}
          {numberField("minimumPhotos", "최소 사진 수")}
          {listField("requiredPhrases", "필수 문구")}
          {listField("hashtags", "필수 해시태그")}
          {listField("accountTags", "필수 계정 태그")}
          {listField("requiredUrls", "필수 URL")}
          {listField("prohibitedExpressions", "금지 표현")}
          {listField("requiredPoints", "필수 언급 포인트")}
          {textField("deadline", "업로드 마감일")}
          {listField("otherRequirements", "기타 요구사항")}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={analysis.requiresVideo}
              onChange={(e) => onChange({ ...analysis, requiresVideo: e.target.checked })}
            />
            <span className="font-medium text-zinc-600">영상/GIF 필요</span>
          </label>
        </div>
      )}
    </div>
  );
}
